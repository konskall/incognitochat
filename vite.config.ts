import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/incotest/', // REPO NAME HERE
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});
