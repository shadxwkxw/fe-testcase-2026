import { cellsForBounds, type Bounds, type Cell } from './grid';
import type { GamePoint } from './points';
import { fetchCellPoints } from './wikipediaSource';

/** Больше этого числа ячеек в кадре — карта слишком отдалена */
const MAX_CELLS_PER_VIEW = 16;

/** Сколько запросов создавать за раз. Реальный темп задаёт очередь httpClient */
const CONCURRENCY = 3;

/** Пауза перед повторной попыткой для ячейки, которая не загрузилась */
const RETRY_COOLDOWN_MS = 30_000;

export interface LoaderStatus {
  readonly loading: boolean;
  readonly lastError: string | null;
  readonly cellsLoaded: number;
  readonly cellsFailed: number;
  readonly tooFarOut: boolean;
  readonly total: number;
}

export interface PointsLoaderOptions {
  readonly apiBaseUrl: string;
  /** Набор точек изменился — пора обновить источник карты */
  readonly onChange: () => void;
  readonly onStatus: (status: LoaderStatus) => void;
}

/**
 * Загрузка точек по ячейкам сетки
 *
 * Обычный класс, а не хук: здесь нет ничего от React, и благодаря этому
 * логику можно прогнать в Node против локального сервера. Хук usePoints —
 * тонкий адаптер поверх
 */
export class PointsLoader {
  /** Ссылка стабильна на всё время жизни загрузчика */
  readonly points = new Map<string, GamePoint>();

  private readonly controller = new AbortController();
  private readonly loadedCells = new Set<string>();
  private readonly inFlight = new Set<string>();
  private readonly failedUntil = new Map<string, number>();

  private disposed = false;
  private activeRequests = 0;
  private lastError: string | null = null;
  private tooFarOut = false;

  constructor(private readonly options: PointsLoaderOptions) {}

  get status(): LoaderStatus {
    return {
      loading: this.activeRequests > 0,
      lastError: this.lastError,
      cellsLoaded: this.loadedCells.size,
      cellsFailed: this.failedUntil.size,
      tooFarOut: this.tooFarOut,
      total: this.points.size,
    };
  }

  /** Догружает то, чего не хватает под указанную область */
  async syncBounds(bounds: Bounds): Promise<void> {
    if (this.disposed) return;

    const { cells, tooManyCells } = cellsForBounds(bounds, MAX_CELLS_PER_VIEW);
    this.tooFarOut = tooManyCells;
    this.publish();
    if (tooManyCells) return;

    const now = Date.now();
    const pending = cells.filter((cell) => {
      if (this.loadedCells.has(cell.id) || this.inFlight.has(cell.id)) return false;
      const retryAt = this.failedUntil.get(cell.id);
      return retryAt === undefined || retryAt <= now;
    });

    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      if (this.disposed) return;
      await Promise.all(pending.slice(i, i + CONCURRENCY).map((cell) => this.loadCell(cell)));
    }
  }

  dispose(): void {
    this.disposed = true;
    this.controller.abort();
  }

  private async loadCell(cell: Cell): Promise<void> {
    this.inFlight.add(cell.id);
    this.activeRequests += 1;
    this.publish();

    try {
      const result = await fetchCellPoints(
        this.options.apiBaseUrl,
        cell.bbox,
        this.controller.signal,
      );
      if (this.disposed) return;

      let added = 0;
      for (const point of result.points) {
        // Ячейки не перекрываются, но статья может попасть в выдачу соседней
        // по краю — ключ по pageid снимает дубликаты
        if (!this.points.has(point.id)) {
          this.points.set(point.id, point);
          added += 1;
        }
      }

      this.loadedCells.add(cell.id);
      this.failedUntil.delete(cell.id);
      this.lastError = null;

      if (added > 0) this.options.onChange();
    } catch (error) {
      if (this.disposed || this.controller.signal.aborted) return;
      // Ячейка не помечается загруженной — попробуем ещё раз, но не сразу,
      // чтобы неответчивый источник не превратился в цикл запросов
      this.failedUntil.set(cell.id, Date.now() + RETRY_COOLDOWN_MS);
      this.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      this.inFlight.delete(cell.id);
      this.activeRequests -= 1;
      this.publish();
    }
  }

  private publish(): void {
    if (!this.disposed) this.options.onStatus(this.status);
  }
}
