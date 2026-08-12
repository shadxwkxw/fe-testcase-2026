import type { CellBBox } from './grid';
import { fetchJson } from './httpClient';
import { basePointsFor, classifyRarity, isPlayableType, type GamePoint } from './points';

const GEOSEARCH_LIMIT = 500;

export interface FetchCellResult {
  readonly points: readonly GamePoint[];
  /** Источник вернул ровно лимит — значит часть точек мы не увидели */
  readonly saturated: boolean;
}

/**
 * ПОЧЕМУ list=geosearch, А НЕ generator=geosearch
 *
 * В docs/DATA.MD предложен generator вместе с prop=coordinates|pageimages.
 * На практике MediaWiki ограничивает разрешение prop-модулей независимо от
 * ggslimit. Замер на ячейке вокруг Кремля: 497 страниц в выдаче и координаты
 * ровно у 10 из них, остальное за токеном cocontinue
 *
 * list=geosearch отдаёт lat/lon/type прямо в результатах: те же 497 точек
 * приходят одним запросом, continue пустой. Картинки этот режим не
 * возвращает — они догружаются отдельно и лениво
 *
 * bbox вместо gscoord/gsradius: ячейки прямоугольные, вписанный круг оставил
 * бы дыры по углам, описанный — перекрытия и повторную выдачу
 */
export function buildGeoSearchUrl(apiBaseUrl: string, bbox: CellBBox): string {
  const url = new URL(`${apiBaseUrl}/w/api.php`);
  url.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    // Без origin=* Википедия не отдаёт CORS-заголовки
    origin: '*',
    formatversion: '2',
    list: 'geosearch',
    // Порядок именно такой: top|left|bottom|right
    gsbbox: `${bbox.top}|${bbox.left}|${bbox.bottom}|${bbox.right}`,
    gslimit: String(GEOSEARCH_LIMIT),
    gsprop: 'type|dim',
  }).toString();
  return url.toString();
}

export async function fetchCellPoints(
  apiBaseUrl: string,
  bbox: CellBBox,
  signal: AbortSignal,
): Promise<FetchCellResult> {
  // Через общую очередь: темп, паузы и повторы на 429 живут в httpClient
  return parseGeoSearchPayload(await fetchJson(buildGeoSearchUrl(apiBaseUrl, bbox), signal));
}

/**
 * Разбор ответа
 *
 * Ничему во входных данных не доверяем: type приходит строкой, null и вовсе
 * отсутствующим; при ошибке вместо query приходит error; отдельные записи
 * бывают неполными. Кривая запись пропускается молча, исключение бросается
 * только когда непригоден ответ целиком
 */
export function parseGeoSearchPayload(payload: unknown): FetchCellResult {
  if (!isRecord(payload)) throw new Error('GeoSearch вернул не объект');

  if (isRecord(payload.error)) {
    const info = typeof payload.error.info === 'string' ? payload.error.info : 'неизвестная ошибка';
    throw new Error(`GeoSearch: ${info}`);
  }

  const query = payload.query;
  // Пустая выдача — норма: в ячейке может не быть ни одной статьи
  if (!isRecord(query)) return { points: [], saturated: false };

  const raw = query.geosearch;
  const entries: unknown[] = Array.isArray(raw) ? raw : [];

  const points: GamePoint[] = [];
  for (const entry of entries) {
    const point = toGamePoint(entry);
    if (point) points.push(point);
  }

  return { points, saturated: entries.length >= GEOSEARCH_LIMIT };
}

function toGamePoint(entry: unknown): GamePoint | null {
  if (!isRecord(entry)) return null;

  const pageid = entry.pageid;
  const title = entry.title;
  if (typeof pageid !== 'number' || typeof title !== 'string') return null;

  const lat = entry.lat;
  const lng = entry.lon;
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  // type бывает строкой, null и отсутствующим — все три случая к undefined
  const type = typeof entry.type === 'string' ? entry.type : undefined;
  if (!isPlayableType(type)) return null;

  // Миниатюра пока неизвестна: редкость предварительная, по типу
  const rarity = classifyRarity(type, false);

  return {
    id: String(pageid),
    title,
    description: undefined,
    lng,
    lat,
    type,
    rarity,
    basePoints: basePointsFor(rarity),
    thumbnailUrl: undefined,
    enriched: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
