/**
 * Игровая логика: комбо, слияние прогресса, хранилище
 *
 * Комбо и слияние — чистые функции с временем в параметре, поэтому здесь нет
 * ни одного ожидания: «прошло 30 секунд» это просто другое число
 */
import { INITIAL_COMBO, applyCollect, decayCombo, isFrozen, type ComboState } from '../src/game/combo';
import {
  EMPTY_PROGRESS,
  mergeProgress,
  progressFromRecords,
  scoreOf,
  withRecord,
  withReset,
  type CollectRecord,
  type ProgressState,
} from '../src/game/progress';

/* localStorage в Node нет — подставляем управляемую заглушку до импорта
   модуля хранилища, он обращается к window.localStorage */
const stub = { store: new Map<string, string>(), throwOnGet: false, throwOnSet: false };
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem(key: string): string | null {
      if (stub.throwOnGet) throw new Error('доступ запрещён');
      return stub.store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      if (stub.throwOnSet) throw new Error('квота исчерпана');
      stub.store.set(key, value);
    },
    removeItem(key: string): void {
      stub.store.delete(key);
    },
  },
};

const { STORAGE_KEY, clearProgress, loadProgress, saveProgress } = await import('../src/game/storage');

let bad = 0;
const ok = (c: boolean, m: string): void => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m);
  if (!c) bad += 1;
};

const S = 1000;
const rec = (id: string, awarded: number, at: number, by: string): CollectRecord => ({
  pointId: id,
  awarded,
  at,
  by,
});
const fingerprint = (state: ProgressState): string =>
  JSON.stringify({
    resetAt: state.resetAt,
    records: [...state.records.values()]
      .sort((a, b) => a.pointId.localeCompare(b.pointId))
      .map((r) => [r.pointId, r.awarded, r.at, r.by]),
  });

console.log('Комбо — начисление:');
const first = applyCollect(INITIAL_COMBO, 'common', 10, 0);
ok(first.multiplierUsed === 1 && first.awarded === 10, 'первый сбор по x1.0 → 10 очков');
ok(first.combo.multiplier === 1.2, 'после него x1.2');
ok(applyCollect(first.combo, 'common', 10, S).awarded === 12, 'второй по x1.2 → 12 очков');

console.log('\nОкругление множителя (ловушка double):');
let state: ComboState = INITIAL_COMBO;
const sequence: number[] = [];
for (let i = 0; i < 5; i += 1) {
  state = applyCollect(state, 'common', 10, i * S).combo;
  sequence.push(state.multiplier);
}
ok(JSON.stringify(sequence) === JSON.stringify([1.2, 1.4, 1.6, 1.8, 2]), `без хвостов: ${sequence.join(', ')}`);

console.log('\nПотолок и округление очков вниз:');
let capped: ComboState = INITIAL_COMBO;
for (let i = 0; i < 30; i += 1) capped = applyCollect(capped, 'common', 10, i * S).combo;
ok(capped.multiplier === 3, `после 30 сборов x${capped.multiplier}`);
ok(applyCollect({ ...INITIAL_COMBO, multiplier: 1.2 }, 'common', 33, 0).awarded === 39, '33 x 1.2 = 39.6 → 39');

console.log('\nСброс через 10 секунд:');
const one = applyCollect(INITIAL_COMBO, 'common', 10, 0).combo;
ok(decayCombo(one, 9 * S).multiplier === 1.2, 'через 9 с держится');
ok(decayCombo(one, 10 * S).multiplier === 1, 'через 10 с сброшено');
ok(applyCollect(one, 'common', 10, 11 * S).multiplierUsed === 1, 'сбор после просрочки идёт по x1.0');

console.log('\nЗаморозка останавливает рост множителя:');
const epic = applyCollect(INITIAL_COMBO, 'epic', 60, 0);
ok(epic.combo.multiplier === 1.2, 'сам epic ещё успевает поднять до x1.2');
ok(isFrozen(epic.combo, 29 * S) && !isFrozen(epic.combo, 31 * S), 'активна на 29-й, снята на 31-й');
const during = applyCollect(epic.combo, 'common', 10, 5 * S);
ok(during.combo.multiplier === 1.2, 'сбор во время заморозки НЕ поднял множитель');
ok(during.awarded === 12, 'но очки начислены по замороженному x1.2');
ok(decayCombo(epic.combo, 15 * S).multiplier === 1.2, 'на 15-й секунде живо, хотя 10 с прошло');
const extended = applyCollect(epic.combo, 'legendary', 150, 20 * S);
ok(extended.combo.frozenUntil === 50 * S, 'новый legendary продлевает заморозку до 50-й секунды');

console.log('\nСчёт выводится из журнала:');
const journal = progressFromRecords([rec('a', 10, 1000, 't1'), rec('b', 150, 2000, 't1')]);
ok(scoreOf(journal) === 160, `сумма журнала = ${scoreOf(journal)}`);
ok(scoreOf(withRecord(journal, rec('a', 999, 5000, 't2'))) === 160, 'дубликат не начисляет повторно');

