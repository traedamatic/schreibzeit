// Format-Helfer des Dashboards (eigene Datei, damit die View-Datei nur
// Komponenten exportiert — Voraussetzung für React Fast Refresh).
import { formatZeit } from '@/schueler/uebung';

/** Minuten-Anzeige: "12 min" (unter einer Minute: "0:45"). */
export function formatMinuten(sekunden: number): string {
  if (sekunden >= 60) return `${Math.round(sekunden / 60)} min`;
  return formatZeit(sekunden);
}

export function formatDatum(ts: number | null): string {
  if (ts === null) return '—';
  return new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}
