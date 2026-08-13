import { useCallback, useEffect, useRef, useState } from 'react';
import type { MapMouseEvent } from 'maplibre-gl';

import { CITIES, DEFAULT_API_BASE_URL, DEFAULT_ZOOM, STYLE_URLS, type CityId } from '../config';
import { usePoints } from '../data/usePoints';
import { DEFAULT_COLLECT_RADIUS_METERS } from '../config';
import { useHostGeometry } from '../map/useHostGeometry';
import { useMapInstance } from '../map/useMapInstance';
import { usePlayer } from '../map/usePlayer';
import { POINTS_LAYER_ID, usePointsLayer } from '../map/usePointsLayer';
import { useGame } from '../game/useGame';
import { Hud } from './Hud';
import { PointCard } from './PointCard';
import type { PokeMapConfig } from '../types';
import type { DisposeBag } from '../runtime/lifecycle';
import type { ShadowHost } from '../runtime/shadowHost';

/** Пресет, совпадающий с городом из конфига, иначе Москва */
function initialCityId(cityName: string | undefined): CityId {
  const match = (Object.keys(CITIES) as CityId[]).find((id) => CITIES[id].name === cityName);
  return match ?? 'moscow';
}

export interface AppProps {
  readonly config: PokeMapConfig;
  readonly shadow: ShadowHost;
  readonly bag: DisposeBag;
}

export function App({ config, shadow }: AppProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [cityId, setCityId] = useState<CityId>(() => initialCityId(config.city?.name));
  const city = CITIES[cityId];

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
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { points, version, status: pointsStatus, enrichNow } = usePoints(
    map,
    config.apiBaseUrl ?? DEFAULT_API_BASE_URL,
    player.position,
  );

  const game = useGame({ points, cityName: city.name, onEvent: config.onEvent });

  const { available } = usePointsLayer({
    map,
    points,
    version,
    collected: game.collected,
    player: player.position,
    collectRadiusMeters,
  });

  /* --- переключение города без перезагрузки -------------------------- */
  const { moveTo } = player;
  const appliedCityId = useRef(cityId);

  useEffect(() => {
    // Сравнение с фактически применённым городом, а не флаг «первый рендер»:
    // эффект, двигающий камеру, обязан быть защищён от лишних срабатываний
    // на своём же уровне
    if (appliedCityId.current === cityId) return;
    appliedCityId.current = cityId;
    if (!map) return;

    // Карта императивна: город — не пересоздание инстанса, а команда
    // существующему. Игрок переезжает вместе с камерой, иначе остался бы
    // в другом городе с пустым радиусом сбора
    map.jumpTo({ center: [city.center[0], city.center[1]], zoom: DEFAULT_ZOOM });
    moveTo(city.center);
    config.onEvent?.({ type: 'city-changed', city });
  }, [map, cityId, city, moveTo, config]);

  // Смена города уводит игрока за сотни километров — карточка теряет смысл.
  // Сбрасываем её в обработчике, а не эффектом: это прямое следствие
  // действия пользователя, а не синхронизация с внешней системой
  const changeCity = useCallback((next: CityId) => {
    setCityId(next);
    setSelectedId(null);
  }, []);

  const selectedPoint = selectedId === null ? undefined : points.get(selectedId);

  /* --- выбор точки по клику -------------------------------------------------- */
  const onEventRef = useRef(config.onEvent);
  useEffect(() => {
    onEventRef.current = config.onEvent;
  }, [config.onEvent]);

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

      // Клик мимо точек закрывает карточку
      if (typeof pointId !== 'string') {
        setSelectedId(null);
        return;
      }

      setSelectedId(pointId);
      onEventRef.current?.({ type: 'point-selected', pointId });
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
          cityId={cityId}
          onCityChange={changeCity}
          onReset={game.reset}
        />
      )}

      {state.phase === 'ready' && selectedPoint && (
        <PointCard
          point={selectedPoint}
          available={available.has(selectedPoint.id)}
          collected={game.collected.has(selectedPoint.id)}
          multiplier={game.multiplier}
          onCollect={game.collect}
          onClose={() => {
            setSelectedId(null);
          }}
          onNeedEnrichment={enrichNow}
        />
      )}

      {state.phase === 'ready' && (
        <div className="pokemap-debug">
          масштаб ×{scale.toFixed(2)} · pixelRatio {map ? map.getPixelRatio().toFixed(2) : '—'} ·
          точек {pointsStatus.total} ({pointsStatus.enriched} с карт.) · ячеек {pointsStatus.cellsLoaded} · доступно {available.size} · {game.storageNote}
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
