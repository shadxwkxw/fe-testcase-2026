import { createRoot } from 'react-dom/client';

/**
 * Прогрев React до снятия baseline
 *
 * React при создании первого корня один раз за документ вешает слушатель
 * selectionchange на document и никогда его не снимает — ни при unmount
 * корня, ни при создании следующих. Это цена уровня документа, а не утечка
 * на экземпляр: стресс-тест её не накапливает
 *
 * Но движок снимает baseline на 1900 мс, а слот появляется на 2200 мс.
 * Без прогрева эта разовая цена попадает в дельту и выглядит нашей утечкой
 *
 * Создаём и сразу гасим пустой корень на открепленном узле при загрузке
 * скрипта: слушатель регистрируется до baseline и учитывается в нём
 */
export function warmUpReact(): void {
  try {
    const scratch = document.createElement('div');
    const root = createRoot(scratch);
    root.render(null);
    root.unmount();
  } catch (error) {
    // Прогрев влияет только на показания диагностики, но не на работу
    console.warn('[pokemap] прогрев React не удался', error);
  }
}
