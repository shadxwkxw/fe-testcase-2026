import { useEffect, useMemo, useRef } from 'react';

import { DEFAULT_CITY, DEFAULT_ZOOM, STYLE_URLS } from '../config';
import { useMapInstance } from '../map/useMapInstance';
import type { PokeMapConfig } from '../types';
import type { DisposeBag } from '../runtime/lifecycle';
import type { ShadowHost } from '../runtime/shadowHost';

export interface AppProps {
  readonly config: PokeMapConfig;
  readonly shadow: ShadowHost;
  readonly bag: DisposeBag;
}

export function App({ config, shadow }: AppProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const city = useMemo(() => config.city ?? DEFAULT_CITY, [config.city]);

  const { state } = useMapInstance({
    containerRef,
    shadow,
    initialCenter: city.center,
    initialZoom: DEFAULT_ZOOM,
    styleUrls: STYLE_URLS,
    onError: (message) => {
      config.onEvent?.({ type: 'error', scope: 'map', message });
    },
  });

  useEffect(() => {
    if (state.phase !== 'ready') return;
    config.onEvent?.({ type: 'ready', version: __WIDGET_VERSION__ });
  }, [state.phase, config]);

  return (
    <>
      <div className="pokemap-map" ref={containerRef} />

      {state.phase === 'loading' && <div className="pokemap-overlay">загрузка карты…</div>}

      {state.phase === 'error' && (
        <div className="pokemap-overlay pokemap-overlay--error">
          <b>карта недоступна</b>
          <span>{state.message}</span>
        </div>
      )}
    </>
  );
}
