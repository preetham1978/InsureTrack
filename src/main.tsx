/// <reference types="vite/client" />
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Register PWA Service Worker (only in production)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => console.log('[PWA] Service Worker registered successfully:', reg.scope))
      .catch((err) => console.error('[PWA] Service Worker registration failed:', err));
  });
} else if ('serviceWorker' in navigator) {
  // In development, actively unregister service workers to prevent blank screens/stale caching
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      registration.unregister().then(() => {
        console.log('[PWA] Unregistered dev service worker');
      });
    }
  });
  if ('caches' in window) {
    caches.keys().then((keys) => {
      keys.forEach((key) => {
        caches.delete(key).then(() => {
          console.log('[PWA] Cleared stale dev cache:', key);
        });
      });
    });
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
