/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  // GitHub Pages serves the site from https://ofirariel.github.io/TimePractice/
  base: '/TimePractice/',
  plugins: [preact()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
