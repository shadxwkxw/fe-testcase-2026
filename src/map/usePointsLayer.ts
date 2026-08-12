import { useEffect, useMemo, useRef } from 'react';
import type { Feature, FeatureCollection } from 'geojson';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';

import type { GamePoint } from '../data/points';
import { haversineMeters } from '../game/geo';
import type { LngLat } from '../types';
import { POINTS_LAYER_ID, POINTS_SOURCE_ID, pointsLayerSpec } from './layerSpecs';

export { POINTS_LAYER_ID, POINTS_SOURCE_ID };

/**
 * Отрисовка точек
 *
 * СТРАТЕГИЯ: один GeoJSON-источник и один circle-слой, всё рисует WebGL-
 * контекст самой карты. DOM-маркеры здесь непригодны принципиально: это по
 * узлу на точку, и на тысяче объектов браузер пересчитывает тысячу
 * трансформаций на каждый кадр панорамирования
 *
 * ГЕОМЕТРИЯ И СОСТОЯНИЕ РАЗДЕЛЕНЫ — главное решение блока.
 * setData пересобирает всю коллекцию, сериализует её и заново разбирает в
 * воркере. Поэтому setData вызывается только когда меняется САМ НАБОР точек.
 * Динамика — «собрана» и «доступна» — живёт в feature-state: setFeatureState
 * меняет пару значений в уже загруженном буфере и геометрию не трогает
 */

function buildFeatureCollection(points: ReadonlyMap<string, GamePoint>): FeatureCollection {
  const features: Feature[] = [];
  for (const point of points.values()) {
    features.push({
      type: 'Feature',
      // Числовой id обязателен для feature-state
      id: Number(point.id),
      geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
      properties: { pointId: point.id, rarity: point.rarity, title: point.title },
    });
  }
  return { type: 'FeatureCollection', features };
}

export interface UsePointsLayerParams {
  readonly map: MapLibreMap | null;
  readonly points: ReadonlyMap<string, GamePoint>;
  readonly version: number;
  readonly collected: ReadonlySet<string>;
  readonly player: LngLat | null;
  readonly collectRadiusMeters: number;
}

export interface UsePointsLayerResult {
  /** Точки в радиусе сбора — их можно собрать прямо сейчас */
  readonly available: ReadonlySet<string>;
}

export function usePointsLayer({
  map,
  points,
  version,
  collected,
  player,
  collectRadiusMeters,
}: UsePointsLayerParams): UsePointsLayerResult {
  // Что уже проставлено в feature-state, чтобы трогать только изменения
  const appliedAvailable = useRef<Set<string>>(new Set());
  const appliedCollected = useRef<Set<string>>(new Set());

  // Собранные нужны эффекту с setData только для восстановления состояния.
  // В зависимостях им не место: множество меняет идентичность на каждый сбор,
  // и вся коллекция уходила бы в источник заново при каждом клике
  const collectedRef = useRef(collected);
  useEffect(() => {
    collectedRef.current = collected;
  }, [collected]);

  /*
   * Доступные точки — производное значение, а не состояние: они полностью
   * выводятся из позиции игрока, набора точек и радиуса
   */
  const available = useMemo<ReadonlySet<string>>(() => {
    const next = new Set<string>();
    if (!player) return next;

    // Грубый прямоугольный отсев до гаверсинуса: считать точное расстояние
    // до каждой из тысяч точек на каждый шаг игрока незачем
    const latPad = collectRadiusMeters / 111_000;
    const lngPad = latPad / Math.max(Math.cos((player[1] * Math.PI) / 180), 1e-6);

    for (const point of points.values()) {
      if (collected.has(point.id)) continue;
      if (Math.abs(point.lat - player[1]) > latPad) continue;
      if (Math.abs(point.lng - player[0]) > lngPad) continue;
      if (haversineMeters(player, [point.lng, point.lat]) <= collectRadiusMeters) {
        next.add(point.id);
      }
    }
    return next;
    /*
     * version в зависимостях намеренно, и линтер здесь не прав: points —
     * одна и та же Map на всё время жизни, меняется её содержимое, а не
     * ссылка. Убрать version — множество перестанет пересчитываться после
     * подгрузки новой ячейки
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, version, player, collected, collectRadiusMeters]);

  /* --- источник и слой --------------------------------------------- */
  useEffect(() => {
    if (!map) return undefined;

    // map отдаётся наружу только после события load, значит стиль применён
    // и addSource/addLayer безопасны
    try {
      map.addSource(POINTS_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer(pointsLayerSpec);
    } catch (error) {
      // Молчаливый отказ стоил бы карты без единой точки при полностью
      // рабочем слое данных — ошибка обязана быть громкой
      console.error('[pokemap] не удалось добавить слой точек:', error);
      return undefined;
    }

    return () => {
      appliedAvailable.current = new Set();
      appliedCollected.current = new Set();

      // Карта могла быть уничтожена раньше этого эффекта
      if (!map.getStyle()) return;
      if (map.getLayer(POINTS_LAYER_ID)) map.removeLayer(POINTS_LAYER_ID);
      if (map.getSource(POINTS_SOURCE_ID)) map.removeSource(POINTS_SOURCE_ID);
    };
  }, [map]);

  /* --- данные: только при изменении набора точек -------------------- */
  useEffect(() => {
    const source = map?.getSource<GeoJSONSource>(POINTS_SOURCE_ID);
    if (!map || !source) return;

    source.setData(buildFeatureCollection(points));

    // setData сбрасывает feature-state всех объектов, поэтому состояние
    // нужно проставить заново. Забыть об этом — увидеть, как собранные точки
    // «оживают» после подгрузки новой ячейки
    appliedAvailable.current = new Set();
    appliedCollected.current = new Set();
    for (const id of collectedRef.current) {
      map.setFeatureState({ source: POINTS_SOURCE_ID, id: Number(id) }, { collected: true });
      appliedCollected.current.add(id);
    }
  }, [map, version, points]);

  /* --- состояние «собрана» ------------------------------------------ */
  useEffect(() => {
    if (!map?.getSource(POINTS_SOURCE_ID)) return;

    for (const id of collected) {
      if (appliedCollected.current.has(id)) continue;
      map.setFeatureState({ source: POINTS_SOURCE_ID, id: Number(id) }, { collected: true });
      appliedCollected.current.add(id);
    }
  }, [map, collected]);

  /* --- состояние «доступна» ----------------------------------------- */
  useEffect(() => {
    if (!map?.getSource(POINTS_SOURCE_ID)) return;

    // Трогаем только разницу: setFeatureState для всех точек на каждый шаг
    // игрока свёл бы на нет весь смысл разделения
    for (const id of appliedAvailable.current) {
      if (!available.has(id)) {
        map.setFeatureState({ source: POINTS_SOURCE_ID, id: Number(id) }, { available: false });
      }
    }
    for (const id of available) {
      if (!appliedAvailable.current.has(id)) {
        map.setFeatureState({ source: POINTS_SOURCE_ID, id: Number(id) }, { available: true });
      }
    }

    appliedAvailable.current = new Set(available);
  }, [map, available]);

  return { available };
}
