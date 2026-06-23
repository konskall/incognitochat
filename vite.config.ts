
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';

// vite.config runs in Node; we read build-time env without pulling in @types/node.
declare const process: { env: Record<string, string | undefined> };

// Source-map upload to Sentry runs ONLY when a build-time auth token is present
// (set as the SENTRY_AUTH_TOKEN GitHub Actions secret). Without it — local builds
// and any build before the secret is added — the plugin is skipped entirely and
// source maps are NOT emitted, so nothing changes and no .map files leak to the
// public GitHub Pages site. With it, maps are built ('hidden', not referenced in
// the bundle), uploaded so Sentry stack traces are readable, then deleted.
const SENTRY_UPLOAD = !!process.env.SENTRY_AUTH_TOKEN;

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
  plugins: [
    react(),
    preloadInterFont(),
    // Must come last. Disabled unless SENTRY_AUTH_TOKEN is set (see above).
    ...(SENTRY_UPLOAD
      ? [sentryVitePlugin({
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          authToken: process.env.SENTRY_AUTH_TOKEN,
          telemetry: false,
          // Don't ship source maps to GitHub Pages — upload to Sentry then delete.
          sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
          // A Sentry/network hiccup must never fail the deploy — log and move on.
          errorHandler: (err) => { console.warn('Sentry source-map upload failed (non-fatal):', err); },
        })]
      : []),
  ],
  // Base path set to repository name for GitHub Pages
  base: '/incognitochat/',
  build: {
    outDir: 'dist',
    // 'hidden' = emit maps for upload but don't reference them in the bundle
    // (so the browser never requests them). Only when we're actually uploading.
    sourcemap: SENTRY_UPLOAD ? 'hidden' : false,
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
          crypto: ['crypto-js']
          // NOTE: lucide-react is intentionally NOT a manualChunk. Forcing it into
          // one shared `ui` chunk pulled the entire ~100-icon graph onto the eager
          // landing's first paint (the lazy ChatScreen/Dashboard import the same
          // chunk, defeating their route split). Letting Rollup place each icon in
          // the chunk that references it keeps chat/dashboard-only icons in their
          // lazy chunks and only the ~30 landing icons eager.
        }
      }
    }
  }
});
