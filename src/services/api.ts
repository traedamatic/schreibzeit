// Typisierter HTTP-Client für den Schreibzeit-Familien-Server (server/).
//
// Remote-Betrieb ist opt-in: nur wenn `VITE_API_URL` gesetzt ist (z. B. `/api`
// bei Same-Origin-Hosting bzw. Vite-Dev-Proxy), synchronisiert die App mit dem
// Server. Ohne die Variable bleibt alles rein lokal (Dexie) wie bisher.
//
// Cookies (httpOnly-Sessions) laufen über `credentials: 'include'`; empfohlen
// ist Same-Origin-Hosting, damit kein CORS nötig ist.

import type { Lernstand, WortStatus } from '@/types';

/** Server-Repräsentation eines Kindes (camelCase, vom Server geliefert). */
export interface ServerKind {
  id: string;
  name: string;
  lernstand: Lernstand;
  notiz: string | null;
  dailyGoalSeconds: number;
  createdAt: number;
  updatedAt: number;
}

/** Server-Repräsentation eines Lernworts. */
export interface ServerWort {
  id: string;
  kidId: string;
  wort: string;
  artikel: string | null;
  wortart: string | null;
  silben: string[];
  merkstellen: number[];
  status: WortStatus;
  fach: number;
  faelligAm: number | null;
  quelle: string | null;
  notiz: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ServerAdmin {
  id: string;
  email: string;
  displayName: string | null;
}

/** Schüler-Profil nach Kind-Anmeldung. */
export interface ServerSchueler {
  id: string;
  name: string;
  lernstand: Lernstand;
  dailyGoalSeconds: number;
}

/** Tages-Stand gegen das Übungsziel (GET …/practice/today). */
export interface HeuteStand {
  secondsToday: number;
  goalSeconds: number;
  goalMet: boolean;
  sessionsToday: number;
}

/** Vom Server unterstützte Wort-Patch-Felder (SRS-Felder verwaltet der Server). */
export interface WortServerPatch {
  wort?: string;
  artikel?: string;
  wortart?: string;
  silben?: string[];
  merkstellen?: number[];
  status?: WortStatus;
  quelle?: string;
  notiz?: string;
}

export interface UebungsEreignis {
  wordId: string;
  correct: boolean;
  durationMs: number;
  practicedAt: number;
}

export interface UebungsErgebnis {
  applied: number;
  skipped: number;
  updated: ServerWort[];
}

/** Fehler mit HTTP-Status; `status === 0` bedeutet Netzwerk nicht erreichbar. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function apiBase(): string {
  return import.meta.env.VITE_API_URL ?? '';
}

/** True, wenn die App gegen einen Server synchronisieren soll. */
export function istRemoteAktiv(): boolean {
  return Boolean(import.meta.env.VITE_API_URL);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Server nicht erreichbar.', 0);
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // Kein JSON-Body — Statusmeldung reicht.
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

export const adminApi = {
  signup: (email: string, password: string, displayName?: string) =>
    request<ServerAdmin>('POST', '/auth/signup', { email, password, displayName }),
  login: (email: string, password: string) =>
    request<ServerAdmin>('POST', '/auth/login', { email, password }),
  logout: () => request<{ ok: boolean }>('POST', '/auth/logout', {}),
  me: () => request<ServerAdmin>('GET', '/auth/me'),
};

export const kidsApi = {
  list: () => request<ServerKind[]>('GET', '/kids'),
  create: (input: { id?: string; name: string; lernstand: Lernstand; notiz?: string }) =>
    request<ServerKind>('POST', '/kids/', input),
  update: (id: string, patch: { name?: string; lernstand?: Lernstand; notiz?: string | null }) =>
    request<ServerKind>('PUT', `/kids/${id}`, patch),
  remove: (id: string) => request<{ ok: boolean }>('DELETE', `/kids/${id}`),
  setPin: (id: string, pin: string) => request<{ ok: boolean }>('PUT', `/kids/${id}/pin`, { pin }),
};

export const wortApi = {
  list: (kindId: string) => request<ServerWort[]>('GET', `/kids/${kindId}/words`),
  create: (kindId: string, input: WortServerPatch & { id?: string; wort: string }) =>
    request<ServerWort>('POST', `/kids/${kindId}/words`, input),
  update: (id: string, patch: WortServerPatch) => request<ServerWort>('PUT', `/words/${id}`, patch),
  bulkDelete: (ids: string[]) =>
    request<{ deleted: number }>('POST', '/words/bulk-delete', { ids }),
};

/** Dashboard-KPIs (GET /stats/overview) — eine Zeile pro Kind. */
export interface KidUebersicht {
  kid: { id: string; name: string; lernstand: Lernstand; dailyGoalSeconds: number };
  today: { secondsPracticed: number; goalMet: boolean };
  streak: number;
  week: { secondsPracticed: number; daysGoalMet: number };
  dueCount: number;
  masteryPct: number;
  weakWordsCount: number;
  lastPracticedAt: number | null;
}

export interface TagesAktivitaet {
  date: string;
  secondsPracticed: number;
  goalMet: boolean;
  wordsReviewed: number;
  correctRate: number | null;
}

export interface StreakErgebnis {
  current: number;
  longest: number;
}

export interface SchwachesWort {
  wordId: string;
  wort: string;
  fach: number;
  attempts: number;
  wrong: number;
  missRate: number;
}

export const statsApi = {
  overview: () => request<KidUebersicht[]>('GET', '/stats/overview'),
  activity: (kindId: string, days = 14) =>
    request<TagesAktivitaet[]>('GET', `/kids/${kindId}/stats/activity?days=${days}`),
  streak: (kindId: string) => request<StreakErgebnis>('GET', `/kids/${kindId}/stats/streak`),
  weakWords: (kindId: string) =>
    request<SchwachesWort[]>('GET', `/kids/${kindId}/stats/weak-words`),
};

export const uebenApi = {
  login: (name: string, pin: string) =>
    request<ServerSchueler>('POST', '/auth/kid-login', { name, pin }),
  me: () => request<ServerSchueler>('GET', '/auth/kid-me'),
  logout: () => request<{ ok: boolean }>('POST', '/auth/kid-logout', {}),
  faellig: (kindId: string) => request<ServerWort[]>('GET', `/kids/${kindId}/practice/due`),
  heute: (kindId: string) => request<HeuteStand>('GET', `/kids/${kindId}/practice/today`),
  absenden: (kindId: string, sessionId: string, events: UebungsEreignis[]) =>
    request<UebungsErgebnis>('POST', `/kids/${kindId}/practice`, { sessionId, events }),
};
