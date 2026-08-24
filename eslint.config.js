import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'graphify-out/**', 'game_database.json'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['src/client/**/*.ts'], languageOptions: { globals: globals.browser } },
  { files: ['src/server/**/*.ts', '*.config.ts'], languageOptions: { globals: globals.node } },
);
