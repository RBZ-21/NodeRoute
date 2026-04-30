import './instrument';
import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './styles.css';

const basename = window.location.pathname.startsWith('/dashboard-v2') ? '/dashboard-v2' : '/';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<p>Something went wrong</p>} showDialog>
      <BrowserRouter basename={basename}>
        <App />
      </BrowserRouter>
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);
