import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ladeWoerterbuch, lookupWort, woerterbuchSilben } from '@/services/dictionary';
import { GERMAN_NOUNS } from '@/data/germanNouns';

describe('woerterbuchSilben (Wörterbuch-Trennung)', () => {
  it('trennt korrekt nach deutschen Trennmustern', () => {
    expect(woerterbuchSilben('Apfel')).toEqual(['Ap', 'fel']);
    expect(woerterbuchSilben('Sommer')).toEqual(['Som', 'mer']);
    expect(woerterbuchSilben('Banane')).toEqual(['Ba', 'na', 'ne']);
  });

  it('lässt einsilbige Wörter unverändert', () => {
    expect(woerterbuchSilben('Baum')).toEqual(['Baum']);
  });

  it('ergibt zusammengefügt wieder das Wort', () => {
    for (const w of ['Schmetterling', 'Erdbeere', 'Wochenende', 'Fahrrad']) {
      expect(woerterbuchSilben(w).join('')).toBe(w);
    }
  });
});

describe('lookupWort', () => {
  it('liefert Artikel aus dem Wörterbuch', () => {
    const info = lookupWort('Apfel');
    expect(info.artikel).toBe('der');
    expect(info.artikelGefunden).toBe(true);
    expect(info.silben).toEqual(['Ap', 'fel']);
  });

  it('erkennt Artikel unabhängig von der Großschreibung', () => {
    expect(lookupWort('katze').artikel).toBe('die');
    expect(lookupWort('Katze').artikel).toBe('die');
  });

  it('gibt für unbekannte Wörter keinen Artikel zurück', () => {
    const info = lookupWort('Quizmaster');
    expect(info.artikelGefunden).toBe(false);
    expect(info.artikel).toBe('');
  });

  it('gibt für beste keinen Artikel zurück', () => {
    const info = lookupWort('beste');
    expect(info.artikelGefunden).toBe(false);
    expect(info.artikel).toBe('');
  });

  it('liefert Merkstellen mit', () => {
    expect(lookupWort('Sommer').merkstellen).toEqual([2, 3]);
  });
});

describe('Artikel aus dem großen Wörterbuch (Groß-/Kleinschreibung, #13)', () => {
  beforeAll(async () => {
    // Das große Wiktionary-Wörterbuch enthält substantivierte Verben und
    // Zahlwörter mit kleingeschriebenen Schlüsseln — genau die Fehlerquelle.
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ sieben: 'die', essen: 'das', laufen: 'das', beste: 'die' }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        ),
      ),
    );
    await ladeWoerterbuch();
  });

  it('kleingeschriebene Nicht-Nomen bekommen KEINEN Artikel (sieben, essen, laufen, beste)', () => {
    for (const w of ['sieben', 'essen', 'laufen', 'beste']) {
      const info = lookupWort(w);
      expect(info.artikelGefunden, w).toBe(false);
      expect(info.artikel, w).toBe('');
    }
  });

  it('großgeschriebene Eingaben werden weiterhin nachgeschlagen (Sieben → die, Essen → das)', () => {
    expect(lookupWort('Sieben').artikel).toBe('die');
    expect(lookupWort('Essen').artikel).toBe('das');
  });

  it('kuratierte Liste bleibt case-insensitiv (katze → die)', () => {
    expect(lookupWort('katze').artikel).toBe('die');
    expect(lookupWort('Katze').artikel).toBe('die');
  });
});

describe('GERMAN_NOUNS Datensatz', () => {
  it('verwendet ausschließlich gültige Artikel', () => {
    for (const a of Object.values(GERMAN_NOUNS)) {
      expect(['der', 'die', 'das']).toContain(a);
    }
  });

  it('hat kleingeschriebene Schlüssel', () => {
    for (const k of Object.keys(GERMAN_NOUNS)) {
      expect(k).toBe(k.toLowerCase());
    }
  });
});
