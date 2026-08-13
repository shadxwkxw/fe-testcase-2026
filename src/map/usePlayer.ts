import { useCallback, useEffect, useRef, useState } from 'react';
import type { Feature } from 'geojson';
import { Marker, type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';

import { circlePolygon } from '../game/circle';
import type { LngLat } from '../types';
import {
  POINTS_LAYER_ID,
  RADIUS_FILL_ID,
  RADIUS_LINE_ID,
  RADIUS_SOURCE_ID,
  radiusFillSpec,
  radiusLineSpec,
} from './layerSpecs';

export interface UsePlayerParams {
  readonly map: MapLibreMap | null;
  readonly start: LngLat;
  readonly collectRadiusMeters: number;
}

export interface UsePlayerResult {
  readonly position: LngLat | null;
  readonly moveTo: (position: LngLat) => void;
}

/**
 * Маркер игрока и круг радиуса сбора
 *
 * Здесь DOM-маркер уместен, в отличие от точек: он ровно один, ему нужен
 * курсор и перетаскивание. Готовый maplibregl.Marker к тому же сам считает
 * позицию указателя через DOM.getScale(), то есть корректно работает под
 * transform: scale() родителя — режим C ему не страшен
 */
export function usePlayer({ map, start, collectRadiusMeters }: UsePlayerParams): UsePlayerResult {
  const [position, setPosition] = useState<LngLat | null>(null);
  const markerRef = useRef<Marker | null>(null);

  // Стартовая позиция нужна только при создании маркера
  const startRef = useRef(start);

  useEffect(() => {
    if (!map) return undefined;

    const element = document.createElement('div');
    element.className = 'pokemap-player';
    element.title = 'Перетащите, чтобы переместиться';

    const initial = startRef.current;
    const marker = new Marker({ element, draggable: true })
      .setLngLat([initial[0], initial[1]])
      .addTo(map);

    markerRef.current = marker;
    setPosition(initial);

    // drag, а не dragend: круг и подсветка доступных точек должны следовать
    // за курсором, иначе перемещение выглядит сломанным
    const onDrag = (): void => {
      const { lng, lat } = marker.getLngLat();
      setPosition([lng, lat]);
    };
    marker.on('drag', onDrag);

    return () => {
      marker.off('drag', onDrag);
      marker.remove();
      markerRef.current = null;
      setPosition(null);
    };
  }, [map]);

  /* --- слои круга: создаются один раз ------------------------------- */
  useEffect(() => {
    if (!map) return undefined;

    try {
      map.addSource(RADIUS_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // Под слоем точек: круг не должен перекрывать то, что в нём лежит
      const beforeId = map.getLayer(POINTS_LAYER_ID) ? POINTS_LAYER_ID : undefined;
      map.addLayer(radiusFillSpec, beforeId);
      map.addLayer(radiusLineSpec, beforeId);
    } catch (error) {
      console.error('[pokemap] не удалось добавить слой радиуса:', error);
      return undefined;
    }

    return () => {
      if (!map.getStyle()) return;
      for (const id of [RADIUS_FILL_ID, RADIUS_LINE_ID]) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      if (map.getSource(RADIUS_SOURCE_ID)) map.removeSource(RADIUS_SOURCE_ID);
    };
  }, [map]);

  /* --- геометрия круга следует за игроком ---------------------------- */
  useEffect(() => {
    const source = map?.getSource<GeoJSONSource>(RADIUS_SOURCE_ID);
    if (!source || !position) return;

    const data: Feature = {
      type: 'Feature',
      geometry: circlePolygon(position, collectRadiusMeters),
      properties: {},
    };
    source.setData(data);
  }, [map, position, collectRadiusMeters]);

  /*
   * useCallback обязателен, а не «для порядка»: функция уходит в зависимости
   * эффектов снаружи. Без мемоизации её идентичность менялась бы на каждый
   * рендер, а рендер случается на каждое обновление статуса загрузки точек
   */
  const moveTo = useCallback((next: LngLat): void => {
    markerRef.current?.setLngLat([next[0], next[1]]);
    setPosition(next);
  }, []);

  return { position, moveTo };
}
