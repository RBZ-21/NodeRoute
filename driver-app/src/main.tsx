import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from '@/App';
import { DriverAppProvider } from '@/hooks/useDriverApp';
import { ToastProvider } from '@/hooks/useToast';
import '@/index.css';

registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <ToastProvider>
        <DriverAppProvider>
          <App />
        </DriverAppProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);