console.log('\nКонфликт между вкладками:');
const early = rec('x', 10, 1000, 'tabB');
const late = rec('x', 60, 2000, 'tabA');
const order1 = withRecord(withRecord(EMPTY_PROGRESS, early), late);
const order2 = withRecord(withRecord(EMPTY_PROGRESS, late), early);
ok(order1.records.get('x')?.at === 1000, 'побеждает более ранний сбор');
ok(fingerprint(order1) === fingerprint(order2), 'результат не зависит от порядка сообщений');
const tie1 = withRecord(withRecord(EMPTY_PROGRESS, rec('y', 10, 1000, 'aaa')), rec('y', 60, 1000, 'zzz'));
ok(tie1.records.get('y')?.by === 'aaa', 'при равном времени побеждает меньший id вкладки');

console.log('\nСвойства слияния:');
const tabA = progressFromRecords([rec('1', 10, 1000, 'A'), rec('3', 25, 1500, 'A')]);
const tabB = progressFromRecords([rec('4', 60, 1200, 'B'), rec('3', 150, 1800, 'B')]);
const tabC = progressFromRecords([rec('5', 10, 900, 'C')]);
ok(fingerprint(mergeProgress(tabA, tabB)) === fingerprint(mergeProgress(tabB, tabA)), 'коммутативность');
ok(fingerprint(mergeProgress(tabA, tabA)) === fingerprint(tabA), 'идемпотентность');
ok(
  fingerprint(mergeProgress(mergeProgress(tabA, tabB), tabC)) ===
    fingerprint(mergeProgress(tabA, mergeProgress(tabB, tabC))),
  'ассоциативность',
);
const merged = mergeProgress(tabA, tabB);
ok(merged.records.size === 3 && scoreOf(merged) === 95, `общая точка не задвоилась, счёт ${scoreOf(merged)}`);

console.log('\nСброс — отметка времени, а не удаление:');
const before = progressFromRecords([rec('a', 10, 1000, 'A'), rec('b', 60, 2000, 'A')]);
const after = withReset(before, 3000);
ok(after.records.size === 0, 'сброс обнуляет счёт');
ok(withRecord(after, rec('c', 25, 2500, 'B')).records.size === 0, 'запоздавшая запись не воскрешает прогресс');
ok(withRecord(after, rec('d', 25, 4000, 'B')).records.size === 1, 'сбор ПОСЛЕ сброса засчитывается');
ok(
  withReset(withRecord(EMPTY_PROGRESS, rec('e', 10, 5000, 'A')), 4000).records.size === 1,
  'поздний сброс не затирает более свежий сбор',
);

console.log('\nХранилище — нормальный цикл:');
stub.store.clear();
ok(loadProgress().kind === 'empty', 'пустое хранилище → empty');
const saved = progressFromRecords([rec('1', 150, 1000, 'A'), rec('2', 25, 2000, 'A')]);
saveProgress(saved, 'Москва');
const loaded = loadProgress();
ok(loaded.kind === 'ok' && fingerprint(loaded.progress) === fingerprint(saved), 'сохранение и загрузка совпадают');
ok(loaded.kind === 'ok' && scoreOf(loaded.progress) === 175, 'счёт пересчитан из журнала');
clearProgress();
ok(loadProgress().kind === 'empty', 'сброс очищает хранилище');

console.log('\nХранилище — враждебные данные:');
const cases: Array<[string, string, string]> = [
  ['обрезанный JSON', '{"version":2,"collected":[', 'corrupt'],
  ['корень массивом', '[1,2,3]', 'corrupt'],
  ['корень строкой', '"привет"', 'corrupt'],
  ['версия из будущего', '{"version":99,"collected":[]}', 'incompatible'],
  ['версии нет', '{"collected":[]}', 'incompatible'],
  ['старая схема v1', '{"version":1,"score":10,"collected":["1"]}', 'incompatible'],
  ['collected не массив', '{"version":2,"collected":{}}', 'corrupt'],
];
for (const [name, raw, expected] of cases) {
  stub.store.set(STORAGE_KEY, raw);
  let kind: string;
  try {
    kind = loadProgress().kind;
  } catch (error) {
    kind = `ИСКЛЮЧЕНИЕ ${String(error)}`;
  }
  ok(kind === expected, `${name} → ${kind}`);
}

console.log('\nЧастично битые записи не обнуляют прогресс:');
stub.store.set(
  STORAGE_KEY,
  JSON.stringify({
    version: 2,
    resetAt: 0,
    collected: [
      rec('1', 150, 1000, 'A'),
      null,
      42,
      { pointId: '2' },
      { pointId: '3', awarded: 'много', at: 1, by: 'A' },
      { pointId: '4', awarded: -5, at: 1, by: 'A' },
      rec('5', 25, 2000, 'A'),
    ],
  }),
);
const partial = loadProgress();
ok(partial.kind === 'ok' && partial.progress.records.size === 2, 'мусор отброшен, валидное сохранено');

console.log('\nНедоступное хранилище:');
stub.throwOnGet = true;
ok(loadProgress().kind === 'unavailable', 'бросающий getItem → unavailable, а не падение');
stub.throwOnGet = false;
stub.throwOnSet = true;
ok(saveProgress(EMPTY_PROGRESS, null) === false, 'исчерпанная квота → false, без исключения');

console.log(bad ? `\n${bad} проверок провалено` : '\nВсе проверки пройдены');
if (bad) process.exitCode = 1;
