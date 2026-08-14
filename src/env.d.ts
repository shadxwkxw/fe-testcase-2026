/// <reference types="vite/client" />

/** Версия из package.json, подставляется на сборке через define. */
declare const __WIDGET_VERSION__: string;

/** true только в dev-сборке: включает отладочную панель */
declare const __WIDGET_DIAG__: boolean;
