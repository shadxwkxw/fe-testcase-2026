import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * 
 * Правило react-hooks/exhaustive-deps ловит класс ошибок, который в проекте
 * с императивной картой стоит дорого: нестабильная ссылка в зависимостях
 * эффекта заставляет камеру прыгать на стартовый зум при каждом обновлении
 * состояния. Поэтому оно здесь ошибка, а не предупреждение
 *
 * recommendedTypeChecked включён ради проверок вокруг промисов: весь слой
 * данных асинхронный, и повисший промис там стоит дорого
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'host/**', 'demo/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },

  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/exhaustive-deps': 'error',
    },
  },

  {
    // Файлы вне tsconfig: конфиги и статический сервер на чистом JS
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },

  {
    // Проверочные скрипты подставляют заглушки и печатают отчёты
    files: ['scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
);
