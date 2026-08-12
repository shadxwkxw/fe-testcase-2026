/**
 * Точка входа UMD-бандла.
 *
 * Именованные экспорты этого модуля и есть window.PokeMapWidget: UMD-обёртка
 * Vite вешает пространство имён модуля на глобальный объект под именем из
 * build.lib.name. Отдельно присваивать window.PokeMapWidget не нужно — и не
 * стоит, иначе обёртка тут же перезапишет присвоенное своим объектом.
 */
import { mount, unmount } from './runtime/registry';

export type {
  LngLat,
  PokeMapCity,
  PokeMapConfig,
  PokeMapEvent,
  PokeMapHandle,
  PokeMapWidgetApi,
  Rarity,
} from './types';

export const version: string = __WIDGET_VERSION__;
export { mount, unmount };
