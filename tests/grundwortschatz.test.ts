import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { GRUNDWORTSCHATZ_LISTEN, normalisiereEintraege } from '@/data/grundwortschatz';
import { uebernehmeWort } from '@/services/lernwortHelfer';
import { db } from '@/db/db';

// Prüft die gebündelten Grundwortschatz-Wortlisten (public/data/grundwortschatz).
describe('Grundwortschatz-Listen', () => {
  it('enthält Bayern (1/2, 3/4), NRW und Berlin/Brandenburg', () => {
    const ids = GRUNDWORTSCHATZ_LISTEN.map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(['bayern-1-2', 'bayern-3-4', 'nrw', 'berlin-1-4']));
  });

  it('hat für jede Liste eine nicht-leere, normalisierbare Wortdatei', () => {
    for (const l of GRUNDWORTSCHATZ_LISTEN) {
      const json = readFileSync(`public/data/grundwortschatz/${l.datei}`, 'utf8');
      const eintraege = normalisiereEintraege(JSON.parse(json));
      expect(eintraege.length, l.id).toBeGreaterThan(100);
      expect(
        eintraege.every((e) => typeof e.wort === 'string' && e.wort.length > 0),
        l.id,
      ).toBe(true);
    }
  });

  it('NRW umfasst den bekannten 533-Wörter-Umfang', () => {
    const woerter = JSON.parse(readFileSync('public/data/grundwortschatz/nrw.json', 'utf8'));
    expect(woerter.length).toBeGreaterThan(500);
  });

  it('Berlin: 599 Einträge, kuratierte Artikel, sieben → bewusst ohne Artikel', () => {
    const roh = JSON.parse(
      readFileSync('public/data/grundwortschatz/grundwortschatz_berlin_1bis4.json', 'utf8'),
    );
    const eintraege = normalisiereEintraege(roh);
    expect(eintraege).toHaveLength(599);
    const apfel = eintraege.find((e) => e.wort === 'Apfel');
    expect(apfel?.artikel).toBe('der');
    const sieben = eintraege.find((e) => e.wort === 'sieben');
    expect(sieben?.artikel).toBeNull();
    expect(eintraege.filter((e) => typeof e.artikel === 'string').length).toBeGreaterThan(250);
  });
});

describe('normalisiereEintraege (beide Schemata, fehlertolerant)', () => {
  it('versteht das alte string[]-Schema', () => {
    expect(normalisiereEintraege(['Apfel', ' Haus ', ''])).toEqual([
      { wort: 'Apfel' },
      { wort: 'Haus' },
    ]);
  });

  it('versteht das {word, article}-Schema inkl. null', () => {
    expect(
      normalisiereEintraege([
        { word: 'Apfel', article: 'der' },
        { word: 'sieben', article: null },
      ]),
    ).toEqual([
      { wort: 'Apfel', artikel: 'der' },
      { wort: 'sieben', artikel: null },
    ]);
  });

  it('überspringt kaputte Einträge und behandelt unbekannte Artikel als keine Aussage', () => {
    const eintraege = normalisiereEintraege([
      { word: 'Gut', article: 'der' },
      { word: '', article: 'die' }, // leeres Wort → raus
      { article: 'das' }, // kein Wort → raus
      42, // falscher Typ → raus
      null, // falscher Typ → raus
      { word: 'Komisch', article: 'dem' }, // ungültiger Artikel → keine Aussage
      'Klassisch', // gemischtes Schema ist erlaubt
    ]);
    expect(eintraege).toEqual([
      { wort: 'Gut', artikel: 'der' },
      { wort: 'Komisch' },
      { wort: 'Klassisch' },
    ]);
  });

  it('liefert bei Nicht-Arrays ein leeres Ergebnis', () => {
    expect(normalisiereEintraege({ kaputt: true })).toEqual([]);
    expect(normalisiereEintraege('text')).toEqual([]);
  });
});

describe('Artikel-Override beim Import (#14)', () => {
  beforeEach(async () => {
    await db.lernwoerter.clear();
    await db.kinder.clear();
    // Das große Wörterbuch würde für „Sieben" (großgeschrieben) einen Artikel
    // raten — die Listen-Vorgabe muss gewinnen.
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ sieben: 'die', apfel: 'die' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    );
  });

  it('artikel null erzwingt „kein Artikel", auch wenn das Wörterbuch etwas wüsste', async () => {
    await uebernehmeWort('kind-1', 'Sieben', 'Grundwortschatz', null);
    const [wort] = await db.lernwoerter.toArray();
    expect(wort?.artikel).toBe('');
  });

  it('expliziter Listen-Artikel überschreibt den Wörterbuch-Vorschlag', async () => {
    await uebernehmeWort('kind-1', 'Apfel', 'Grundwortschatz', 'der');
    const [wort] = await db.lernwoerter.toArray();
    expect(wort?.artikel).toBe('der');
  });

  it('ohne Vorgabe bleibt der Wörterbuch-Vorschlag erhalten', async () => {
    await uebernehmeWort('kind-1', 'Apfel', 'Text-Extraktion');
    const [wort] = await db.lernwoerter.toArray();
    expect(wort?.artikel).toBe('der'); // kuratierte Liste (GERMAN_NOUNS) hat Vorrang
  });
});
