/**
 * Слой данных: таблица редкости, разбор битых ответов, сетка, геометрия
 * и живой запрос к Wikipedia GeoSearch
 *
 * Живая часть зависит от чужого сервиса и его лимитов, поэтому может дать
 * ложное падение
 */
import { circlePolygon } from '../src/game/circle';
import { haversineMeters } from '../src/game/geo';
import { CELL_SIZE_DEG, cellsForBounds } from '../src/data/grid';
import { classifyRarity, withEnrichment } from '../src/data/points';
import {
  ENRICH_BATCH_LIMIT,
  buildGeoSearchUrl,
  enrichPoints,
  fetchCellPoints,
  parseEnrichPayload,
  parseGeoSearchPayload,
} from '../src/data/wikipediaSource';

const API = 'https://ru.wikipedia.org';

let bad = 0;
const ok = (c: boolean, m: string): void => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m);
  if (!c) bad += 1;
};

console.log('Таблица редкости (docs/DATA.MD):');
ok(classifyRarity('landmark', true) === 'legendary', 'landmark + миниатюра → legendary');
ok(classifyRarity('landmark', false) === 'epic', 'landmark без миниатюры → epic');
ok(classifyRarity('edu', false) === 'epic', 'edu → epic');
ok(classifyRarity('railwaystation', true) === 'epic', 'railwaystation с миниатюрой → epic, не rare');
ok(classifyRarity('mountain', true) === 'rare', 'прочий тип с миниатюрой → rare');
ok(classifyRarity(undefined, false) === 'common', 'без типа и миниатюры → common');

console.log('\nРазбор битых ответов GeoSearch:');
const gs = (entries: unknown[]): unknown => ({ query: { geosearch: entries } });
const cases: Array<[string, unknown, number]> = [
  ['пустой объект', {}, 0],
  ['query без geosearch', { query: {} }, 0],
  ['geosearch объектом вместо массива', { query: { geosearch: {} } }, 0],
  ['запись без координат', gs([{ pageid: 1, title: 'X' }]), 0],
  ['lat строкой', gs([{ pageid: 1, title: 'X', lat: '55', lon: 37 }]), 0],
  ['lat = null', gs([{ pageid: 1, title: 'X', lat: null, lon: 37 }]), 0],
  ['координаты вне диапазона', gs([{ pageid: 1, title: 'X', lat: 999, lon: 37 }]), 0],
  ['pageid строкой', gs([{ pageid: '1', title: 'X', lat: 55.7, lon: 37.6 }]), 0],
  ['неигровой тип river', gs([{ pageid: 1, title: 'Река', lat: 55.7, lon: 37.6, type: 'river' }]), 0],
  ['type = null (реальный случай)', gs([{ pageid: 1, title: 'Башня', lat: 55.75, lon: 37.62, type: null }]), 1],
  ['битая и валидная вперемешку', gs([{ pageid: 1, title: 'X' }, { pageid: 2, title: 'Y', lat: 55.7, lon: 37.6 }]), 1],
];
for (const [name, payload, expected] of cases) {
  try {
    ok(parseGeoSearchPayload(payload).points.length === expected, `${name} → ${expected}`);
  } catch (error) {
    ok(false, `${name} → ИСКЛЮЧЕНИЕ ${String(error)}`);
  }
}
for (const [name, payload] of [
  ['ответ строкой', '<html>502</html>'],
  ['поле error от API', { error: { code: 'badvalue', info: 'Unrecognized value' } }],
] as Array<[string, unknown]>) {
  try {
    parseGeoSearchPayload(payload);
    ok(false, `${name} → исключения не было`);
  } catch {
    ok(true, `${name} → исключение брошено`);
  }
}

console.log('\nРазбор ответа обогащения:');
const enrichment = parseEnrichPayload({
  query: {
    pages: [
      { pageid: 1, thumbnail: { source: 'https://x/y.jpg' }, description: 'церковь' },
      { pageid: 2 },
      { pageid: 3, missing: true },
    ],
  },
});
ok(enrichment.get('1')?.thumbnailUrl === 'https://x/y.jpg', 'миниатюра разобрана');
ok(enrichment.has('2'), 'страница без картинки — не ошибка');
ok(enrichment.has('3'), 'отсутствующая страница попадает в результат, чтобы не просить её вечно');

