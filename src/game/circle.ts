import type { Polygon } from 'geojson';

import type { LngLat } from '../types';

/**
 * Многоугольник, приближающий окружность заданного радиуса в метрах
 *
 * Почему не слой circle с circle-radius: там радиус в экранных пикселях, а
 * нам нужен радиус на местности — 50 метров должны оставаться пятьюдесятью
 * метрами при любом зуме, иначе круг врёт относительно механики
 *
 * Долгота делится на косинус широты: на широте Москвы градус долготы почти
 * вдвое короче градуса широты, и без поправки круг вышел бы эллипсом
 */
export function circlePolygon(center: LngLat, radiusMeters: number, steps = 64): Polygon {
  const [lng, lat] = center;

  const latDelta = radiusMeters / 111_320;
  const cos = Math.cos((lat * Math.PI) / 180);
  const lngDelta = radiusMeters / (111_320 * Math.max(cos, 1e-6));

  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * 2 * Math.PI;
    ring.push([lng + lngDelta * Math.cos(angle), lat + latDelta * Math.sin(angle)]);
  }

  return { type: 'Polygon', coordinates: [ring] };
}
