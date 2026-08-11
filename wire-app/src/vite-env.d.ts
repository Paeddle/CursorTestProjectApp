/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** Path to the wire box scanner app (default /wire-scanner/). */
  readonly VITE_WIRE_SCANNER_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
