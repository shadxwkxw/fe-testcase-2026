import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { App } from '../ui/App';
import type { PokeMapConfig, PokeMapHandle } from '../types';
import { DisposeBag } from './lifecycle';
import { createShadowHost } from './shadowHost';

interface Instance {
  readonly handle: PokeMapHandle;
  readonly bag: DisposeBag;
}

/** WeakMap, а не Map: реестр не должен удерживать выброшенный из DOM узел */
const byHost = new WeakMap<HTMLElement, PokeMapHandle>();
const byHandle = new Map<PokeMapHandle, Instance>();

let handleCounter = 0;

function resolveHost(target: string | HTMLElement): HTMLElement {
  if (typeof target !== 'string') return target;

  const found = document.querySelector(target);
  if (!(found instanceof HTMLElement)) {
    throw new Error(`[pokemap] mount: контейнер не найден по селектору "${target}"`);
  }
  return found;
}

export function mount(target: string | HTMLElement, config: PokeMapConfig = {}): PokeMapHandle {
  const host = resolveHost(target);

  // Идемпотентность: повторный mount в тот же узел возвращает прежний handle
  const existing = byHost.get(host);
  if (existing) return existing;

  const handle: PokeMapHandle = {
    id: `pokemap-${(handleCounter += 1)}`,
    host,
  };

  const bag = new DisposeBag();

  // До рендера: если React упадёт, unmount всё равно найдёт что убирать
  byHost.set(host, handle);
  byHandle.set(handle, { handle, bag });
  bag.add(() => {
    byHost.delete(host);
    byHandle.delete(handle);
  });

  try {
    const shadow = createShadowHost(host, bag);

    let root: Root | null = createRoot(shadow.container);
    // Добавлен после контейнера, значит разберётся раньше него: эффекты
    // компонентов не должны убираться на уже открепленном поддереве
    bag.add(() => {
      const current = root;
      root = null;
      current?.unmount();
    });

    root.render(createElement(App, { config, shadow, bag }));
  } catch (error) {
    bag.dispose();
    throw error;
  }

  return handle;
}

export function unmount(handle: PokeMapHandle): void {
  // Молча: повторный unmount — нормальная ситуация при пересборке блока
  const instance = byHandle.get(handle);
  if (!instance) return;
  instance.bag.dispose();
}
