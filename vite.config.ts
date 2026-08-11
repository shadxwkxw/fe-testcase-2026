import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8'),
) as { version: string };

/**
 * Сборка библиотеки: один самодостаточный UMD-файл, подключаемый
 * синхронным <script> в чужую страницу.
 *
 * React НЕ вынесен в externals намеренно. Обычно зависимости библиотеки
 * помечают внешними, чтобы приложение подключило свою копию и не платило
 * дважды. Здесь это невозможно: виджет едет в zero-code конструктор, где
 * страницу собирает контент-менеджер мышкой. Никто не подключит React
 * отдельным тегом и не проследит за совпадением версий. Контракт задания —
 * ровно один <script>, значит внутри должно быть всё.
 */
export default defineConfig(({ mode }) => ({
  plugins: [react()],

  define: {
    // React читает эту переменную, чтобы выбрать dev- или prod-ветку.
    // В браузере process не существует, поэтому подставляем значение на сборке.
    'process.env.NODE_ENV': JSON.stringify(
      mode === 'production' ? 'production' : 'development',
    ),
    __WIDGET_VERSION__: JSON.stringify(pkg.version),
  },

  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      // Имя глобальной переменной: именно под ним UMD-обёртка положит
      // экспорты модуля в window.
      name: 'PokeMapWidget',
      formats: ['umd'],
      fileName: () => 'pokemap-widget.umd.js',
    },
    cssCodeSplit: false,
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: true,
  },
}));
