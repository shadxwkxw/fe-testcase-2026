/**
 * Сохранение прогресса в localStorage
 *
 * Три правила:
 *
 *   1. Любое обращение к localStorage в try/catch. Хранилище бывает
 *      недоступно целиком — приватный режим Safari, отключённые куки,
 *      переполненная квота. Виджет обязан работать и без сохранения
 *   2. Прочитанное считается враждебными данными. Там может лежать что
 *      угодно: чужая запись под тем же ключом, обрезанный JSON, прогресс от
 *      будущей версии виджета. Проверяется каждое поле
 *   3. Несовместимая версия не удаляется молча, а игнорируется. Если позже
 *      появится миграция, данные будут на месте
 */

const STORAGE_KEY = 'pokemap-widget/progress';
const SCHEMA_VERSION = 1;

export interface Progress {
  readonly score: number;
  readonly collected: readonly string[];
  readonly cityName: string | null;
}

export type LoadOutcome =
  | { readonly kind: 'ok'; readonly progress: Progress }
  | { readonly kind: 'empty' }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'incompatible'; readonly foundVersion: unknown }
  | { readonly kind: 'corrupt'; readonly reason: string };

export function loadProgress(): LoadOutcome {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    return { kind: 'unavailable', reason: error instanceof Error ? error.message : String(error) };
  }

  if (raw === null) return { kind: 'empty' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'corrupt', reason: 'невалидный JSON' };
  }

  if (!isRecord(parsed)) return { kind: 'corrupt', reason: 'корень не объект' };

  if (parsed.version !== SCHEMA_VERSION) {
    return { kind: 'incompatible', foundVersion: parsed.version };
  }

  const score = parsed.score;
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) {
    return { kind: 'corrupt', reason: 'поле score непригодно' };
  }

  const rawCollected = parsed.collected;
  if (!Array.isArray(rawCollected)) {
    return { kind: 'corrupt', reason: 'поле collected не массив' };
  }

  // Одна кривая запись не должна обнулить весь прогресс: отбрасываем
  // непригодные элементы, а не всю коллекцию
  const collected = rawCollected.filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );

  return {
    kind: 'ok',
    progress: {
      score: Math.floor(score),
      collected,
      cityName: typeof parsed.cityName === 'string' ? parsed.cityName : null,
    },
  };
}

export function saveProgress(progress: Progress): boolean {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: SCHEMA_VERSION, ...progress }),
    );
    return true;
  } catch {
    // Переполненная квота или недоступное хранилище — игра продолжается,
    // просто без сохранения
    return false;
  }
}

export function clearProgress(): boolean {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function describeLoadOutcome(outcome: LoadOutcome): string {
  switch (outcome.kind) {
    case 'ok':
      return `загружено: ${outcome.progress.collected.length} точек, ${outcome.progress.score} очков`;
    case 'empty':
      return 'сохранений нет';
    case 'unavailable':
      return `localStorage недоступен (${outcome.reason})`;
    case 'incompatible':
      return `несовместимая версия схемы (${String(outcome.foundVersion)}, ожидалась ${SCHEMA_VERSION})`;
    case 'corrupt':
      return `сохранение повреждено (${outcome.reason})`;
  }
}

export { SCHEMA_VERSION, STORAGE_KEY };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
