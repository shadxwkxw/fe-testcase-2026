import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Map as MapLibreMap } from 'maplibre-gl';

// Стили MapLibre живут в shadow root вместе с картой: <link> в <head>
// host-страницы за границу тени не достаёт
import maplibreCss from 'maplibre-gl/dist/maplibre-gl.css?inline';

import type { LngLat } from '../types';
import type { ShadowHost } from '../runtime/shadowHost';
import { resolveMapStyle } from './mapStyle';

export type MapPhase =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly usedFallback: boolean; readonly styleUrl: string }
  | { readonly phase: 'error'; readonly message: string };

export interface UseMapInstanceParams {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly shadow: ShadowHost;
  readonly initialCenter: LngLat;
  readonly initialZoom: number;
  readonly styleUrls: readonly string[];
  readonly onError: (message: string) => void;
}

export interface UseMapInstanceResult {
  readonly map: MapLibreMap | null;
  readonly state: MapPhase;
}

/**
 * Мост между императивным инстансом MapLibre и жизненным циклом React
 *
 * Правила, которых придерживается весь слой карты:
 *
 * 1. Инстанс создаётся один раз на монтирование. Меняющиеся значения (центр,
 *    зум, город) НЕ попадают в зависимости эффекта — иначе каждое изменение
 *    пересоздавало бы карту вместе с WebGL-контекстом. Они синхронизируются
 *    императивными вызовами в отдельных эффектах
 * 2. Стартовые значения фиксируются в ref: они нужны только конструктору
 * 3. Уборка зовёт map.remove() — он же гасит WebGL-контекст, свои слушатели
 *    и внутренние RAF
 */
export function useMapInstance(params: UseMapInstanceParams): UseMapInstanceResult {
  const { containerRef, shadow, styleUrls } = params;

  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [state, setState] = useState<MapPhase>({ phase: 'loading' });

  const initialRef = useRef({ center: params.initialCenter, zoom: params.initialZoom });
  const onErrorRef = useRef(params.onError);
  useEffect(() => {
    onErrorRef.current = params.onError;
  }, [params.onError]);

  // До первого кадра карты, иначе её элементы управления мигнут неоформленными
  useLayoutEffect(() => {
    // 'library' — перед base.css, иначе .maplibregl-map перебивает наш
    // .pokemap-map по порядку и контейнер схлопывается в нулевую высоту
    shadow.adoptStyles(maplibreCss, 'library');
  }, [shadow]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const controller = new AbortController();
    let instance: MapLibreMap | null = null;
    let disposed = false;

    void (async () => {
      try {
        const resolved = await resolveMapStyle(styleUrls, controller.signal);
        // Между await и созданием виджет мог быть размонтирован
        if (disposed) return;

        const { center, zoom } = initialRef.current;

        instance = new MapLibreMap({
          container,
          style: resolved.style,
          // LngLat у нас readonly-кортеж, MapLibre ждёт изменяемый
          center: [center[0], center[1]],
          zoom,
          attributionControl: { compact: true },
        });

        // Ошибка тайла или спрайта не должна ронять виджет
        instance.on('error', (event) => {
          const reason: unknown = event.error;
          console.warn('[pokemap] maplibre:', reason instanceof Error ? reason.message : reason);
        });

        // Документированный сигнал готовности. Наступает после первого
        // отрисованного кадра — как и вся инициализация MapLibre, которая
        // тоже ждёт кадра (Style.loadJSON уходит в frameAsync)
        instance.once('load', () => {
          if (disposed || !instance) return;
          setMap(instance);
          setState({ phase: 'ready', usedFallback: resolved.usedFallback, styleUrl: resolved.url });
        });
      } catch (error) {
        if (disposed || controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        setState({ phase: 'error', message });
        onErrorRef.current(message);
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
      instance?.remove();
      instance = null;
    };
  }, [containerRef, styleUrls]);

  return { map, state };
}
