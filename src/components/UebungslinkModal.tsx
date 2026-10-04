// Eltern-/Lehrer-Dialog: teilt den Übungslink für ein Kind und setzt dessen
// Anmelde-PIN. Der Link ist ein reiner Einstiegspunkt (`…#ueben`) — das Kind
// meldet sich dort mit Name + PIN am Familien-Server an; Wörter und
// Fortschritt kommen vom Server (beide Haushalte sehen denselben Stand).

import { useEffect, useMemo, useState } from 'react';
import { Modal } from './ui';
import { IconCheck, IconCopy, IconLink } from './icons';
import { baueSchuelerLink } from '@/core/uebenLink';
import { ApiError, istRemoteAktiv, kidsApi, type UebungsModus } from '@/services/api';
import { displayName } from '@/state/store';
import type { Einstellungen, Kind, Lernwort } from '@/types';

const MODUS_OPTIONEN: { wert: UebungsModus; label: string }[] = [
  { wert: 'alle', label: 'Alle Wörter' },
  { wert: 'nomen', label: 'Nur Nomen (Großschreibung)' },
  { wert: 'quiz', label: 'Groß/klein-Quiz' },
];

export function UebungslinkModal({
  offen,
  kind,
  woerter,
  einstellungen,
  onClose,
}: {
  offen: boolean;
  kind: Kind;
  woerter: Lernwort[];
  einstellungen: Einstellungen;
  onClose: () => void;
}) {
  const [kopiert, setKopiert] = useState(false);
  const [pin, setPin] = useState('');
  const [pinStatus, setPinStatus] = useState<'leer' | 'sendet' | 'ok' | string>('leer');
  const [modus, setModus] = useState<UebungsModus | null>(null);
  const [modusFehler, setModusFehler] = useState<string | null>(null);

  const link = useMemo(() => baueSchuelerLink(), []);
  const anzeigename = displayName(kind.name, einstellungen.nurInitialen);

  // Aktuellen Übungsmodus vom Server laden (#15).
  useEffect(() => {
    if (!offen || !istRemoteAktiv()) return;
    let aktiv = true;
    kidsApi
      .get(kind.id)
      .then((k) => {
        if (aktiv) setModus(k.uebungsModus);
      })
      .catch(() => {
        if (aktiv) setModusFehler('Übungsmodus konnte nicht geladen werden.');
      });
    return () => {
      aktiv = false;
    };
  }, [offen, kind.id]);

  async function modusSpeichern(neu: UebungsModus) {
    const vorher = modus;
    setModus(neu);
    setModusFehler(null);
    try {
      await kidsApi.update(kind.id, { uebungsModus: neu });
    } catch (error) {
      setModus(vorher);
      setModusFehler(
        error instanceof ApiError ? error.message : 'Übungsmodus konnte nicht gespeichert werden.',
      );
    }
  }

  async function kopieren() {
    try {
      await navigator.clipboard.writeText(link);
      setKopiert(true);
      setTimeout(() => setKopiert(false), 2000);
    } catch {
      // Clipboard-API nicht verfügbar – das Feld lässt sich manuell markieren.
    }
  }

  async function pinSpeichern() {
    setPinStatus('sendet');
    try {
      await kidsApi.setPin(kind.id, pin);
      setPinStatus('ok');
      setPin('');
    } catch (error) {
      setPinStatus(error instanceof ApiError ? error.message : 'PIN konnte nicht gesetzt werden.');
    }
  }

  if (!istRemoteAktiv()) {
    return (
      <Modal offen={offen} titel="Übungslink teilen" onClose={onClose}>
        <p className="text-sm text-ink-soft">
          Der Schüler-Übungsmodus läuft über euren Familien-Server, damit der Lernfortschritt für
          beide Haushalte sichtbar ist. Diese Installation ist rein lokal (ohne Server) — richte
          den Server ein und starte die App mit gesetzter <code>VITE_API_URL</code>.
        </p>
      </Modal>
    );
  }

  return (
    <Modal offen={offen} titel="Übungslink teilen" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-ink-soft">
          Mit diesem Link übt <strong className="text-ink">{anzeigename}</strong> die{' '}
          {woerter.length} Lernwörter auf jedem Gerät. Das Kind meldet sich mit seinem{' '}
          <strong className="text-ink">Namen ({kind.name})</strong> und seiner{' '}
          <strong className="text-ink">PIN</strong> an — Wörter und Fortschritt kommen vom
          Familien-Server und sind in beiden Haushalten gleich.
        </p>

        <div>
          <label className="label" htmlFor="ueben-link">
            Link
          </label>
          <div className="flex gap-2">
            <input
              id="ueben-link"
              className="input font-mono text-xs"
              value={link}
              readOnly
              onFocus={(e) => e.currentTarget.select()}
            />
            <button className="btn-secondary shrink-0" onClick={kopieren}>
              {kopiert ? (
                <>
                  <IconCheck width={16} height={16} /> Kopiert
                </>
              ) : (
                <>
                  <IconCopy width={16} height={16} /> Kopieren
                </>
              )}
            </button>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="ueben-modus">
            Übungsmodus
          </label>
          <select
            id="ueben-modus"
            className="input max-w-xs"
            value={modus ?? 'alle'}
            disabled={modus === null}
            onChange={(e) => void modusSpeichern(e.target.value as UebungsModus)}
          >
            {MODUS_OPTIONEN.map((o) => (
              <option key={o.wert} value={o.wert}>
                {o.label}
              </option>
            ))}
          </select>
          {modusFehler && <p className="mt-1 text-xs text-red-600">{modusFehler}</p>}
          {modus === 'nomen' && (
            <p className="mt-1 text-xs text-ink-faint">
              Das Kind übt nur Nomen — Merksatz „Nomen schreibt man groß!" wird angezeigt.
            </p>
          )}
          {modus === 'quiz' && (
            <p className="mt-1 text-xs text-ink-faint">
              „Groß oder klein?"-Quiz über die ganze Kartei. Die Zeit zählt zum Tagesziel; der
              Karteikasten-Fortschritt (Fächer) bleibt unberührt.
            </p>
          )}
        </div>

        <div>
          <label className="label" htmlFor="ueben-pin">
            PIN für {anzeigename} (4–8 Ziffern)
          </label>
          <div className="flex gap-2">
            <input
              id="ueben-pin"
              className="input font-mono"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, '').slice(0, 8));
                setPinStatus('leer');
              }}
              inputMode="numeric"
              placeholder="z. B. 2468"
            />
            <button
              className="btn-secondary shrink-0"
              onClick={() => void pinSpeichern()}
              disabled={pin.length < 4 || pinStatus === 'sendet'}
            >
              PIN speichern
            </button>
          </div>
          {pinStatus === 'ok' && (
            <p className="mt-1 text-xs text-accent-600">PIN gespeichert — das Kind kann sich anmelden.</p>
          )}
          {pinStatus !== 'leer' && pinStatus !== 'ok' && pinStatus !== 'sendet' && (
            <p className="mt-1 text-xs text-red-600">{pinStatus}</p>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <a className="btn-secondary" href={link} target="_blank" rel="noopener noreferrer">
            <IconLink width={16} height={16} /> Vorschau öffnen
          </a>
          <button className="btn-primary" onClick={onClose}>
            Fertig
          </button>
        </div>

        <p className="rounded-lg bg-paper-50 px-3 py-2 text-xs leading-relaxed text-ink-faint">
          Tipp: Der Link bleibt immer gleich — neue Wörter sind automatisch dabei, sobald sie in
          der Kartei stehen. Die Übungszeit und der Fortschritt landen auf dem Familien-Server und
          sind im Dashboard sichtbar.
        </p>
      </div>
    </Modal>
  );
}
