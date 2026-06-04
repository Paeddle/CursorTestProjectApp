/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_ACCESS_PASSWORD?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*?url' {
  const src: string
  export default src
}

