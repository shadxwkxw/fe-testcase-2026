/**
 * Публичный контракт виджета
 *
 * PokeMapConfig и сигнатуры mount/unmount взяты из README дословно.
 * PokeMapEvent и PokeMapHandle там не расписаны — их форма выбрана нами
 */

/** [долгота, широта] — порядок MapLibre. В docs/DATA.MD центры записаны наоборот */
export type LngLat = readonly [lng: number, lat: number];

export interface PokeMapCity {
  readonly name: string;
  readonly center: LngLat;
}

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface PokeMapConfig {
  city?: PokeMapCity;
  collectRadiusMeters?: number;
  apiBaseUrl?: string;
  onEvent?: (event: PokeMapEvent) => void;
}

/** Объединение по `type`: хост сузит тип и получит только нужные поля */
export type PokeMapEvent =
  | { type: 'ready'; version: string }
  | { type: 'error'; scope: 'map' | 'data' | 'storage'; message: string }
  | { type: 'point-collected'; pointId: string; rarity: Rarity; points: number; multiplier: number }
  | { type: 'point-selected'; pointId: string }
  | { type: 'score-changed'; score: number; collected: number }
  | { type: 'city-changed'; city: PokeMapCity }
  | { type: 'progress-reset' };

/** Хост получает его из mount() и отдаёт обратно в unmount() */
export interface PokeMapHandle {
  readonly id: string;
  readonly host: HTMLElement;
}

export interface PokeMapWidgetApi {
  readonly version: string;
  mount(target: string | HTMLElement, config?: PokeMapConfig): PokeMapHandle;
  unmount(handle: PokeMapHandle): void;
}

declare global {
  interface Window {
    PokeMapWidget: PokeMapWidgetApi;
  }
}
