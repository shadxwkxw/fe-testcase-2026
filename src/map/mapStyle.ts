import type { StyleSpecification } from 'maplibre-gl';

export interface ResolvedStyle {
  readonly style: StyleSpecification;
  readonly url: string;
  /** Основной источник не ответил, взят запасной */
  readonly usedFallback: boolean;
}

const STYLE_TIMEOUT_MS = 8000;

/**
 * Стиль забираем сами, а не отдаём URL карте
 *
 * Если передать MapLibre ссылку, она сходит за стилем сама — но о неудаче мы
 * узнаем из события error уже после создания инстанса, и переключение на
 * запасной источник превратится в пересоздание карты. Забирая JSON заранее,
 * получаем простой перебор с таймаутом и знаем результат до создания
 */
export async function resolveMapStyle(
  urls: readonly string[],
  signal: AbortSignal,
): Promise<ResolvedStyle> {
  const failures: string[] = [];

  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    if (url === undefined) continue;

    try {
      const response = await fetch(url, {
        // Свой таймаут: зависший запрос не должен держать виджет в загрузке
        signal: AbortSignal.any([signal, AbortSignal.timeout(STYLE_TIMEOUT_MS)]),
      });

      if (!response.ok) {
        failures.push(`${url} → HTTP ${response.status}`);
        continue;
      }

      return { style: (await response.json()) as StyleSpecification, url, usedFallback: i > 0 };
    } catch (error) {
      // Отмена по unmount — не отказ источника, пробрасываем наверх
      if (signal.aborted) throw error;
      failures.push(`${url} → ${describeError(error)}`);
    }
  }

  throw new Error(`не удалось загрузить стиль карты (${failures.join('; ')})`);
}

function describeError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'таймаут';
  if (error instanceof Error) return error.message;
  return String(error);
}
