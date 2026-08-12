import { useEffect, useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';

import type { GamePoint } from './points';
import { PointsLoader, type LoaderStatus } from './pointsLoader';

/** Пауза после последнего движения карты, прежде чем идти за данными */
const DEBOUNCE_MS = 350;

export interface UsePointsResult {
  /** Ссылка стабильна, меняется только содержимое */
  readonly points: ReadonlyMap<string, GamePoint>;
  /** Растёт при каждом изменении набора точек */
  readonly version: number;
  readonly status: LoaderStatus;
}

const EMPTY_STATUS: LoaderStatus = {
  loading: false,
  lastError: null,
  cellsLoaded: 0,
  cellsFailed: 0,
  tooFarOut: false,
  total: 0,
};

/**
 * Адаптер между PointsLoader и React
 *
 * Вся логика загрузки живёт в загрузчике и проверяется без браузера.
 * Здесь остаётся только то, что относится к React: подписка на движение
 * карты, дебаунс и проброс состояния в рендер
 *
 * apiBaseUrl читается один раз при монтировании: конфиг приходит от хоста
 * вместе с mount() и по ходу жизни экземпляра не меняется
 */
export function usePoints(map: MapLibreMap | null, apiBaseUrl: string): UsePointsResult {
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<LoaderStatus>(EMPTY_STATUS);

  const [loader] = useState(
    () =>
      new PointsLoader({
        apiBaseUrl,
        onChange: () => {
          setVersion((v) => v + 1);
        },
        onStatus: setStatus,
      }),
  );

  useEffect(() => () => {
    loader.dispose();
  }, [loader]);

  useEffect(() => {
    if (!map) return undefined;

    let debounceId = 0;
    const readBounds = () => {
      const b = map.getBounds();
      return { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() };
    };

    const scheduleSync = (): void => {
      window.clearTimeout(debounceId);
      // Во время панорамирования moveend приходит часто, а нас интересует
      // только то место, где карта в итоге остановилась
      debounceId = window.setTimeout(() => {
        void loader.syncBounds(readBounds());
      }, DEBOUNCE_MS);
    };

    map.on('moveend', scheduleSync);
    // moveend не придёт, пока карту не тронут — стартовую область грузим сами
    void loader.syncBounds(readBounds());

    return () => {
      window.clearTimeout(debounceId);
      map.off('moveend', scheduleSync);
    };
  }, [map, loader]);

  return { points: loader.points, version, status };
}
