import { useEffect, useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';

import { cellsForBounds, type Cell } from './grid';
import type { GamePoint } from './points';
import { fetchCellPoints } from './wikipediaSource';

/** Пауза после последнего движения карты, прежде чем идти за данными */
const DEBOUNCE_MS = 350;

/** Больше этого числа ячеек в кадре — карта слишком отдалена */
const MAX_CELLS_PER_VIEW = 16;

/** Сколько запросов создавать за раз */
const CONCURRENCY = 3;

/** Пауза перед повторной попыткой для ячейки, которая не загрузилась */
const RETRY_COOLDOWN_MS = 30_000;

export interface PointsStatus {
  readonly loading: boolean;
  readonly lastError: string | null;
  readonly cellsLoaded: number;
  readonly cellsFailed: number;
  readonly tooFarOut: boolean;
  readonly total: number;
}

export interface UsePointsResult {
  /** Ссылка стабильна, меняется только содержимое */
  readonly points: ReadonlyMap<string, GamePoint>;
  /** Растёт при каждом изменении набора точек */
  readonly version: number;
  readonly status: PointsStatus;
}

const EMPTY_STATUS: PointsStatus = {
  loading: false,
  lastError: null,
  cellsLoaded: 0,
  cellsFailed: 0,
  tooFarOut: false,
  total: 0,
};

/**
 * Загрузка точек под текущую видимую область
 *
 * Точки копятся в одной и той же Map, а не пересобираются: их тысячи, и
 * создавать новую коллекцию ради перерисовки React незачем — рисовать их
 * будет MapLibre императивно. Наружу отдаётся version, по которому слой
 * карты понимает, что источник пора обновить
 */
export function usePoints(map: MapLibreMap | null, apiBaseUrl: string): UsePointsResult {
  // useState с ленивым инициализатором, а не useRef: Map создаётся один раз,
  // но читать её можно во время рендера
  const [points] = useState<Map<string, GamePoint>>(() => new Map());
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<PointsStatus>(EMPTY_STATUS);

  useEffect(() => {
    if (!map) return undefined;

    const controller = new AbortController();
    const loadedCells = new Set<string>();
    const inFlight = new Set<string>();
    const failedUntil = new Map<string, number>();

    let disposed = false;
    let debounceId = 0;
    let activeRequests = 0;

    const publishStatus = (patch: Partial<PointsStatus> = {}): void => {
      if (disposed) return;
      setStatus((prev) => ({
        ...prev,
        cellsLoaded: loadedCells.size,
        cellsFailed: failedUntil.size,
        total: points.size,
        loading: activeRequests > 0,
        ...patch,
      }));
    };

    const loadCell = async (cell: Cell): Promise<void> => {
      inFlight.add(cell.id);
      activeRequests += 1;
      publishStatus();

      try {
        const result = await fetchCellPoints(apiBaseUrl, cell.bbox, controller.signal);
        if (disposed) return;

        let added = 0;
        for (const point of result.points) {
          // Ячейки не перекрываются, но статья может попасть в выдачу
          // соседней по краю — ключ по pageid снимает дубликаты
          if (!points.has(point.id)) {
            points.set(point.id, point);
            added += 1;
          }
        }

        loadedCells.add(cell.id);
        failedUntil.delete(cell.id);

        if (added > 0) setVersion((v) => v + 1);
        publishStatus({ lastError: null });
      } catch (error) {
        if (disposed || controller.signal.aborted) return;
        // Ячейка не помечается загруженной — попробуем ещё раз, но не сразу,
        // чтобы неответчивый источник не превратился в цикл запросов
        failedUntil.set(cell.id, Date.now() + RETRY_COOLDOWN_MS);
        publishStatus({ lastError: error instanceof Error ? error.message : String(error) });
      } finally {
        inFlight.delete(cell.id);
        activeRequests -= 1;
        publishStatus();
      }
    };

    const syncViewport = async (): Promise<void> => {
      if (disposed) return;

      const bounds = map.getBounds();
      const { cells, tooManyCells } = cellsForBounds(
        {
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest(),
        },
        MAX_CELLS_PER_VIEW,
      );

      publishStatus({ tooFarOut: tooManyCells });
      if (tooManyCells) return;

      const now = Date.now();
      const pending = cells.filter((cell) => {
        if (loadedCells.has(cell.id) || inFlight.has(cell.id)) return false;
        const retryAt = failedUntil.get(cell.id);
        return retryAt === undefined || retryAt <= now;
      });

      for (let i = 0; i < pending.length; i += CONCURRENCY) {
        if (disposed) return;
        await Promise.all(pending.slice(i, i + CONCURRENCY).map(loadCell));
      }
    };

    const scheduleSync = (): void => {
      window.clearTimeout(debounceId);
      // Во время панорамирования moveend приходит часто, а нас интересует
      // только то место, где карта в итоге остановилась
      debounceId = window.setTimeout(() => {
        void syncViewport();
      }, DEBOUNCE_MS);
    };

    map.on('moveend', scheduleSync);
    // moveend не придёт, пока карту не тронут — стартовую область грузим сами
    void syncViewport();

    return () => {
      disposed = true;
      window.clearTimeout(debounceId);
      controller.abort();
      map.off('moveend', scheduleSync);
    };
  }, [map, apiBaseUrl, points]);

  return { points, version, status };
}
