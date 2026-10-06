// Reine Logik des Schüler-Übungsmodus: Zeitziel-Rechnung, aktive Stoppuhr
// (pausierbar, z. B. wenn der Tab in den Hintergrund geht), die
// Offline-Warteschlange für noch nicht übertragene Übungs-Sessions und die
// Quiz-Rundenlogik (#16). Keine DOM-/React-Abhängigkeit — vollständig testbar.
import type { PracticeArt, UebungsEreignis, UebungsModus } from '@/services/api';

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

/** Mindestens so viel nicht erfasste Zeit (ms), bevor eine Gutschrift lohnt. */
const ZEIT_GUTSCHRIFT_SCHWELLE_MS = 1000;

/**
 * Nicht erfasste aktive Zeit als reines Zeit-Ereignis (#17).
 *
 * Der Countdown zählt die reale aktive Zeit (`aktiveMs`), aber ein Wort wird
 * erst beim Bewerten als Ereignis erfasst. Endet die Runde mitten in einem noch
 * nicht bewerteten Wort (Hard-Stop bei 0:00), fehlt dem Server genau diese
 * Restzeit — der Tagesstand bliebe hinter dem zurück, was der Countdown anzeigte,
 * und „noch bis zum Ziel" spränge wieder hoch. Diese Funktion schreibt die
 * Differenz (aktive Zeit minus bereits erfasste Dauer) dem laufenden Wort als
 * `nurZeit`-Ereignis gut, ohne SRS/Statistik zu verändern.
 *
 * Gibt `null` zurück, wenn es kein laufendes Wort gibt, das Wort schon ein
 * Ereignis hat oder die Restzeit unter der Sekunden-Schwelle liegt (der Server
 * rundet ohnehin auf Sekunden).
 */
export function offeneZeitErfassen(
  aktiveMs: number,
  erfasst: UebungsEreignis[],
  laufendesWort: { id: string } | undefined,
  jetzt: number,
): UebungsEreignis | null {
  if (!laufendesWort) return null;
  if (erfasst.some((e) => e.wordId === laufendesWort.id)) return null;
  const erfassteMs = erfasst.reduce((summe, e) => summe + e.durationMs, 0);
  const restMs = Math.round(aktiveMs - erfassteMs);
  if (restMs < ZEIT_GUTSCHRIFT_SCHWELLE_MS) return null;
  return {
    wordId: laufendesWort.id,
    correct: false,
    durationMs: restMs,
    practicedAt: jetzt,
    nurZeit: true,
  };
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
  /** Art der Session (#16); fehlend = 'schreiben' (Abwärtskompatibilität). */
  art?: PracticeArt;
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

// ---------------------------------------------------------------------------
// Groß/klein-Quiz (#16)
// ---------------------------------------------------------------------------

/** Minimale Wortsicht für die Quiz-Logik (ServerWort erfüllt das). */
export interface QuizWort {
  artikel: string | null;
  wortart: string | null;
}

/** Nomen-Erkennung — identisch zur Server-Definition (#15). */
export function istNomen(wort: QuizWort): boolean {
  if (wort.artikel === 'der' || wort.artikel === 'die' || wort.artikel === 'das') return true;
  return (wort.wortart ?? '').toLowerCase() === 'nomen';
}

/**
 * Quiz-Runde zusammenstellen: möglichst ausgewogene Mischung aus Nomen und
 * Nicht-Nomen aus der eigenen Kartei, gemischt, auf `max` begrenzt. Besteht
 * die Kartei nur aus einer Gruppe, läuft das Quiz trotzdem (keine Balance
 * erzwingbar). `zufall` ist injizierbar, damit Tests deterministisch sind.
 */
export function baueQuizRunde<T extends QuizWort>(
  woerter: T[],
  max = 20,
  zufall: () => number = Math.random,
): T[] {
  const mischen = (liste: T[]): T[] => {
    const kopie = [...liste];
    for (let i = kopie.length - 1; i > 0; i--) {
      const j = Math.floor(zufall() * (i + 1));
      [kopie[i], kopie[j]] = [kopie[j] as T, kopie[i] as T];
    }
    return kopie;
  };

  const nomen = mischen(woerter.filter((w) => istNomen(w)));
  const andere = mischen(woerter.filter((w) => !istNomen(w)));

  // Abwechselnd aus beiden Gruppen ziehen (balanciert), dann final mischen.
  const runde: T[] = [];
  let i = 0;
  while (runde.length < max && (i < nomen.length || i < andere.length)) {
    if (i < nomen.length && runde.length < max) runde.push(nomen[i] as T);
    if (i < andere.length && runde.length < max) runde.push(andere[i] as T);
    i++;
  }
  return mischen(runde);
}

// ---------------------------------------------------------------------------
// Übungsmix: welche Übungsarten das Kind heute schon gemacht hat (#18)
// ---------------------------------------------------------------------------
// Rein lokal (localStorage) — nur zum sanften Anstupsen („probier mal etwas
// anderes"). Keine Pflicht; der Server kennt diese Mischung nicht.

/** Alle wählbaren Übungsarten in Anzeigereihenfolge. */
export const UEBUNGS_ARTEN: readonly UebungsModus[] = ['alle', 'nomen', 'quiz'];

const ARTEN_KEY_PREFIX = 'sz-ueben-arten-';

interface ArtenStand {
  datum: string;
  arten: UebungsModus[];
}

function artenLaden(kidId: string, storage: Storage): ArtenStand | null {
  try {
    const roh = storage.getItem(ARTEN_KEY_PREFIX + kidId);
    if (!roh) return null;
    const stand = JSON.parse(roh) as ArtenStand;
    return Array.isArray(stand.arten) && typeof stand.datum === 'string' ? stand : null;
  } catch {
    return null;
  }
}

/** Übungsarten, die das Kind an `datum` (YYYY-MM-DD) schon geübt hat. */
export function heuteGeuebteArten(
  kidId: string,
  datum: string,
  storage: Storage = localStorage,
): Set<UebungsModus> {
  const stand = artenLaden(kidId, storage);
  return new Set(stand && stand.datum === datum ? stand.arten : []);
}

/** Merkt eine an `datum` geübte Übungsart (setzt die Liste bei Tageswechsel zurück). */
export function merkeGeuebteArt(
  kidId: string,
  datum: string,
  art: UebungsModus,
  storage: Storage = localStorage,
): void {
  const arten = heuteGeuebteArten(kidId, datum, storage);
  arten.add(art);
  try {
    storage.setItem(
      ARTEN_KEY_PREFIX + kidId,
      JSON.stringify({ datum, arten: [...arten] } satisfies ArtenStand),
    );
  } catch {
    // Speicher voll/gesperrt — der Anstupser ist nur ein Extra.
  }
}

/**
 * Nächste vorgeschlagene Übungsart für den Mix: die erste heute noch nicht
 * geübte Art (in fester Reihenfolge). `null`, sobald alle drei dran waren.
 */
export function naechsterArtVorschlag(geuebt: Set<UebungsModus>): UebungsModus | null {
  return UEBUNGS_ARTEN.find((a) => !geuebt.has(a)) ?? null;
}
