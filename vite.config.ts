import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export default defineConfig({
  base: basePath ? `${basePath}/` : '/',
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [vinext()],
});
