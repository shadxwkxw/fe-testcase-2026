import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
import { clearProgress, describeLoadOutcome, loadProgress, saveProgress } from './storage';

/** Задержка записи: серия сборов не должна давать серию записей на диск */
const SAVE_DEBOUNCE_MS = 400;

export interface UseGameParams {
  readonly points: ReadonlyMap<string, GamePoint>;
  readonly cityName: string;
  readonly onEvent: ((event: PokeMapEvent) => void) | undefined;
}

export interface UseGameResult {
  readonly score: number;
  readonly collected: ReadonlySet<string>;
  readonly multiplier: number;
  readonly frozen: boolean;
  /** Что произошло при загрузке сохранения — для отладочной панели */
  readonly storageNote: string;
  readonly collect: (pointId: string) => void;
  readonly reset: () => void;
}

export function useGame({ points, cityName, onEvent }: UseGameParams): UseGameResult {
  // Читаем хранилище один раз при инициализации, а не в эффекте: иначе первый
  // кадр показал бы нули, а следом дёрнулся на сохранённое
  const initial = useMemo(() => loadProgress(), []);

  const [score, setScore] = useState(() => (initial.kind === 'ok' ? initial.progress.score : 0));
  const [collected, setCollected] = useState<ReadonlySet<string>>(
    () => new Set(initial.kind === 'ok' ? initial.progress.collected : []),
  );
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

  const storageNote = useMemo(() => describeLoadOutcome(initial), [initial]);

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

  /* Сохранение с дебаунсом */
  useEffect(() => {
    const id = window.setTimeout(() => {
      saveProgress({ score, collected: [...collected], cityName });
    }, SAVE_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(id);
    };
  }, [score, collected, cityName]);

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

  const reset = useCallback(() => {
    clearProgress();
    setScore(0);
    setCollected(new Set());
    setCombo(INITIAL_COMBO);
    setFrozen(false);
    onEventRef.current?.({ type: 'progress-reset' });
  }, []);

  return { score, collected, multiplier: combo.multiplier, frozen, storageNote, collect, reset };
}
