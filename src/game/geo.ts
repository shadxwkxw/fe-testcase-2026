import type { LngLat } from '../types';

/**
 * Средний радиус Земли по IUGG, метры
 *
 * Формула гаверсинуса считает по сфере, а не по эллипсоиду. На дистанциях
 * радиуса сбора погрешность сферической модели — доли процента, что заведомо
 * точнее самих координат из Википедии
 */
const EARTH_RADIUS_M = 6_371_008.8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Расстояние между двумя точками в метрах
 *
 * Считать «на глаз» через разность градусов нельзя: градус долготы на широте
 * Москвы почти вдвое короче градуса широты, и радиус сбора получился бы
 * эллипсом, вытянутым по вертикали
 */
export function haversineMeters(a: LngLat, b: LngLat): number {
  const [lngA, latA] = a;
  const [lngB, latB] = b;

  const dLat = toRadians(latB - latA);
  const dLng = toRadians(lngB - lngA);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);

  const h =
    sinLat * sinLat + Math.cos(toRadians(latA)) * Math.cos(toRadians(latB)) * sinLng * sinLng;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
