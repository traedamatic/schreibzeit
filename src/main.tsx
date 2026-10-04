import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { SchuelerApp } from './schueler/SchuelerApp';
import { ErrorBoundary } from './components/ErrorBoundary';
import { istUebenHash } from './core/uebenLink';
import { starteSync } from './services/serverSync';
import './index.css';

// Unbehandelte Promise-Rejections sichtbar machen (die ErrorBoundary fängt nur
// Fehler im Render). In der lokalen App genügt das Konsolen-Log für DevTools.
window.addEventListener('unhandledrejection', (e) => {
  console.error('Unbehandelte Promise-Rejection:', e.reason);
});

// Ein einziger Build, zwei Einstiege: Mit einem geteilten Übungslink
// (#ueben=…) startet der kindgerechte Schüler-Client, sonst die Lehrer-App.
const istSchueler = istUebenHash(window.location.hash);

// Familien-Server-Sync (nur wenn VITE_API_URL konfiguriert ist; sonst no-op).
// Der Schüler-Client hat seinen eigenen, schlankeren Server-Zugriff.
if (!istSchueler) void starteSync();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>{istSchueler ? <SchuelerApp /> : <App />}</ErrorBoundary>
  </React.StrictMode>,
);
