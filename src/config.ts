import type { PokeMapCity } from './types';

/**
 * Центры городов из docs/DATA.MD, переставленные в порядок MapLibre
 *
 * В задании они записаны как «широта, долгота» (55.7539, 37.6208), а карта
 * ждёт [долгота, широта]. Перестановка сделана здесь один раз, дальше по
 * коду везде только формат MapLibre
 */
export const CITIES = {
  moscow: { name: 'Москва', center: [37.6208, 55.7539] },
  spb: { name: 'Санкт-Петербург', center: [30.3141, 59.9386] },
} as const satisfies Record<string, PokeMapCity>;

export type CityId = keyof typeof CITIES;

export const DEFAULT_CITY: PokeMapCity = CITIES.moscow;

/** Порядок значим: берётся первый ответивший источник */
export const STYLE_URLS = [
  'https://tiles.openfreemap.org/styles/liberty',
  'https://demotiles.maplibre.org/style.json',
] as const;

export const DEFAULT_ZOOM = 14;
