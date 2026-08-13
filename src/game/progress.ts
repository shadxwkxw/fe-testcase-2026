/**
 * Модель прогресса и слияние состояний из разных вкладок
 *
 * ГЛАВНОЕ РЕШЕНИЕ: счёт не хранится, а выводится
 *
 * Пара «множество собранных + число очков» при синхронизации не сводится.
 * Если вкладка A набрала 100 на точках 1,2,3, а вкладка B — 60 на точках 3,4,
 * то максимум занижает, сумма считает точку 3 дважды, а правильного ответа
 * просто нет: в числе 100 не написано, из чего оно сложилось
 *
 * Поэтому состояние — ЖУРНАЛ сборов: по записи на точку, в записи лежит
 * начисленное. Счёт равен сумме журнала. Журналы сливаются поточечно, счёт
 * пересчитывается сам и не может разойтись с содержимым
 *
 * ПРАВИЛО СЛИЯНИЯ для одной точки: побеждает более РАННИЙ сбор, при равном
 * времени — меньший идентификатор вкладки. Это даёт три свойства, без
 * которых синхронизация не сходится:
 *
 *   — коммутативность: порядок прихода сообщений не важен
 *   — идемпотентность: повторная доставка ничего не меняет
 *   — ассоциативность: группировка обменов не важна
 *
 * Сброс — не удаление записей (они прилетят снова из другой вкладки), а
 * отметка времени: записи старше resetAt игнорируются
 */

export interface CollectRecord {
  readonly pointId: string;
  /** Начислено с учётом комбо на момент сбора */
  readonly awarded: number;
  readonly at: number;
  /** Идентификатор вкладки, выполнившей сбор */
  readonly by: string;
}

export interface ProgressState {
  readonly records: ReadonlyMap<string, CollectRecord>;
  /** Всё, собранное не позже этого момента, считается сброшенным */
  readonly resetAt: number;
}

export const EMPTY_PROGRESS: ProgressState = { records: new Map(), resetAt: 0 };

export function scoreOf(state: ProgressState): number {
  let total = 0;
  for (const record of state.records.values()) total += record.awarded;
  return total;
}

/** Побеждает более ранний сбор; при равенстве — меньший id вкладки */
export function preferred(a: CollectRecord, b: CollectRecord): CollectRecord {
  if (a.at !== b.at) return a.at < b.at ? a : b;
  return a.by <= b.by ? a : b;
}

export function withRecord(state: ProgressState, record: CollectRecord): ProgressState {
  // Запись из «прошлой жизни» — до последнего сброса
  if (record.at <= state.resetAt) return state;

  const existing = state.records.get(record.pointId);
  const winner = existing ? preferred(existing, record) : record;
  if (existing && winner === existing) return state;

  const records = new Map(state.records);
  records.set(record.pointId, winner);
  return { records, resetAt: state.resetAt };
}

export function withReset(state: ProgressState, at: number): ProgressState {
  if (at <= state.resetAt) return state;

  // Сборы ПОСЛЕ момента сброса переживают его: иначе поздний сброс из
  // соседней вкладки затирал бы то, что уже успели собрать здесь
  const records = new Map<string, CollectRecord>();
  for (const [id, record] of state.records) {
    if (record.at > at) records.set(id, record);
  }
  return { records, resetAt: at };
}

/** Коммутативно, идемпотентно, ассоциативно */
export function mergeProgress(a: ProgressState, b: ProgressState): ProgressState {
  let merged: ProgressState = { records: new Map(), resetAt: Math.max(a.resetAt, b.resetAt) };
  for (const record of a.records.values()) merged = withRecord(merged, record);
  for (const record of b.records.values()) merged = withRecord(merged, record);
  return merged;
}

export function progressFromRecords(
  records: readonly CollectRecord[],
  resetAt = 0,
): ProgressState {
  let state: ProgressState = { records: new Map(), resetAt };
  for (const record of records) state = withRecord(state, record);
  return state;
}

/** Проверка записи, пришедшей извне: из localStorage или из другой вкладки */
export function isCollectRecord(value: unknown): value is CollectRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['pointId'] === 'string' &&
    record['pointId'].length > 0 &&
    typeof record['awarded'] === 'number' &&
    Number.isFinite(record['awarded']) &&
    record['awarded'] >= 0 &&
    typeof record['at'] === 'number' &&
    Number.isFinite(record['at']) &&
    typeof record['by'] === 'string'
  );
}
