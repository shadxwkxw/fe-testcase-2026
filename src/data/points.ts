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

export interface PointEnrichment {
  readonly thumbnailUrl: string | undefined;
  readonly description: string | undefined;
}

/**
 * Применяет догруженные данные и пересчитывает редкость
 *
 * До обогащения редкость известна только по типу, поэтому она может лишь
 * вырасти: landmark поднимется с epic до legendary, объект без типа —
 * с common до rare. Понизиться не может, потому что обе ветки таблицы,
 * зависящие от миниатюры, дают более высокий ранг
 *
 * Отсюда важное следствие: промежуточное состояние безопасно, игрок не
 * потеряет очки из-за того, что картинка приехала позже
 */
export function withEnrichment(point: GamePoint, data: PointEnrichment): GamePoint {
  const rarity = classifyRarity(point.type, data.thumbnailUrl !== undefined);
  return {
    ...point,
    description: data.description,
    thumbnailUrl: data.thumbnailUrl,
    rarity,
    basePoints: basePointsFor(rarity),
    enriched: true,
  };
}
