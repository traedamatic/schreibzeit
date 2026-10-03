// Spaced repetition (Leitner 5-box) — a faithful server port of the client's
// pure module `src/core/srs.ts`, so progression is identical on both sides.
import type { WortStatus } from './types';

const TAG_MS = 86_400_000;

/** Days until review per box (index 0 = box 1). */
export const SRS_INTERVALLE_TAGE = [0, 1, 3, 7, 16];

export function clampFach(fach: number): number {
  return Math.min(5, Math.max(1, fach));
}

export interface SrsStand {
  fach: number;
  faelligAm: number;
  status: WortStatus;
}

/** Next SRS state after a graded attempt. Correct → box+1 (max 5); wrong → box 1. */
export function naechsterStand(fach: number, korrekt: boolean, nowMs: number): SrsStand {
  const aktuell = clampFach(fach);
  const next = korrekt ? Math.min(5, aktuell + 1) : 1;
  const tage = SRS_INTERVALLE_TAGE[next - 1] ?? 0;
  const faelligAm = nowMs + tage * TAG_MS;
  const status: WortStatus = next >= 5 ? 'sitzt' : 'wird_geuebt';
  return { fach: next, faelligAm, status };
}

export function istFaellig(faelligAm: number | null, nowMs: number): boolean {
  return (faelligAm ?? 0) <= nowMs;
}
