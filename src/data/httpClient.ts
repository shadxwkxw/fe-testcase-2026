/**
 * Единая точка выхода в сеть для слоя данных
 *
 * Наивная реализация выпускает залп на каждое движение карты: до 16 запросов
 * геометрии, а дальше ещё батчи обогащения. Википедия отвечает на такое 429,
 * причём срабатывает именно на пачки, а не на общее количество
 *
 * Три механизма, каждый закрывает свою причину отказа:
 *
 *   1. Не больше двух запросов в полёте одновременно
 *   2. Минимальный интервал между стартами — разводим даже эти два во времени
 *   3. Повтор с отступом на 429 и 5xx, пауза берётся из Retry-After
 *
 * Про User-Agent: политика Викимедиа просит опознавательный заголовок, но
 * любой нестандартный заголовок в CORS-запросе включает предварительный
 * OPTIONS. Здесь только простые запросы; решение отмечено в DECISIONS.md
 */

const MAX_CONCURRENT = 2;
const MIN_GAP_MS = 220;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 700;
const REQUEST_TIMEOUT_MS = 12_000;
/** Сервер может попросить и час, столько не ждем */
const MAX_BACKOFF_MS = 15_000;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
  }
}

/** Счётчики для отладочной панели */
export const httpStats = {
  requests: 0,
  retries: 0,
  rateLimited: 0,
};

/** Бросать что-то кроме Error — плохой тон, а fetch может отклониться чем угодно */
function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(asError(signal.reason));
      return;
    }
    const id = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(id);
      reject(asError(signal.reason));
    }
    // Слушатель на AbortSignal, а не на window/document — счётчиками конструктора не учитывается
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Пропускает не больше MAX_CONCURRENT запросов и разводит их по времени */
class Gate {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private lastStartAt = 0;

  async enter(signal: AbortSignal): Promise<void> {
    if (this.active >= MAX_CONCURRENT) {
      await new Promise<void>((resolve) => {
        this.waiting.push(resolve);
      });
    }
    if (signal.aborted) {
      this.release();
      throw asError(signal.reason);
    }

    this.active += 1;

    /*
     * Момент старта резервируется СИНХРОННО, до первого await
     *
     * Если записать lastStartAt после паузы, два вызывающих, прошедших
     * проверку одновременно, посчитают задержку от одного и того же старого
     * значения, оба получат ноль и уйдут в сеть вместе — то есть интервал не
     * сработает ровно там, где он нужен
     */
    const now = Date.now();
    const startAt = Math.max(now, this.lastStartAt + MIN_GAP_MS);
    this.lastStartAt = startAt;

    const wait = startAt - now;
    if (wait > 0) {
      try {
        await delay(wait, signal);
      } catch (error) {
        // Слот уже занят: при отмене его надо вернуть, иначе очередь
        // потеряет пропускную способность навсегда
        this.leave();
        throw error;
      }
    }
  }

  leave(): void {
    this.active -= 1;
    this.release();
  }

  private release(): void {
    this.waiting.shift()?.();
  }
}

const gate = new Gate();

/** Сначала слово сервера, потом своя экспонента */
function retryDelayMs(response: Response | null, attempt: number): number {
  const header = response?.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_BACKOFF_MS);
    }
    const date = Date.parse(header);
    if (!Number.isNaN(date)) {
      return Math.min(Math.max(0, date - Date.now()), MAX_BACKOFF_MS);
    }
  }
  // Джиттер обязателен: без него все отложенные запросы вернутся
  // одновременно и снова упрутся в лимитер
  return Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1) + Math.random() * 300, MAX_BACKOFF_MS);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/**
 * GET с очередью, ограничением темпа и повторами
 * Отмена прерывает и ожидание в очереди, и паузу между попытками
 */
export async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    await gate.enter(signal);

    let response: Response | null = null;
    let failure: unknown = null;

    try {
      httpStats.requests += 1;
      response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        headers: { accept: 'application/json' },
      });
    } catch (error) {
      failure = error;
    } finally {
      gate.leave();
    }

    if (signal.aborted) throw asError(signal.reason);

    if (response?.ok) return (await response.json()) as unknown;

    const status = response?.status ?? 0;
    if (status === 429) httpStats.rateLimited += 1;

    const retryable = failure !== null || isRetryableStatus(status);
    if (!retryable || attempt >= MAX_RETRIES) {
      if (failure !== null) throw asError(failure);
      throw new HttpError(status, url);
    }

    httpStats.retries += 1;
    await delay(retryDelayMs(response, attempt + 1), signal);
  }
}
