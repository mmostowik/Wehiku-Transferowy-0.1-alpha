import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  plugins: [
    {
      name: 'app-version',
      transformIndexHtml: (html) => html.replaceAll('%APP_VERSION%', version),
    },
    tailwindcss(),
  ],
  root: '.',
  build: { outDir: 'dist/client', emptyOutDir: true },
});
