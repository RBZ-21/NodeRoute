/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_VERSION?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_STATUSPAGE_API_URL?: string;
  readonly VITE_STATUSPAGE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
