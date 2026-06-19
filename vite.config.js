import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Base URL must match the GitHub repo name exactly
// GitHub Pages serves at: https://asldnt.github.io/asl-data-catalog/
export default defineConfig({
  plugins: [react()],
  base: '/asl-data-catalog/',
});
