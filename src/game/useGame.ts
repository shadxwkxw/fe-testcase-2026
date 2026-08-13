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
import {
  EMPTY_PROGRESS,
  mergeProgress,
  progressFromRecords,
  scoreOf,
  withRecord,
  withReset,
  type CollectRecord,
  type ProgressState,
} from './progress';
import { clearProgress, describeLoadOutcome, loadProgress, saveProgress } from './storage';
import { useTabSync } from './useTabSync';

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
  readonly storageNote: string;
  readonly collect: (pointId: string) => void;
  readonly reset: () => void;
}

export function useGame({ points, cityName, onEvent }: UseGameParams): UseGameResult {
  // Читаем хранилище один раз при инициализации, а не в эффекте: иначе первый
  // кадр показал бы нули, а следом счёт дёрнулся бы на сохранённый
  const initial = useMemo(() => loadProgress(), []);

  const [progress, setProgress] = useState<ProgressState>(() =>
    initial.kind === 'ok' ? initial.progress : EMPTY_PROGRESS,
  );
  const [combo, setCombo] = useState<ComboState>(INITIAL_COMBO);

  /*
   * Заморозка — отдельное состояние, а не вычисление в рендере: иначе признак
   * обновлялся бы лишь при случайных перерисовках, и плашка могла бы висеть
   * уже после истечения срока
   */
  const [frozen, setFrozen] = useState(false);

  const storageNote = useMemo(() => describeLoadOutcome(initial), [initial]);

  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  // Нужен только для ответа соседней вкладке на hello — отставание на один
  // рендер здесь безразлично, слияние всё равно идемпотентно
  const progressRef = useRef(progress);
  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  /* --- синхронизация между вкладками -------------------------------- */
  const sync = useTabSync({
    onRecord: (record) => {
      setProgress((prev) => withRecord(prev, record));
    },
    onReset: (at) => {
      setProgress((prev) => withReset(prev, at));
      setCombo(INITIAL_COMBO);
      setFrozen(false);
    },
    getState: () => progressRef.current,
    onState: (records, resetAt) => {
      // Состояние соседа сливается с нашим, а не заменяет его: пока мы ждали
      // ответа, здесь могли что-то собрать
      setProgress((prev) => mergeProgress(prev, progressFromRecords(records, resetAt)));
    },
  });

  /*
   * Комбо сбрасывается таймером на точный момент истечения, а не опросом по
   * интервалу. Комбо намеренно НЕ синхронизируется между вкладками: это темп
   * игры конкретного окна, а не часть прогресса
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
      saveProgress(progress, cityName);
    }, SAVE_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(id);
    };
  }, [progress, cityName]);

  const score = useMemo(() => scoreOf(progress), [progress]);
  const collected = useMemo(() => new Set(progress.records.keys()), [progress]);

  const collect = useCallback(
    (pointId: string) => {
      const point = points.get(pointId);
      if (!point || progress.records.has(pointId)) return;

      const now = Date.now();
      const outcome = applyCollect(combo, point.rarity, point.basePoints, now);

      const record: CollectRecord = {
        pointId,
        awarded: outcome.awarded,
        at: now,
        by: sync.instanceId,
      };

      setCombo(outcome.combo);
      setFrozen(isFrozen(outcome.combo, now));
      setProgress((prev) => withRecord(prev, record));
      sync.publishRecord(record);

      onEventRef.current?.({
        type: 'point-collected',
        pointId,
        rarity: point.rarity,
        points: outcome.awarded,
        multiplier: outcome.multiplierUsed,
      });
    },
    [points, progress, combo, sync],
  );

  const reset = useCallback(() => {
    const at = Date.now();
    clearProgress();
    setProgress((prev) => withReset(prev, at));
    setCombo(INITIAL_COMBO);
    setFrozen(false);
    sync.publishReset(at);
    onEventRef.current?.({ type: 'progress-reset' });
  }, [sync]);

  return { score, collected, multiplier: combo.multiplier, frozen, storageNote, collect, reset };
}
