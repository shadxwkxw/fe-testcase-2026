import type { CircleLayerSpecification, ExpressionSpecification } from 'maplibre-gl';

/**
 * Описания слоёв отдельно от React-обвязки
 *
 * Выражения MapLibre — это данные, и их можно
 * проверить валидатором из @maplibre/maplibre-gl-style-spec, не поднимая ни
 * браузера, ни карты
 */

export const POINTS_SOURCE_ID = 'pokemap-points';
export const POINTS_LAYER_ID = 'pokemap-points';

/** Четыре визуально различимых класса */
const RARITY_COLOR: ExpressionSpecification = [
  'match',
  ['get', 'rarity'],
  'legendary',
  '#ffcc33',
  'epic',
  '#b26bff',
  'rare',
  '#4da3ff',
  '#8fa3c0',
];

/** Редкое заметнее */
const RARITY_SIZE: ExpressionSpecification = [
  'match',
  ['get', 'rarity'],
  'legendary',
  1.7,
  'epic',
  1.4,
  'rare',
  1.15,
  1,
];

const IS_COLLECTED: ExpressionSpecification = ['boolean', ['feature-state', 'collected'], false];
const IS_AVAILABLE: ExpressionSpecification = ['boolean', ['feature-state', 'available'], false];

export const pointsLayerSpec: CircleLayerSpecification = {
  id: POINTS_LAYER_ID,
  type: 'circle',
  source: POINTS_SOURCE_ID,
  paint: {
    /*
     * interpolate по зуму обязан быть на ВЕРХНЕМ уровне выражения: zoom
     * допустим только как вход верхнеуровневого step или interpolate.
     * Поэтому множитель редкости уходит внутрь каждой опорной точки, а не
     * оборачивает всё выражение снаружи
     */
    'circle-radius': [
      'interpolate',
      ['linear'],
      ['zoom'],
      11,
      ['*', RARITY_SIZE, 3],
      16,
      ['*', RARITY_SIZE, 7],
      19,
      ['*', RARITY_SIZE, 12],
    ],
    // Собранные гаснут в серый, остальные красятся по редкости
    'circle-color': ['case', IS_COLLECTED, '#55617a', RARITY_COLOR],
    'circle-opacity': ['case', IS_COLLECTED, 0.4, 0.95],
    // Доступные обводятся толстым белым кольцом — третье состояние
    'circle-stroke-width': ['case', IS_AVAILABLE, 3, IS_COLLECTED, 0, 1.5],
    'circle-stroke-color': ['case', IS_AVAILABLE, '#ffffff', 'rgba(10,15,25,0.75)'],
  },
};
