import { describe, expect, it } from 'vitest';
import {
  baueSchuelerLink,
  decodeUebenPaket,
  encodeUebenPaket,
  istLegacyUebenHash,
  istUebenHash,
  leseUebenPaketAusHash,
  type UebenPaket,
} from '@/core/uebenLink';

const paket: UebenPaket = {
  v: 1,
  n: 'Mia',
  woerter: [
    { w: 'Sommer', s: ['Som', 'mer'], m: [2], a: 'der' },
    { w: 'Straße', s: ['Stra', 'ße'], m: [4] },
  ],
};

describe('uebenLink encode/decode', () => {
  it('round-trip erhält den Inhalt', () => {
    const code = encodeUebenPaket(paket);
    expect(decodeUebenPaket(code)).toEqual(paket);
  });

  it('verträgt Umlaute/Sonderzeichen URL-sicher (kein +,/,=)', () => {
    const code = encodeUebenPaket(paket);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('decode liefert null bei Müll', () => {
    expect(decodeUebenPaket('nicht-base64!!')).toBeNull();
    expect(decodeUebenPaket('')).toBeNull();
  });

  it('decode lehnt fremde/leere Pakete ab', () => {
    const fremd = btoa(JSON.stringify({ v: 2, n: 'x', woerter: [] }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(decodeUebenPaket(fremd)).toBeNull();
  });
});

describe('uebenLink hash-Helfer', () => {
  it('baut den neuen Schüler-Link (ohne Wort-Payload)', () => {
    const link = baueSchuelerLink('https://example.org/app/');
    expect(link).toBe('https://example.org/app/#ueben');
    expect(istUebenHash('#ueben')).toBe(true);
    expect(istLegacyUebenHash('#ueben')).toBe(false);
  });

  it('erkennt veraltete Payload-Links weiterhin (nur noch als legacy)', () => {
    const hash = `#ueben=${encodeUebenPaket(paket)}`;
    expect(istUebenHash(hash)).toBe(true);
    expect(istLegacyUebenHash(hash)).toBe(true);
    expect(leseUebenPaketAusHash(hash)).toEqual(paket);
  });

  it('erkennt fremde Hashes nicht als Übungslink', () => {
    expect(istUebenHash('#irgendwas')).toBe(false);
    expect(istUebenHash('#uebensonstwas')).toBe(false);
    expect(leseUebenPaketAusHash('#irgendwas')).toBeNull();
  });
});
