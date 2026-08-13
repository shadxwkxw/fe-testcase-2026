import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * Правило react-hooks/exhaustive-deps включено как ОШИБКА, а не
 * предупреждение: нестабильная ссылка в зависимостях эффекта здесь означает
 * карта, прыгающая на стартовый зум при каждом обновлении состояния
 *
 * Набор recommendedTypeChecked нужен ради проверок вокруг промисов: весь
 * слой данных асинхронный, и повисший промис там стоит дорого
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
);
