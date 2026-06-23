import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
// Side-effect import: registers the service-worker message responder so a push
// for a room you're already viewing stays silent (see utils/swBridge.ts).
import './utils/swBridge';

// Minimal, self-contained "new version" banner (no React dependency so it works
// regardless of app state). Tapping Reload loads the fresh build.
function showUpdatePrompt() {
  if (document.getElementById('sw-update-banner')) return;
  const bar = document.createElement('div');
  bar.id = 'sw-update-banner';
  bar.setAttribute('role', 'status');
  bar.style.cssText = [
    'position:fixed', 'left:50%', 'transform:translateX(-50%)',
    'bottom:calc(1rem + env(safe-area-inset-bottom))', 'z-index:2147483647',
    'display:flex', 'align-items:center', 'gap:12px',
    'padding:10px 12px 10px 16px', 'border-radius:9999px',
    'background:rgba(15,23,42,0.96)', 'color:#fff',
    'box-shadow:0 10px 30px -8px rgba(0,0,0,0.6)',
    'border:1px solid rgba(255,255,255,0.12)',
    'font:600 13px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
    'max-width:calc(100vw - 2rem)',
  ].join(';');
  const txt = document.createElement('span');
  txt.textContent = 'New version available';
  const btn = document.createElement('button');
  btn.textContent = 'Reload';
  btn.style.cssText = [
    'border:0', 'cursor:pointer', 'padding:7px 14px', 'border-radius:9999px',
    'background:#2563eb', 'color:#fff', 'font:700 13px/1 inherit',
  ].join(';');
  btn.onclick = () => window.location.reload();
  bar.appendChild(txt);
  bar.appendChild(btn);
  document.body.appendChild(bar);
}

// Register Service Worker for PWA functionality, and prompt to reload when a NEW
// build takes over. The SW uses skipWaiting()+clients.claim(), so an installed
// PWA would otherwise keep running stale JS for the whole session and risk a
// stale-asset 404 right after a deploy.
if ('serviceWorker' in navigator) {
  // If the page is ALREADY controlled, a later controllerchange means a new SW
  // took control = a deploy happened mid-session. The first control event on a
  // fresh install (no prior controller) must NOT trigger the prompt.
  const hadController = !!navigator.serviceWorker.controller;
  let prompted = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || prompted) return;
    prompted = true;
    showUpdatePrompt();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((registration) => {
        // Catch deploys that land during a long-lived session / open PWA.
        setInterval(() => { registration.update().catch(() => {}); }, 60 * 60 * 1000);
      })
      .catch((registrationError) => {
        console.log('SW registration failed: ', registrationError);
      });
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Failed to find the root element');

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