console.log('\nАпгрейд редкости после обогащения:');
const base = {
  id: '1',
  title: 'X',
  description: undefined,
  lng: 37.6,
  lat: 55.7,
  rarity: 'epic' as const,
  basePoints: 60,
  thumbnailUrl: undefined,
  enriched: false,
};
const upgraded = withEnrichment({ ...base, type: 'landmark' }, { thumbnailUrl: 'u', description: 'd' });
ok(upgraded.rarity === 'legendary' && upgraded.basePoints === 150, 'landmark + картинка: epic → legendary (150)');
const rare = withEnrichment({ ...base, type: undefined, rarity: 'common', basePoints: 10 }, { thumbnailUrl: 'u', description: undefined });
ok(rare.rarity === 'rare' && rare.basePoints === 25, 'без типа + картинка: common → rare (25)');
const noImage = withEnrichment({ ...base, type: 'landmark' }, { thumbnailUrl: undefined, description: undefined });
ok(noImage.rarity === 'epic' && noImage.enriched, 'без картинки остаётся epic, но помечен обогащённым');

console.log('\nЗащита от превышения батча:');
try {
  await enrichPoints(API, new Array<string>(51).fill('1'), AbortSignal.timeout(5000));
  ok(false, '51 id должен бросить');
} catch (error) {
  ok(String(error).includes('лимите'), 'отбито своей проверкой, до сети не дошло');
}

console.log('\nСетка ячеек:');
const narrow = cellsForBounds({ north: 55.76, south: 55.75, east: 37.63, west: 37.62 }, 16);
ok(narrow.cells.length > 0 && !narrow.tooManyCells, `центр Москвы → ${narrow.cells.length} ячеек`);
const wide = cellsForBounds({ north: 60, south: 50, east: 40, west: 30 }, 16);
ok(wide.tooManyCells && wide.cells.length === 0, 'большая область → tooManyCells, запросов нет');
ok(CELL_SIZE_DEG > 0, `размер ячейки ${CELL_SIZE_DEG}°`);

console.log('\nГеометрия круга сбора:');
const centre: [number, number] = [37.6208, 55.7539];
const ring = circlePolygon(centre, 50).coordinates[0] ?? [];
const distances = ring.map((p) => haversineMeters(centre, [p[0] ?? 0, p[1] ?? 0]));
const spread = Math.max(...distances) - Math.min(...distances);
ok(Math.abs(Math.min(...distances) - 50) < 1, `все точки на 50 м от центра`);
ok(spread < 1, `это круг, а не эллипс: разброс ${spread.toFixed(2)} м`);
ok(haversineMeters([37.62, 55.0], [37.62, 56.0]) > 111_000, 'градус широты ≈ 111 км');
ok(haversineMeters([37.0, 55.75], [38.0, 55.75]) < 70_000, 'градус долготы на широте Москвы почти вдвое короче');

console.log('\nЖивой запрос к Wikipedia GeoSearch:');
const bbox = { top: 55.76, left: 37.61, bottom: 55.74, right: 37.63 };
console.log(`  ${buildGeoSearchUrl(API, bbox)}`);
try {
  const result = await fetchCellPoints(API, bbox, AbortSignal.timeout(20_000));
  ok(result.points.length > 100, `получено ${result.points.length} игровых точек`);
  ok(
    result.points.every((p) => Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180),
    'координаты в допустимом диапазоне',
  );

  const nearest = [...result.points]
    .sort((a, b) => haversineMeters(centre, [a.lng, a.lat]) - haversineMeters(centre, [b.lng, b.lat]))
    .slice(0, ENRICH_BATCH_LIMIT);
  const count = (points: readonly { rarity: string }[]): string => {
    const map = new Map<string, number>();
    for (const p of points) map.set(p.rarity, (map.get(p.rarity) ?? 0) + 1);
    return [...map].sort().map(([k, v]) => `${k}=${v}`).join(', ');
  };

  const data = await enrichPoints(API, nearest.map((p) => p.id), AbortSignal.timeout(20_000));
  const after = nearest.map((p) =>
    withEnrichment(p, data.get(p.id) ?? { thumbnailUrl: undefined, description: undefined }),
  );
  console.log(`  до обогащения:    ${count(nearest)}`);
  console.log(`  после обогащения: ${count(after)}`);
  ok(
    after.some((p) => p.rarity === 'legendary' || p.rarity === 'rare'),
    'после обогащения появились legendary/rare — таблица задействована полностью',
  );
} catch (error) {
  ok(false, `живой запрос не удался: ${String(error)}`);
}

console.log(bad ? `\n${bad} проверок провалено` : '\nВсе проверки пройдены');
if (bad) process.exitCode = 1;
