import { COMBO } from '../config';
import type { Rarity } from '../types';

/**
 * Комбо-множитель
 *
 * Правила из README:
 *   — каждый сбор увеличивает множитель на +0.2, потолок ×3.0
 *   — множитель сбрасывается в ×1.0 через 10 секунд после последнего сбора
 *   — сбор epic или legendary замораживает комбо на 30 секунд
 *
 * ДВА МЕСТА, ГДЕ ФОРМУЛИРОВКА ДОПУСКАЕТ РАЗНОЕ ЧТЕНИЕ. Оба пойдут в
 * DECISIONS.md.
 *
 * 1. «Итоговые очки = базовые × текущий множитель» — текущий до или после
 *    инкремента? Принято: очки начисляются по множителю, действовавшему В
 *    МОМЕНТ сбора, а увеличение применяется к следующей точке. Значит первый
 *    сбор в серии идёт по ×1.0. Это привычная семантика комбо: множитель —
 *    награда за серию, а не за её начало
 *
 * 2. Что делает заморозка. Принято: она замораживает НАЧИСЛЕНИЕ множителя —
 *    30 секунд он стоит на своём значении. Не растёт от новых сборов и не
 *    сбрасывается по таймауту. Сам сбор epic/legendary при этом ещё успевает
 *    дать +0.2: в момент этого сбора заморозки ещё не было, она начинается
 *    после него
 *
 *    Очки во время заморозки начисляются как обычно, по замороженному
 *    множителю — заморожен множитель, а не начисление очков
 *
 * Время приходит параметром, никаких таймеров внутри — поэтому поведение
 * целиком воспроизводимо в тестах
 */
export interface ComboState {
  readonly multiplier: number;
  /** Метка времени последнего сбора, мс */
  readonly lastCollectAt: number;
  /** До какого момента комбо защищено от сброса. 0 — не заморожено */
  readonly frozenUntil: number;
}

export const INITIAL_COMBO: ComboState = {
  multiplier: 1,
  lastCollectAt: 0,
  frozenUntil: 0,
};

/** Момент, когда комбо должно обнулиться */
export function resetDeadline(state: ComboState): number {
  if (state.multiplier <= 1) return Number.POSITIVE_INFINITY;
  // Заморозка не даёт сбросить комбо раньше своего окончания
  return Math.max(state.lastCollectAt + COMBO.resetAfterMs, state.frozenUntil);
}

export function decayCombo(state: ComboState, now: number): ComboState {
  return now >= resetDeadline(state) ? INITIAL_COMBO : state;
}

export function isFrozen(state: ComboState, now: number): boolean {
  return now < state.frozenUntil;
}

export interface CollectOutcome {
  readonly combo: ComboState;
  /** Начислено за эту точку: базовые × множитель, вниз */
  readonly awarded: number;
  /** Множитель, по которому посчитаны очки */
  readonly multiplierUsed: number;
}

export function applyCollect(
  state: ComboState,
  rarity: Rarity,
  basePoints: number,
  now: number,
): CollectOutcome {
  // Сначала гасим просроченное комбо, иначе очки начислились бы по
  // множителю, который на самом деле уже должен был обнулиться
  const current = decayCombo(state, now);

  const multiplierUsed = current.multiplier;
  const awarded = Math.floor(basePoints * multiplierUsed);

  // Заморожен ли множитель НА МОМЕНТ этого сбора. Проверка идёт до того, как
  // сбор успеет завести новую заморозку: иначе epic лишал бы сам себя +0.2
  const alreadyFrozen = isFrozen(current, now);

  // Округление до десятых обязательно: 1 + 0.2 + 0.2 в double даёт
  // 1.4000000000000001, и множитель поехал бы хвостом в интерфейсе
  const raised = Math.round((current.multiplier + COMBO.step) * 10) / 10;

  const freezes = (COMBO.freezeRarities as readonly Rarity[]).includes(rarity);

  return {
    combo: {
      // Во время заморозки множитель стоит на месте
      multiplier: alreadyFrozen ? current.multiplier : Math.min(raised, COMBO.max),
      lastCollectAt: now,
      // Новая заморозка не может укоротить действующую
      frozenUntil: freezes
        ? Math.max(current.frozenUntil, now + COMBO.freezeMs)
        : current.frozenUntil,
    },
    awarded,
    multiplierUsed,
  };
}
