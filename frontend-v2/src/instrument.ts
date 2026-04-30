import * as React from 'react';
import {
  addIntegration,
  init,
  lazyLoadIntegration,
  reactRouterV6BrowserTracingIntegration,
} from '@sentry/react';
import {
  createRoutesFromChildren,
  matchRoutes,
  useLocation,
  useNavigationType,
} from 'react-router-dom';

let replayLoaded = false;

function loadReplayIntegration() {
  if (replayLoaded || typeof window === 'undefined') {
    return;
  }

  replayLoaded = true;

  void lazyLoadIntegration('replayIntegration')
    .then((replayIntegration) => {
      addIntegration(
        replayIntegration({
          maskAllText: true,
          blockAllMedia: true,
        }),
      );
    })
    .catch((error) => {
      replayLoaded = false;

      if (import.meta.env.DEV) {
        console.warn('[Sentry] Failed to lazy-load replay integration', error);
      }
    });
}

function scheduleReplayIntegration() {
  if (typeof window === 'undefined') {
    return;
  }

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(() => {
      loadReplayIntegration();
    });
    return;
  }

  globalThis.setTimeout(() => {
    loadReplayIntegration();
  }, 0);
}

init({
  dsn: 'https://e41c57859bf084be8bccc53816fcc3bf@o4511304951791616.ingest.us.sentry.io/4511305050423296',
  environment: import.meta.env.MODE,
  release: import.meta.env.VITE_APP_VERSION,
  sendDefaultPii: true,
  sampleRate: 1.0,
  debug: import.meta.env.DEV,
  integrations: [
    reactRouterV6BrowserTracingIntegration({
      useEffect: React.useEffect,
      useLocation,
      useNavigationType,
      createRoutesFromChildren,
      matchRoutes,
    }),
  ],
  tracesSampleRate: 1.0,
  tracePropagationTargets: ['localhost', '127.0.0.1', /^\//, window.location.origin],
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  enableLogs: true,
  beforeSend(event) {
    if (import.meta.env.DEV) {
      console.info('[Sentry] beforeSend', event.event_id, event);
    }
    return event;
  },
});

scheduleReplayIntegration();
