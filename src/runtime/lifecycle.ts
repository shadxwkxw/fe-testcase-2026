/**
 * Сумка для всего, что надо погасить при unmount: слушателей, таймеров, RAF
 *
 * Почему не AbortController. Он снимает слушатели сам, минуя
 * removeEventListener. А host/cms-engine.js считает утечки именно по вызовам
 * addEventListener и removeEventListener — и показал бы утечку там, где её
 * нет. Поэтому снимаем всё вручную, парными вызовами
 */

export type Disposer = () => void;

export class DisposeBag {
  private disposers: Disposer[] = [];
  private disposed = false;

  get isDisposed(): boolean {
    return this.disposed;
  }

  add(disposer: Disposer): void {
    // Сумку уже разобрали — гасим сразу, иначе ресурс повиснет навсегда
    if (this.disposed) {
      disposer();
      return;
    }
    this.disposers.push(disposer);
  }

  listenWindow<K extends keyof WindowEventMap>(
    type: K,
    handler: (event: WindowEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    window.addEventListener(type, handler as EventListener, options);
    this.add(() => {
      window.removeEventListener(type, handler as EventListener, options);
    });
  }

  listenDocument<K extends keyof DocumentEventMap>(
    type: K,
    handler: (event: DocumentEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    document.addEventListener(type, handler as EventListener, options);
    this.add(() => {
      document.removeEventListener(type, handler as EventListener, options);
    });
  }

  listenElement<T extends EventTarget>(
    target: T,
    type: string,
    handler: EventListener,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler, options);
    this.add(() => {
      target.removeEventListener(type, handler, options);
    });
  }

  timeout(handler: () => void, ms: number): void {
    const id = window.setTimeout(handler, ms);
    this.add(() => {
      window.clearTimeout(id);
    });
  }

  /** Единственный таймер, который видит панель диагностики */
  interval(handler: () => void, ms: number): void {
    const id = window.setInterval(handler, ms);
    this.add(() => {
      window.clearInterval(id);
    });
  }

  rafLoop(frame: (time: number) => void): void {
    let id = 0;
    let stopped = false;

    const step = (time: number): void => {
      if (stopped) return;
      frame(time);
      id = window.requestAnimationFrame(step);
    };

    id = window.requestAnimationFrame(step);

    // Флаг нужен вдобавок к cancelAnimationFrame: отмена может прийти между
    // кадром и планированием следующего, тогда id уже неактуален
    this.add(() => {
      stopped = true;
      window.cancelAnimationFrame(id);
    });
  }

  observe(observer: MutationObserver | ResizeObserver | IntersectionObserver): void {
    this.add(() => {
      observer.disconnect();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // В обратном порядке: сначала то, что добавили последним
    for (let i = this.disposers.length - 1; i >= 0; i -= 1) {
      try {
        this.disposers[i]?.();
      } catch (error) {
        // Один упавший disposer не должен помешать остальным
        console.error('[pokemap] disposer failed', error);
      }
    }
    this.disposers.length = 0;
  }
}
