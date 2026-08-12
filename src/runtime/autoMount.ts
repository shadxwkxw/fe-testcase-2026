import { mount, unmountDetached } from './registry';

const SLOT_SELECTOR = '[data-widget="pokemap"]';

/**
 * Слот появляется в DOM примерно через 2 секунды после загрузки, может быть
 * удалён и создан заново. Поэтому поиск слота — не разовая проверка, а наблюдение
 *
 * Почему MutationObserver, а не событие cms:block-rendered от конструктора:
 *
 *   1. Событие — разовое уведомление. Если наш скрипт подключат позже, чем
 *      отрисуется блок, событие уже прошло и мы его не услышим.
 *      Наблюдатель плюс стартовый scan() работают при любом порядке загрузки
 *   2. Не завязываемся на конкретный API хоста. На боевой площадке события
 *      могут называться иначе или не быть вовсе, а DOM есть всегда
 */
function scan(): void {
  for (const slot of document.querySelectorAll(SLOT_SELECTOR)) {
    if (slot instanceof HTMLElement) {
      // mount идемпотентен, поэтому повторный вызов для того же узла
      // безопасен — а вызываться scan будет часто
      try {
        mount(slot);
      } catch (error) {
        console.error('[pokemap] авто-монтирование не удалось', error);
      }
    }
  }

  unmountDetached();
}

export function startAutoMount(): void {
  const observer = new MutationObserver(scan);

  const begin = (): void => {
    observer.observe(document.body, { childList: true, subtree: true });
    scan();
  };

  if (document.readyState === 'loading') {
    // Скрипт подключается синхронно и может выполниться раньше <body>,
    // а наблюдать нам нужно именно за ним
    const onReady = (): void => {
      document.removeEventListener('DOMContentLoaded', onReady);
      begin();
    };
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    begin();
  }
}
