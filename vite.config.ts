
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/incognitochat/', // Corrected repo name
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info', 'console.debug', 'console.warn']
      },
      format: {
        comments: false
      }
    },
    rollupOptions: {
      // Externalize dependencies that are provided via importmap in index.html
      // This prevents double-loading React and resolves the build error for 'sonner'
      external: [
        'react', 
        'react-dom', 
        'sonner', 
        'lucide-react', 
        '@emailjs/browser', 
        '@supabase/supabase-js', 
        'crypto-js',
        'firebase/app', 
        'firebase/auth', 
        'firebase/firestore', 
        'firebase/messaging'
      ],
      output: {
        manualChunks: undefined
      }
    }
  }
});
