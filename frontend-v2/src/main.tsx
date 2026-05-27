declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}
import './instrument';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ErrorBoundary } from '@sentry/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import './styles.css';

async function revealTauriMainWindow() {
  if (!window.__TAURI_INTERNALS__) return;

  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const main = await WebviewWindow.getByLabel('main');
    const splash = await WebviewWindow.getByLabel('splashscreen');

    await main?.show();
    await main?.setFocus();
    await splash?.close();
  } catch (error) {
    console.error('[tauri] Failed to reveal main window', error);
  }
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
});

const basename = window.location.pathname.startsWith('/dashboard-v2') ? '/dashboard-v2' : '/';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary fallback={<p>Something went wrong</p>} showDialog>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename={basename}>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

window.setTimeout(() => {
  void revealTauriMainWindow();
}, 2500);
