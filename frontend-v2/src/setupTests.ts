import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// vitest 4 + jsdom on newer Node does not expose the Web Storage API, leaving
// `localStorage`/`sessionStorage` undefined (Node's experimental native global
// is undefined without --localstorage-file and shadows jsdom). Provide a simple
// in-memory polyfill so components/tests that use storage behave as in a browser.
function createMemoryStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    get length() { return Object.keys(store).length; },
    clear() { store = {}; },
    getItem(key: string) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    key(index: number) { return Object.keys(store)[index] ?? null; },
    removeItem(key: string) { delete store[key]; },
    setItem(key: string, value: string) { store[key] = String(value); },
  };
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  if (!(globalThis as Record<string, unknown>)[name]) {
    const storage = createMemoryStorage();
    Object.defineProperty(globalThis, name, { value: storage, configurable: true, writable: true });
    if (typeof window !== 'undefined' && !window[name]) {
      Object.defineProperty(window, name, { value: storage, configurable: true, writable: true });
    }
  }
}

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.restoreAllMocks();
});
