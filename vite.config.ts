
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
// NOTE: the Gemini API key is no longer injected into the client bundle.
// It now lives server-side as the GEMINI_API_KEY secret used by the
// `inco-ai` Supabase Edge Function (supabase/functions/inco-ai).
export default defineConfig({
  plugins: [react()],
  // Base path set to repository name for GitHub Pages
  base: '/incognitochat/',
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false, // Changed to false to allow debugging in production
        drop_debugger: true,
        pure_funcs: ['console.debug'] // Only drop debug logs
      },
      format: {
        comments: false
      }
    },
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          supabase: ['@supabase/supabase-js'],
          crypto: ['crypto-js'],
          ui: ['lucide-react']
        }
      }
    }
  }
});
