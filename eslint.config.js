import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/release/**', 'bench/runs/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly', fetch: 'readonly' } },
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
  {
    files: ['demo-sites/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { window: 'readonly', document: 'readonly', fetch: 'readonly', location: 'readonly', history: 'readonly', URLSearchParams: 'readonly', setTimeout: 'readonly' } },
  },
);
