import { RARITY_POINTS } from '../config';
import type { Rarity } from '../types';

/** Игровая точка — то, что осталось от статьи после фильтрации */
export interface GamePoint {
  readonly id: string;
  readonly title: string;
  readonly description: string | undefined;
  readonly lng: number;
  readonly lat: number;
  /** Тип из GeoSearch. Хранится, чтобы пересчитать редкость после обогащения */
  readonly type: string | undefined;
  readonly rarity: Rarity;
  readonly basePoints: number;
  readonly thumbnailUrl: string | undefined;
  /** Известно ли про наличие миниатюры. До обогащения — false */
  readonly enriched: boolean;
}

/**
 * Типы, которые не являются точками на местности: у страны и реки есть
 * координата центра, но подойти к ней «ближе 50 метров» бессмысленно.
 * Список из docs/DATA.MD
 */
const NON_GAME_TYPES: ReadonlySet<string> = new Set([
  'country',
  'adm1st',
  'adm2nd',
  'adm3rd',
  'city',
  'waterbody',
  'river',
  'event',
]);

const EPIC_TYPES: ReadonlySet<string> = new Set(['landmark', 'edu', 'railwaystation']);

export function isPlayableType(type: string | undefined): boolean {
  return type === undefined || !NON_GAME_TYPES.has(type);
}

/**
 * Таблица редкости из docs/DATA.MD
 *
 * Порядок проверок значим — берётся первое совпадение сверху вниз, иначе
 * landmark с миниатюрой стал бы epic вместо legendary
 */
export function classifyRarity(type: string | undefined, hasThumbnail: boolean): Rarity {
  if (type === 'landmark' && hasThumbnail) return 'legendary';
  if (type !== undefined && EPIC_TYPES.has(type)) return 'epic';
  if (hasThumbnail) return 'rare';
  return 'common';
}

export function basePointsFor(rarity: Rarity): number {
  return RARITY_POINTS[rarity];
}
