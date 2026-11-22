import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './vendor/scrollcraft/scrollcraft.css';
import './styles.css';
import './scene.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
