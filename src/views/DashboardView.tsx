// Eltern-Dashboard: alle Kinder auf einen Blick (KPIs) plus Drilldown pro
// Kind (Tagesaktivität, Serien, schwache Wörter). Daten kommen ausschließlich
// vom Familien-Server — dadurch sind beide Haushalte automatisch vereint.
import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  statsApi,
  type KidUebersicht,
  type SchwachesWort,
  type StreakErgebnis,
  type TagesAktivitaet,
} from '@/services/api';
import { formatDatum, formatMinuten } from './dashboardFormat';
import { displayName } from '@/state/store';
import { EmptyState } from '@/components/ui';
import type { Einstellungen } from '@/types';

export function DashboardView({ einstellungen }: { einstellungen: Einstellungen }) {
  const [zeilen, setZeilen] = useState<KidUebersicht[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [auswahl, setAuswahl] = useState<KidUebersicht | null>(null);

  const laden = useCallback(async () => {
    setFehler(null);
    try {
      setZeilen(await statsApi.overview());
    } catch (error) {
      setFehler(
        error instanceof ApiError && error.status !== 0
          ? error.message
          : 'Server nicht erreichbar.',
      );
    }
  }, []);

  useEffect(() => {
    void laden();
  }, [laden]);

  if (fehler) {
    return (
      <EmptyState titel="Dashboard nicht verfügbar" text={fehler}>
        <button className="btn-secondary" onClick={() => void laden()}>
          Erneut versuchen
        </button>
      </EmptyState>
    );
  }
  if (zeilen === null) return <p className="py-10 text-center text-sm text-ink-soft">Lade …</p>;
  if (zeilen.length === 0) {
    return (
      <EmptyState
        titel="Noch keine Kinder"
        text="Lege links ein Kind an — sobald es übt, erscheinen hier Zeit, Serie und Lernstand."
      />
    );
  }

  const zielErreicht = zeilen.filter((z) => z.today.goalMet).length;

  return (
    <div className="space-y-5">
      <div className="card flex items-center justify-between gap-3 p-4">
        <p className="font-serif text-lg text-ink">
          {zielErreicht === zeilen.length ? '🌟' : '📣'}{' '}
          <strong>
            {zielErreicht} von {zeilen.length}
          </strong>{' '}
          {zeilen.length === 1 ? 'Kind hat' : 'Kindern haben'} heute das Übungsziel erreicht.
        </p>
        <button className="btn-secondary shrink-0" onClick={() => void laden()}>
          Aktualisieren
        </button>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-paper-200 text-left text-xs text-ink-faint">
              <th className="px-4 py-3 font-medium">Kind</th>
              <th className="px-3 py-3 font-medium">Heute</th>
              <th className="px-3 py-3 font-medium">Serie</th>
              <th className="px-3 py-3 font-medium">Diese Woche</th>
              <th className="px-3 py-3 font-medium">Fällig</th>
              <th className="px-3 py-3 font-medium">Sitzt</th>
              <th className="px-3 py-3 font-medium">Schwach</th>
              <th className="px-3 py-3 font-medium">Zuletzt</th>
            </tr>
          </thead>
          <tbody>
            {zeilen.map((z) => (
              <tr
                key={z.kid.id}
                className={`cursor-pointer border-b border-paper-100 last:border-0 hover:bg-paper-50 ${
                  auswahl?.kid.id === z.kid.id ? 'bg-paper-50' : ''
                }`}
                onClick={() => setAuswahl(auswahl?.kid.id === z.kid.id ? null : z)}
              >
                <td className="px-4 py-3 font-medium text-ink">
                  {displayName(z.kid.name, einstellungen.nurInitialen)}
                </td>
                <td className="px-3 py-3">
                  <span className={z.today.goalMet ? 'text-accent-600' : 'text-ink-soft'}>
                    {z.today.goalMet ? '✓' : '○'} {formatMinuten(z.today.secondsPracticed)}
                  </span>
                </td>
                <td className="px-3 py-3">{z.streak > 0 ? `🔥 ${z.streak}` : '—'}</td>
                <td className="px-3 py-3 text-ink-soft">
                  {formatMinuten(z.week.secondsPracticed)} · {z.week.daysGoalMet}/7 Tage
                </td>
                <td className="px-3 py-3">{z.dueCount}</td>
                <td className="px-3 py-3">{z.masteryPct} %</td>
                <td className="px-3 py-3">{z.weakWordsCount > 0 ? `⚠ ${z.weakWordsCount}` : '—'}</td>
                <td className="px-3 py-3 text-ink-soft">{formatDatum(z.lastPracticedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {auswahl && (
        <KindDetail
          uebersicht={auswahl}
          anzeigename={displayName(auswahl.kid.name, einstellungen.nurInitialen)}
        />
      )}
      {!auswahl && (
        <p className="text-center text-xs text-ink-faint">
          Tipp: Zeile anklicken für Tagesverlauf, Serien und schwache Wörter.
        </p>
      )}
    </div>
  );
}

function KindDetail({
  uebersicht,
  anzeigename,
}: {
  uebersicht: KidUebersicht;
  anzeigename: string;
}) {
  const kindId = uebersicht.kid.id;
  const [aktivitaet, setAktivitaet] = useState<TagesAktivitaet[] | null>(null);
  const [serie, setSerie] = useState<StreakErgebnis | null>(null);
  const [schwache, setSchwache] = useState<SchwachesWort[] | null>(null);

  useEffect(() => {
    let aktiv = true;
    setAktivitaet(null);
    setSerie(null);
    setSchwache(null);
    void Promise.all([
      statsApi.activity(kindId, 14),
      statsApi.streak(kindId),
      statsApi.weakWords(kindId),
    ])
      .then(([a, s, w]) => {
        if (!aktiv) return;
        setAktivitaet(a);
        setSerie(s);
        setSchwache(w);
      })
      .catch(() => {
        if (aktiv) setAktivitaet([]);
      });
    return () => {
      aktiv = false;
    };
  }, [kindId]);

  const maxSekunden = Math.max(
    uebersicht.kid.dailyGoalSeconds,
    ...(aktivitaet ?? []).map((t) => t.secondsPracticed),
  );

  return (
    <div className="card space-y-5 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-lg font-semibold text-ink">{anzeigename} — letzte 14 Tage</h2>
        {serie && (
          <p className="text-sm text-ink-soft">
            Serie: <strong className="text-ink">{serie.current}</strong> · längste:{' '}
            {serie.longest} Tage
          </p>
        )}
      </div>

      {aktivitaet === null ? (
        <p className="text-sm text-ink-soft">Lade …</p>
      ) : aktivitaet.length === 0 ? (
        <p className="text-sm text-ink-soft">Noch keine Übungsdaten.</p>
      ) : (
        <div className="space-y-1" aria-label="Tagesaktivität">
          {aktivitaet.map((tag) => (
            <div key={tag.date} className="flex items-center gap-2 text-xs">
              <span className="w-24 shrink-0 text-ink-faint">{tag.date.slice(5)}</span>
              <div className="h-4 flex-1 overflow-hidden rounded bg-paper-100">
                <div
                  className={`h-full ${tag.goalMet ? 'bg-accent-600' : 'bg-brand-300'}`}
                  style={{
                    width: `${maxSekunden > 0 ? Math.min(100, (tag.secondsPracticed / maxSekunden) * 100) : 0}%`,
                  }}
                />
              </div>
              <span className="w-20 shrink-0 text-right text-ink-soft">
                {tag.secondsPracticed > 0 ? formatMinuten(tag.secondsPracticed) : '—'}
              </span>
              <span className="w-6 shrink-0 text-center">{tag.goalMet ? '✓' : ''}</span>
            </div>
          ))}
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-ink">Schwache Wörter (üben lohnt sich)</h3>
        {schwache === null ? (
          <p className="text-sm text-ink-soft">Lade …</p>
        ) : schwache.length === 0 ? (
          <p className="text-sm text-ink-soft">Keine auffälligen Wörter — stark! 💪</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {schwache.map((w) => (
              <li
                key={w.wordId}
                className="rounded-lg border border-paper-200 bg-paper-50 px-3 py-1.5 text-sm"
                title={`${w.wrong} von ${w.attempts} Versuchen falsch`}
              >
                <strong className="text-ink">{w.wort}</strong>{' '}
                <span className="text-xs text-ink-faint">
                  {Math.round(w.missRate * 100)} % falsch
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
