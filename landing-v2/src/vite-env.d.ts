/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_STRIPE_PUBLISHABLE_KEY?: string;
  [key: string]: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Vendored scrollcraft engine (src/vendor/scrollcraft), attached to window. */
interface ScrollCraftInstance {
  destroy(): void;
}
interface Window {
  ScrollCraft?: {
    mount(root?: Element | Document | string, opts?: Record<string, unknown>): ScrollCraftInstance;
    instances: ScrollCraftInstance[];
  };
}

declare module '*/scrollcraft.js';
