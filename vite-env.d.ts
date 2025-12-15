// Manually define Vite env types to fix "Cannot find type definition file" error
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly [key: string]: string | boolean | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Add global window type for PWA prompt
interface Window {
  deferredPrompt: any;
}
