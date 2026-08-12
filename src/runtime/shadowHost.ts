import baseCss from '../ui/base.css?inline';
import type { DisposeBag } from './lifecycle';

/**
 * Изоляция стилей через Shadow DOM
 *
 * Тема конструктора задаёт глобально box-sizing: content-box и max-width на
 * медиа. Селекторы host-документа не проходят за границу тени, поэтому обе
 * проблемы снимаются самим фактом монтирования внутрь shadow root — без
 * гонки специфичностей и без !important
 */
export interface ShadowHost {
  /** Контейнер внутри тени, в него рендерится React */
  readonly container: HTMLElement;
  readonly shadowRoot: ShadowRoot;
  /**
   * order: 'library' кладёт таблицу ПЕРЕД нашими стилями
   *
   * Правила библиотек и наши часто имеют одинаковую специфичность
   * (.maplibregl-map против .pokemap-map — по одному классу), и тогда исход
   * решает порядок в документе. Библиотечные идут первыми, наши последними
   */
  adoptStyles(css: string, order?: 'library' | 'widget'): void;
}

export function createShadowHost(host: HTMLElement, bag: DisposeBag): ShadowHost {
  // Тень вешается на свой узел, а не на слот конструктора: слот чужой,
  // а attachShadow на узле с уже существующей тенью бросает исключение
  const mountPoint = document.createElement('div');
  mountPoint.setAttribute('data-pokemap', '');
  host.appendChild(mountPoint);
  bag.add(() => {
    mountPoint.remove();
  });

  const shadowRoot = mountPoint.attachShadow({ mode: 'open' });

  const adoptStyles = (css: string, order: 'library' | 'widget' = 'widget'): void => {
    const style = document.createElement('style');
    style.textContent = css;

    if (order === 'library') {
      shadowRoot.insertBefore(style, shadowRoot.firstChild);
    } else {
      shadowRoot.appendChild(style);
    }

    bag.add(() => {
      style.remove();
    });
  };

  adoptStyles(baseCss);

  const container = document.createElement('div');
  container.className = 'pokemap-root';
  shadowRoot.appendChild(container);
  bag.add(() => {
    container.remove();
  });

  return { container, shadowRoot, adoptStyles };
}
