import { describe, expect, it } from 'bun:test';
import { naechsterStand, SRS_INTERVALLE_TAGE } from './srs';

const DAY = 86_400_000;

describe('naechsterStand (mirrors client src/core/srs.ts)', () => {
  it('correct advances the box and schedules by its interval', () => {
    const r = naechsterStand(1, true, 0);
    expect(r.fach).toBe(2);
    expect(r.faelligAm).toBe((SRS_INTERVALLE_TAGE[1] ?? 0) * DAY);
    expect(r.status).toBe('wird_geuebt');
  });

  it('reaching box 5 marks the word as sitzt', () => {
    const r = naechsterStand(4, true, 0);
    expect(r.fach).toBe(5);
    expect(r.status).toBe('sitzt');
    expect(r.faelligAm).toBe((SRS_INTERVALLE_TAGE[4] ?? 0) * DAY);
  });

  it('wrong resets to box 1 and is due immediately', () => {
    const r = naechsterStand(4, false, 1000);
    expect(r.fach).toBe(1);
    expect(r.faelligAm).toBe(1000);
    expect(r.status).toBe('wird_geuebt');
  });

  it('does not advance past box 5', () => {
    expect(naechsterStand(5, true, 0).fach).toBe(5);
  });
});
