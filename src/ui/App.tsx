import { useEffect, useMemo, useRef } from 'react';
import type { MapMouseEvent } from 'maplibre-gl';

import { DEFAULT_API_BASE_URL, DEFAULT_CITY, DEFAULT_ZOOM, STYLE_URLS } from '../config';
import { usePoints } from '../data/usePoints';
import { DEFAULT_COLLECT_RADIUS_METERS } from '../config';
import { useHostGeometry } from '../map/useHostGeometry';
import { useMapInstance } from '../map/useMapInstance';
import { usePlayer } from '../map/usePlayer';
import { POINTS_LAYER_ID, usePointsLayer } from '../map/usePointsLayer';
import { useGame } from '../game/useGame';
import { Hud } from './Hud';
import type { PokeMapConfig } from '../types';
import type { DisposeBag } from '../runtime/lifecycle';
import type { ShadowHost } from '../runtime/shadowHost';

export interface AppProps {
  readonly config: PokeMapConfig;
  readonly shadow: ShadowHost;
  readonly bag: DisposeBag;
}

export function App({ config, shadow }: AppProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const city = useMemo(() => config.city ?? DEFAULT_CITY, [config.city]);

  const { map, state } = useMapInstance({
    containerRef,
    shadow,
    initialCenter: city.center,
    initialZoom: DEFAULT_ZOOM,
    styleUrls: STYLE_URLS,
    onError: (message) => {
      config.onEvent?.({ type: 'error', scope: 'map', message });
    },
  });

  const scale = useHostGeometry(map, containerRef);
  const collectRadiusMeters = config.collectRadiusMeters ?? DEFAULT_COLLECT_RADIUS_METERS;

  const player = usePlayer({ map, start: city.center, collectRadiusMeters });

  // Фокус ленивой подгрузки картинок — позиция игрока: обогащается то,
  // до чего он реально может дойти
  const { points, version, status: pointsStatus } = usePoints(
    map,
    config.apiBaseUrl ?? DEFAULT_API_BASE_URL,
    player.position,
  );

  const game = useGame({ points, onEvent: config.onEvent });

  const { available } = usePointsLayer({
    map,
    points,
    version,
    collected: game.collected,
    player: player.position,
    collectRadiusMeters,
  });

  /* --- сбор по клику -------------------------------------------------- */
  const collectRef = useRef(game.collect);
  const availableRef = useRef(available);
  useEffect(() => {
    collectRef.current = game.collect;
    availableRef.current = available;
  }, [game.collect, available]);

  useEffect(() => {
    if (!map) return undefined;

    // Обработчик ставится один раз на всё время жизни карты: свежие
    // available и collect берутся из ref, иначе каждое движение игрока
    // переподписывало бы слушатель
    const onClick = (event: MapMouseEvent): void => {
      if (!map.getLayer(POINTS_LAYER_ID)) return;
      const [feature] = map.queryRenderedFeatures(event.point, { layers: [POINTS_LAYER_ID] });
      // properties типизированы как any: значения приходят из GeoJSON
      const pointId: unknown = feature?.properties?.['pointId'];
      if (typeof pointId !== 'string') return;
      if (!availableRef.current.has(pointId)) return;
      collectRef.current(pointId);
    };

    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
    };
  }, [map]);

  useEffect(() => {
    if (state.phase !== 'ready') return;
    config.onEvent?.({ type: 'ready', version: __WIDGET_VERSION__ });
  }, [state.phase, config]);

  return (
    <>
      <div className="pokemap-map" ref={containerRef} />

      {state.phase === 'loading' && <div className="pokemap-overlay">загрузка карты…</div>}

      {state.phase === 'ready' && (
        <Hud
          score={game.score}
          collectedCount={game.collected.size}
          multiplier={game.multiplier}
          frozen={game.frozen}
        />
      )}

      {state.phase === 'ready' && (
        <div className="pokemap-debug">
          масштаб ×{scale.toFixed(2)} · pixelRatio {map ? map.getPixelRatio().toFixed(2) : '—'} ·
          точек {pointsStatus.total} ({pointsStatus.enriched} с карт.) · ячеек {pointsStatus.cellsLoaded} · доступно {available.size}
          {pointsStatus.loading ? ' · загрузка' : ''}
          {pointsStatus.tooFarOut ? ' · приблизьте карту' : ''}
          {pointsStatus.cellsFailed > 0 ? ` · сбоев ${pointsStatus.cellsFailed}` : ''}
        </div>
      )}

      {state.phase === 'error' && (
        <div className="pokemap-overlay pokemap-overlay--error">
          <b>карта недоступна</b>
          <span>{state.message}</span>
        </div>
      )}
    </>
  );
}
