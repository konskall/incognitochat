
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Inject a <link rel="preload"> for the hashed self-hosted Inter woff2 so the
// hero/LCP text font is discovered immediately, instead of only after the
// render-blocking CSS parses (avoids a FOUT swap on the largest hero text).
// Build-only (ctx.bundle is undefined in dev) and base-path aware.
function preloadInterFont(): Plugin {
  return {
    name: 'preload-inter-font',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return html;
        const fontFile = Object.keys(bundle).find((f) => /inter-.*\.woff2$/i.test(f));
        if (!fontFile) return html;
        const href = '/incognitochat/' + fontFile;
        const tag = `<link rel="preload" href="${href}" as="font" type="font/woff2" crossorigin>`;
        return html.replace('</head>', `    ${tag}\n  </head>`);
      },
    },
  };
}

// https://vitejs.dev/config/
// NOTE: the Gemini API key is no longer injected into the client bundle.
// It now lives server-side as the GEMINI_API_KEY secret used by the
// `inco-ai` Supabase Edge Function (supabase/functions/inco-ai).
export default defineConfig({
  plugins: [react(), preloadInterFont()],
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
