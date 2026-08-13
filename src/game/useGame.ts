import { useCallback, useEffect, useRef, useState } from 'react';

import type { GamePoint } from '../data/points';
import type { PokeMapEvent } from '../types';
import {
  INITIAL_COMBO,
  applyCollect,
  decayCombo,
  isFrozen,
  resetDeadline,
  type ComboState,
} from './combo';

export interface UseGameParams {
  readonly points: ReadonlyMap<string, GamePoint>;
  readonly onEvent: ((event: PokeMapEvent) => void) | undefined;
}

export interface UseGameResult {
  readonly score: number;
  readonly collected: ReadonlySet<string>;
  readonly multiplier: number;
  readonly frozen: boolean;
  readonly collect: (pointId: string) => void;
}

export function useGame({ points, onEvent }: UseGameParams): UseGameResult {
  const [score, setScore] = useState(0);
  const [collected, setCollected] = useState<ReadonlySet<string>>(() => new Set());
  const [combo, setCombo] = useState<ComboState>(INITIAL_COMBO);

  /*
   * Заморозка — отдельное состояние, а не вычисление в рендере
   *
   * Вариант `isFrozen(combo, Date.now())` прямо в возвращаемом объекте не
   * только делает рендер нечистым, но и просто неверен: признак обновлялся бы
   * лишь когда компонент перерисовывается по другой причине, и плашка могла
   * бы висеть уже после истечения срока
   */
  const [frozen, setFrozen] = useState(false);

  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  /*
   * Комбо сбрасывается таймером, заведённым ровно на момент истечения, а не
   * опросом по интервалу. Интервал крутился бы вхолостую всё время жизни
   * виджета — и был бы виден в счётчике setInterval панели диагностики
   */
  useEffect(() => {
    const deadline = resetDeadline(combo);
    if (!Number.isFinite(deadline)) return undefined;

    const id = window.setTimeout(
      () => {
        setCombo((prev) => decayCombo(prev, Date.now()));
      },
      Math.max(0, deadline - Date.now()),
    );
    return () => {
      window.clearTimeout(id);
    };
  }, [combo]);

  /* Снятие заморозки ровно в момент её истечения */
  useEffect(() => {
    const remaining = combo.frozenUntil - Date.now();
    if (remaining <= 0) return undefined;

    const id = window.setTimeout(() => {
      setFrozen(false);
    }, remaining);
    return () => {
      window.clearTimeout(id);
    };
  }, [combo.frozenUntil]);

  const collect = useCallback(
    (pointId: string) => {
      const point = points.get(pointId);
      if (!point || collected.has(pointId)) return;

      const now = Date.now();
      const outcome = applyCollect(combo, point.rarity, point.basePoints, now);

      setCombo(outcome.combo);
      setFrozen(isFrozen(outcome.combo, now));
      setCollected((prev) => new Set(prev).add(pointId));
      setScore((prev) => prev + outcome.awarded);

      onEventRef.current?.({
        type: 'point-collected',
        pointId,
        rarity: point.rarity,
        points: outcome.awarded,
        multiplier: outcome.multiplierUsed,
      });
    },
    [points, collected, combo],
  );

  return { score, collected, multiplier: combo.multiplier, frozen, collect };
}
