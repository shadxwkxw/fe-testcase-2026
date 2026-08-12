/**
 * Сетка ячеек — основа кэша и дедупликации
 *
 * Наивный подход «запросить точки вокруг центра карты» шлёт запрос на каждое
 * движение и каждый раз тянет пересекающиеся области заново. Вместо этого мир
 * нарезан на ячейки фиксированного размера. Видимая область переводится в
 * набор ячеек, запрашиваются только те, которых ещё нет в кэше
 *
 * Что это даёт:
 *   — запрос за конкретную ячейку делается один раз за сессию
 *   — возврат на посещённое место не стоит ни одного запроса
 *   — число запросов ограничено числом НОВЫХ ячеек, а не частотой событий
 *
 * Размер в градусах, а не в метрах: границы должны совпадать при любом
 * подходе к области, иначе кэш не сойдётся сам с собой. На широте Москвы
 * 0.02° — это примерно 2.2 км по вертикали и 1.25 по горизонтали
 */

export const CELL_SIZE_DEG = 0.02;

export interface CellBBox {
  readonly top: number;
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
}

export interface Cell {
  readonly id: string;
  readonly bbox: CellBBox;
}

export interface Bounds {
  readonly north: number;
  readonly south: number;
  readonly east: number;
  readonly west: number;
}

function cellIndex(value: number): number {
  return Math.floor(value / CELL_SIZE_DEG);
}

function makeCell(latIndex: number, lngIndex: number): Cell {
  const bottom = latIndex * CELL_SIZE_DEG;
  const left = lngIndex * CELL_SIZE_DEG;
  return {
    id: `${latIndex}:${lngIndex}`,
    bbox: { bottom, left, top: bottom + CELL_SIZE_DEG, right: left + CELL_SIZE_DEG },
  };
}

export interface CellsForBoundsResult {
  readonly cells: readonly Cell[];
  /** Область больше лимита: ячейки не считались, нужно приблизить карту */
  readonly tooManyCells: boolean;
}

/**
 * maxCells — предохранитель: на маленьком зуме видимая область покрывает
 * тысячи ячеек, и запрашивать их все нельзя
 */
export function cellsForBounds(bounds: Bounds, maxCells: number): CellsForBoundsResult {
  // Переход через 180-й меридиан не поддерживается: оба города задания
  // от него далеко. Ограничение отмечено в DECISIONS.md
  if (bounds.east < bounds.west) {
    return { cells: [], tooManyCells: false };
  }

  const latFrom = cellIndex(bounds.south);
  const latTo = cellIndex(bounds.north);
  const lngFrom = cellIndex(bounds.west);
  const lngTo = cellIndex(bounds.east);

  if ((latTo - latFrom + 1) * (lngTo - lngFrom + 1) > maxCells) {
    return { cells: [], tooManyCells: true };
  }

  const cells: Cell[] = [];
  for (let lat = latFrom; lat <= latTo; lat += 1) {
    for (let lng = lngFrom; lng <= lngTo; lng += 1) {
      cells.push(makeCell(lat, lng));
    }
  }

  return { cells, tooManyCells: false };
}
