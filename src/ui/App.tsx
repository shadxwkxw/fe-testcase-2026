import { useEffect } from 'react';

import type { PokeMapConfig } from '../types';
import type { DisposeBag } from '../runtime/lifecycle';

export interface AppProps {
  readonly config: PokeMapConfig;
  readonly bag: DisposeBag;
}

/**
 * Смысл в том, чтобы прогнать контракт интеграции — монтирование,
 * идемпотентность, чистый unmount — ДО того, как в игру войдут MapLibre,
 * WebGL-контекст и воркер. Если утечки появятся позже, будет однозначно
 * понятно, что их источник не в каркасе
 */
export function App({ config }: AppProps): React.JSX.Element {
  useEffect(() => {
    config.onEvent?.({ type: 'ready', version: __WIDGET_VERSION__ });
  }, [config]);

  return (
    <div className="pokemap-placeholder">
      <b>PokeMap {__WIDGET_VERSION__}</b>
      <span>каркас смонтирован</span>
    </div>
  );
}
