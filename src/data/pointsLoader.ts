import { haversineMeters } from '../game/geo';
import type { LngLat } from '../types';
import { cellsForBounds, type Bounds, type Cell } from './grid';
import { withEnrichment, type GamePoint } from './points';
import { ENRICH_BATCH_LIMIT, enrichPoints, fetchCellPoints } from './wikipediaSource';

/** Больше этого числа ячеек в кадре — карта слишком отдалена */
const MAX_CELLS_PER_VIEW = 16;

/** Сколько запросов создавать за раз. Реальный темп задаёт очередь httpClient */
const CONCURRENCY = 3;

/** Пауза перед повторной попыткой для ячейки, которая не загрузилась */
const RETRY_COOLDOWN_MS = 30_000;

/**
 * Сколько батчей обогащения делать за один проход
 *
 * Одна ячейка в центре Москвы — около 500 точек, видимая область накрывает
 * несколько. Обогащать всё разом значило бы под сорок запросов на первую же
 * загрузку. Берём только ближайшие к игроку: два батча по 50 — сотня точек,
 * чего хватает на радиус, куда он может дойти. Остальные обогатятся, когда
 * он туда доберётся
 */
const ENRICH_MAX_BATCHES = 2;

export interface LoaderStatus {
  readonly loading: boolean;
  readonly lastError: string | null;
  readonly cellsLoaded: number;
  readonly cellsFailed: number;
  readonly tooFarOut: boolean;
  readonly total: number;
  readonly enriched: number;
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
  private enrichedCount = 0;

  constructor(private readonly options: PointsLoaderOptions) {}

  get status(): LoaderStatus {
    return {
      loading: this.activeRequests > 0,
      lastError: this.lastError,
      cellsLoaded: this.loadedCells.size,
      cellsFailed: this.failedUntil.size,
      tooFarOut: this.tooFarOut,
      total: this.points.size,
      enriched: this.enrichedCount,
    };
  }

  /**
   * Догружает то, чего не хватает под указанную область
   *
   * focus — точка, от которой считается приоритет обогащения картинками:
   * позиция игрока, а пока его нет — центр карты
   */
  async sync(bounds: Bounds, focus: LngLat): Promise<void> {
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

    await this.enrichNearby(focus);
  }

  /** Догружает картинки для ближайших к focus точек */
  private async enrichNearby(focus: LngLat): Promise<void> {
    const pending = [...this.points.values()]
      .filter((point) => !point.enriched)
      .map((point) => ({ point, distance: haversineMeters(focus, [point.lng, point.lat]) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, ENRICH_BATCH_LIMIT * ENRICH_MAX_BATCHES)
      .map((entry) => entry.point);

    for (let i = 0; i < pending.length; i += ENRICH_BATCH_LIMIT) {
      if (this.disposed) return;
      // Прерываемся на первой неудаче: повторим при следующем движении карты
      if (!(await this.enrichBatch(pending.slice(i, i + ENRICH_BATCH_LIMIT)))) return;
    }
  }

  /** Один батч. false — запрос не удался */
  private async enrichBatch(batch: readonly GamePoint[]): Promise<boolean> {
    if (batch.length === 0) return true;

    this.activeRequests += 1;
    this.publish();
    try {
      const enrichment = await enrichPoints(
        this.options.apiBaseUrl,
        batch.map((point) => point.id),
        this.controller.signal,
      );
      if (this.disposed) return false;

      for (const point of batch) {
        // Страницы может не оказаться в ответе (удалена, объединена).
        // Всё равно помечаем обогащённой, иначе будем просить её вечно
        const data = enrichment.get(point.id) ?? {
          thumbnailUrl: undefined,
          description: undefined,
        };
        this.points.set(point.id, withEnrichment(point, data));
        this.enrichedCount += 1;
      }

      this.options.onChange();
      this.lastError = null;
      return true;
    } catch (error) {
      if (this.disposed || this.controller.signal.aborted) return false;
      // Обогащение необязательно: без картинки точка играбельна, просто
      // с заниженной редкостью
      this.lastError = error instanceof Error ? error.message : String(error);
      return false;
    } finally {
      this.activeRequests -= 1;
      this.publish();
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
