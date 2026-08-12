import { useEffect, useState, type RefObject } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';

/**
 * Геометрия виджета в недружественном окружении: режимы B и C
 *
 * РЕЖИМ B — ширина полотна меняется без события resize у окна.
 *   ResizeObserver на контейнере ловит это сам, независимо от причины
 *
 * РЕЖИМ C — transform: scale() на предке.
 *   transform не влияет на вёрстку, поэтому clientWidth контейнера остаётся
 *   в CSS-пикселях и MapLibre верстает холст по нему. Но на экран этот холст
 *   попадает увеличенным в scale раз — при 125% каждый CSS-пиксель
 *   растягивается на 1.25 физических, и карта выглядит замыленной
 *
 *   Лечится не контр-трансформом, а плотностью отрисовки: просим MapLibre
 *   рисовать с pixelRatio = devicePixelRatio × scale
 *
 *   Координаты указателя чинить НЕ нужно: MapLibre 5 делает это сам —
 *   DOM.getScale() считает rect.width / offsetWidth и делит на это смещения
 */

const MAX_PIXEL_RATIO = 4;

/**
 * Накопленный масштаб предков
 *
 * rect.width уже включает все transform выше по дереву, offsetWidth — нет,
 * поэтому их отношение и есть искомый коэффициент
 */
export function readHostScale(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  const layoutWidth = element.offsetWidth;
  if (layoutWidth <= 0 || rect.width <= 0) return 1;

  const scale = rect.width / layoutWidth;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** Возвращает текущий масштаб — он нужен нашей вёрстке поверх карты */
export function useHostGeometry(
  map: MapLibreMap | null,
  containerRef: RefObject<HTMLElement | null>,
): number {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const container = containerRef.current;
    if (!map || !container) return undefined;

    const sync = (): void => {
      const nextScale = readHostScale(container);
      setScale((prev) => (Math.abs(prev - nextScale) > 0.001 ? nextScale : prev));

      // Округление до сотых: rect.width дробная, offsetWidth целая, их
      // отношение даёт 1.25028… вместо 1.25. Без округления каждый ресайз
      // давал бы чуть новое значение и лишний повод перевыделить холст
      const targetRatio = Math.min(
        Math.round((window.devicePixelRatio || 1) * nextScale * 100) / 100,
        MAX_PIXEL_RATIO,
      );

      // setPixelRatio перевыделяет бэкинг-стор — только при реальном изменении
      if (Math.abs(map.getPixelRatio() - targetRatio) > 0.01) {
        map.setPixelRatio(targetRatio);
      }

      map.resize();
    };

    const observer = new ResizeObserver(sync);
    observer.observe(container);

    // Дополнительно к наблюдателю: раскладка могла поехать без изменения
    // размеров контейнера. Явные парные вызовы — см. runtime/lifecycle.ts
    const onLayoutChanged = (): void => {
      sync();
    };
    window.addEventListener('cms:layout-changed', onLayoutChanged);

    sync();

    return () => {
      observer.disconnect();
      window.removeEventListener('cms:layout-changed', onLayoutChanged);
    };
  }, [map, containerRef]);

  return scale;
}
