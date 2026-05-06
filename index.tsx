
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { migrateLegacyIfNeeded } from './db/migration';

// One-time migration of legacy IndexedDB ('VisceralEngineDB') → new normalized
// Dexie schema. Idempotent: a sentinel row in the new DB prevents a second run.
// Fires before React mounts so the rest of the app sees only the new schema.
migrateLegacyIfNeeded()
  .then((report) => {
    if (report.ranNow) {
      console.log('[db migration] complete:', report);
    }
    if (report.errors.length) {
      console.warn('[db migration] some records failed to migrate:', report.errors);
    }
  })
  .catch((err) => {
    console.error('[db migration] failed:', err);
  });

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
