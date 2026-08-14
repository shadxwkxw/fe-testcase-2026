/**
 * Валидация описаний слоёв тем же валидатором, который использует MapLibre
 *
 * Выражения MapLibre — это данные: TypeScript проверяет их форму, но не
 * смысл. Невалидное выражение выясняется только в рантайме, когда addLayer
 * бросает исключение, а снаружи это выглядит как «карта есть, точек нет»,
 * причём слой данных при этом полностью исправен
 */
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';

import {
  POINTS_SOURCE_ID,
  RADIUS_SOURCE_ID,
  pointsLayerSpec,
  radiusFillSpec,
  radiusLineSpec,
} from '../src/map/layerSpecs';

let bad = 0;
const ok = (c: boolean, m: string): void => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m);
  if (!c) bad += 1;
};

const emptySource = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };

function styleWith(layers: unknown[]): unknown {
  return {
    version: 8,
    name: 'pokemap-check',
    sources: { [POINTS_SOURCE_ID]: emptySource, [RADIUS_SOURCE_ID]: emptySource },
    layers,
  };
}

function validate(label: string, layer: unknown): void {
  const errors = validateStyleMin(styleWith([layer]) as never);
  ok(errors.length === 0, errors.length ? `${label}: ${errors[0]?.message ?? ''}` : `${label} — валиден`);
}

console.log('Описания слоёв:');
validate('слой точек', pointsLayerSpec);
validate('заливка радиуса', radiusFillSpec);
validate('контур радиуса', radiusLineSpec);

console.log('\nВалидатор ловит ошибку, из-за которой точек бы не было:');
{
  const broken = {
    ...pointsLayerSpec,
    paint: {
      ...pointsLayerSpec.paint,
      // Вложенный zoom: interpolate не на верхнем уровне
      'circle-radius': ['*', 2, ['interpolate', ['linear'], ['zoom'], 11, 3, 19, 12]],
    },
  };
  const errors = validateStyleMin(styleWith([broken]) as never);
  ok(errors.length > 0, `вложенный ['zoom'] отвергнут: ${errors[0]?.message ?? ''}`);
}

console.log('\nЧетыре редкости и три состояния:');
{
  const json = JSON.stringify(pointsLayerSpec);
  for (const rarity of ['legendary', 'epic', 'rare']) {
    ok(json.includes(`"${rarity}"`), `редкость ${rarity} описана`);
  }
  ok(json.includes('"collected"'), 'состояние «собрана» читается из feature-state');
  ok(json.includes('"available"'), 'состояние «доступна» читается из feature-state');
}

console.log(bad ? `\n${bad} проверок провалено` : '\nВсе проверки пройдены');
if (bad) process.exitCode = 1;
