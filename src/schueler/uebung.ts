// Reine Logik des Schüler-Übungsmodus: Zeitziel-Rechnung, aktive Stoppuhr
// (pausierbar, z. B. wenn der Tab in den Hintergrund geht) und die
// Offline-Warteschlange für noch nicht übertragene Übungs-Sessions.
// Keine DOM-/React-Abhängigkeit — vollständig testbar.
import type { UebungsEreignis } from '@/services/api';

// ---------------------------------------------------------------------------
// Zeitziel ("5 Minuten üben")
// ---------------------------------------------------------------------------

/** Verbleibende Sekunden bis zum Tagesziel (nie negativ). */
export function restSekunden(
  zielSekunden: number,
  sekundenHeute: number,
  aktiveMs: number,
): number {
  return Math.max(0, zielSekunden - sekundenHeute - Math.floor(aktiveMs / 1000));
}

/** True, sobald das Tagesziel (inkl. laufender Session) erreicht ist. */
export function istZeitUm(zielSekunden: number, sekundenHeute: number, aktiveMs: number): boolean {
  return restSekunden(zielSekunden, sekundenHeute, aktiveMs) <= 0;
}

/** Sekunden als "M:SS" für die Countdown-Anzeige. */
export function formatZeit(sekunden: number): string {
  const s = Math.max(0, Math.floor(sekunden));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Aktive Stoppuhr (zählt nur, während geübt wird)
// ---------------------------------------------------------------------------

export interface Stoppuhr {
  start(): void;
  pause(): void;
  /** Bisher aktiv verstrichene Millisekunden (läuft beim Ablesen weiter). */
  aktiveMs(): number;
}

/** Stoppuhr mit injizierbarer Uhr (Tests übergeben eine Fake-Zeitquelle). */
export function erzeugeStoppuhr(jetzt: () => number = Date.now): Stoppuhr {
  let angesammelt = 0;
  let laeuftSeit: number | null = null;
  return {
    start() {
      if (laeuftSeit === null) laeuftSeit = jetzt();
    },
    pause() {
      if (laeuftSeit !== null) {
        angesammelt += jetzt() - laeuftSeit;
        laeuftSeit = null;
      }
    },
    aktiveMs() {
      return angesammelt + (laeuftSeit !== null ? jetzt() - laeuftSeit : 0);
    },
  };
}

// ---------------------------------------------------------------------------
// Offline-Warteschlange (localStorage): fertige Sessions, die der Server noch
// nicht bestätigt hat. Wird beim nächsten Start/Online-Ereignis abgespielt.
// ---------------------------------------------------------------------------

export interface WartendeSession {
  kindId: string;
  sessionId: string;
  events: UebungsEreignis[];
}

const QUEUE_KEY = 'sz-ueben-warteschlange';

export function wartendeLaden(storage: Storage = localStorage): WartendeSession[] {
  try {
    const roh = storage.getItem(QUEUE_KEY);
    const liste = roh ? (JSON.parse(roh) as unknown) : [];
    return Array.isArray(liste) ? (liste as WartendeSession[]) : [];
  } catch {
    return [];
  }
}

function wartendeSpeichern(liste: WartendeSession[], storage: Storage): void {
  try {
    if (liste.length === 0) storage.removeItem(QUEUE_KEY);
    else storage.setItem(QUEUE_KEY, JSON.stringify(liste));
  } catch {
    // Speicher voll/gesperrt (z. B. privater Modus) — Übung läuft trotzdem.
  }
}

export function sessionAnhaengen(session: WartendeSession, storage: Storage = localStorage): void {
  wartendeSpeichern([...wartendeLaden(storage), session], storage);
}

/**
 * Warteschlange der Reihe nach abspielen. Beim ersten Fehler wird gestoppt
 * (Rest bleibt erhalten — z. B. weiterhin offline). Gibt die Anzahl der noch
 * wartenden Sessions zurück. Server-seitig sind Wiederholungen durch die
 * (sessionId, wordId)-Idempotenz unschädlich.
 */
export async function wartendeAbspielen(
  senden: (session: WartendeSession) => Promise<unknown>,
  storage: Storage = localStorage,
): Promise<number> {
  const liste = wartendeLaden(storage);
  let index = 0;
  for (; index < liste.length; index++) {
    try {
      await senden(liste[index] as WartendeSession);
    } catch {
      break;
    }
  }
  const rest = liste.slice(index);
  wartendeSpeichern(rest, storage);
  return rest.length;
}
