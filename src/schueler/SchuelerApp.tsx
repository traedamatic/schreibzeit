// Schüler-Client: kindgerechte Oberfläche, geöffnet über den geteilten Link
// (`…#ueben`). Das Kind meldet sich mit Name + PIN am Familien-Server an,
// übt die fälligen Wörter nach „Anschauen – Abdecken – Schreiben – Vergleichen"
// bis zum Tageszeitziel (z. B. 5 Minuten) und die Session wird server-seitig
// aufgezeichnet (Zeit + richtig/falsch + SRS-Fortschritt).
//
// Bewusst getrennt von der Lehrer-/Eltern-App: kein Zugriff auf deren lokale
// Datenbank — nur Server-API plus eine kleine Offline-Warteschlange.

import { useEffect, useRef, useState } from 'react';
import { WortAnzeige } from '@/components/print/WortAnzeige';
import {
  ApiError,
  istRemoteAktiv,
  uebenApi,
  type HeuteStand,
  type PracticeArt,
  type ServerSchueler,
  type ServerWort,
  type UebungsEreignis,
} from '@/services/api';
import {
  baueQuizRunde,
  erzeugeStoppuhr,
  formatZeit,
  istNomen,
  istZeitUm,
  offeneZeitErfassen,
  restSekunden,
  sessionAnhaengen,
  wartendeAbspielen,
  type Stoppuhr,
} from './uebung';
import { istLegacyUebenHash } from '@/core/uebenLink';
import { newId, now } from '@/core/id';

type Phase = 'anschauen' | 'schreiben' | 'pruefen';
type Modus =
  | 'laden'
  | 'kein-server'
  | 'legacy'
  | 'anmelden'
  | 'start'
  | 'ueben'
  | 'sendet'
  | 'fertig';

interface RundenErgebnis {
  richtig: number;
  zuUeben: number;
  /** 'ok' = Server hat bestätigt, 'offline' = wartet in der Warteschlange. */
  uebertragung: 'ok' | 'offline';
}

async function wartendeNachreichen(): Promise<void> {
  await wartendeAbspielen((s) =>
    uebenApi.absenden(s.kindId, s.sessionId, s.events, s.art ?? 'schreiben'),
  );
}

export function SchuelerApp() {
  const [modus, setModus] = useState<Modus>('laden');
  const [profil, setProfil] = useState<ServerSchueler | null>(null);
  const [heute, setHeute] = useState<HeuteStand | null>(null);
  const [faellig, setFaellig] = useState<ServerWort[]>([]);
  const [alleWoerter, setAlleWoerter] = useState<ServerWort[]>([]);
  const [ergebnis, setErgebnis] = useState<RundenErgebnis | null>(null);

  // Laufende Runde.
  const [runde, setRunde] = useState<ServerWort[]>([]);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('anschauen');
  // Quiz-Zustand (#16): Frage- oder Feedback-Phase + letzte Antwort.
  const [quizPhase, setQuizPhase] = useState<'frage' | 'feedback'>('frage');
  const [quizKorrekt, setQuizKorrekt] = useState(false);
  const [, setTick] = useState(0); // erzwingt Re-Render für den Countdown
  const uhrRef = useRef<Stoppuhr | null>(null);
  const wortStartRef = useRef(0);
  const eventsRef = useRef<UebungsEreignis[]>([]);
  const zaehlerRef = useRef({ richtig: 0, zuUeben: 0 });
  // Bonusrunde: Start, obwohl das Tagesziel schon erreicht war → kein Hard-Stop.
  const bonusRundeRef = useRef(false);
  // Schutz gegen doppeltes Beenden (Tick und bewerten() können sich überlappen).
  const beendetRef = useRef(false);
  // Aktuelle beenden()-Instanz für den Interval-Callback (Refs statt Closure-Deps).
  const beendenRef = useRef<() => void>(() => {});
  const zielRef = useRef({ zielSekunden: 0, sekundenHeute: 0 });

  async function ladeDaten(p: ServerSchueler): Promise<void> {
    await wartendeNachreichen().catch(() => {});
    const [h, f, alle] = await Promise.all([
      uebenApi.heute(p.id),
      uebenApi.faellig(p.id),
      // Das Quiz mischt Nomen und Nicht-Nomen aus der ganzen Kartei (#16).
      p.uebungsModus === 'quiz' ? uebenApi.woerter(p.id) : Promise.resolve([] as ServerWort[]),
    ]);
    setProfil(p);
    setHeute(h);
    setFaellig(f);
    setAlleWoerter(alle);
    setModus('start');
  }

  // Einstieg: Legacy-Link erkennen, sonst Session prüfen.
  useEffect(() => {
    if (istLegacyUebenHash(window.location.hash)) {
      setModus('legacy');
      return;
    }
    if (!istRemoteAktiv()) {
      setModus('kein-server');
      return;
    }
    uebenApi
      .me()
      .then(ladeDaten)
      .catch(() => setModus('anmelden'));
  }, []);

  // Während des Übens: Countdown-Tick (inkl. Hard-Stop bei 0:00) + Pause,
  // wenn der Tab unsichtbar ist. Der Tick liest ausschließlich Refs, damit das
  // Intervall keine veralteten Closures sieht.
  useEffect(() => {
    if (modus !== 'ueben') return;
    const intervall = setInterval(() => {
      const uhr = uhrRef.current;
      const { zielSekunden, sekundenHeute } = zielRef.current;
      // Zeit um → Runde sofort beenden (egal in welcher Phase). In der
      // Bonusrunde (Ziel war beim Start schon erreicht) läuft es weiter.
      if (uhr && !bonusRundeRef.current && istZeitUm(zielSekunden, sekundenHeute, uhr.aktiveMs())) {
        beendenRef.current();
        return;
      }
      setTick((t) => t + 1);
    }, 1000);
    const sichtbarkeit = () => {
      if (document.hidden) uhrRef.current?.pause();
      else uhrRef.current?.start();
    };
    document.addEventListener('visibilitychange', sichtbarkeit);
    return () => {
      clearInterval(intervall);
      document.removeEventListener('visibilitychange', sichtbarkeit);
    };
  }, [modus]);

  const istQuiz = profil?.uebungsModus === 'quiz';

  function starten(): void {
    const neueRunde = istQuiz ? baueQuizRunde(alleWoerter) : faellig;
    if (!heute || neueRunde.length === 0) return;
    uhrRef.current = erzeugeStoppuhr();
    uhrRef.current.start();
    wortStartRef.current = 0;
    eventsRef.current = [];
    zaehlerRef.current = { richtig: 0, zuUeben: 0 };
    bonusRundeRef.current = heute.goalMet;
    beendetRef.current = false;
    zielRef.current = { zielSekunden: heute.goalSeconds, sekundenHeute: heute.secondsToday };
    setRunde(neueRunde);
    setIndex(0);
    setPhase('anschauen');
    setQuizPhase('frage');
    setModus('ueben');
  }

  async function beenden(): Promise<void> {
    if (!profil || beendetRef.current) return;
    beendetRef.current = true;
    uhrRef.current?.pause();
    // Angefangenes, nie bewertetes Wort beim Hard-Stop: dessen aktive Zeit dem
    // Server gutschreiben (#17), sonst bleibt der Tagesstand hinter dem Countdown
    // zurück und „noch bis zum Ziel" springt wieder hoch.
    const zeitEreignis = offeneZeitErfassen(
      uhrRef.current?.aktiveMs() ?? 0,
      eventsRef.current,
      runde[index],
      now(),
    );
    if (zeitEreignis) eventsRef.current.push(zeitEreignis);
    setModus('sendet');
    const session = {
      kindId: profil.id,
      sessionId: newId(),
      events: eventsRef.current,
      art: (istQuiz ? 'quiz' : 'schreiben') as PracticeArt,
    };
    let uebertragung: RundenErgebnis['uebertragung'] = 'ok';
    try {
      if (session.events.length > 0) {
        await uebenApi.absenden(session.kindId, session.sessionId, session.events, session.art);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        sessionAnhaengen(session);
        setModus('anmelden');
        return;
      }
      sessionAnhaengen(session);
      uebertragung = 'offline';
    }
    const [h, f] = await Promise.all([
      uebenApi.heute(profil.id).catch(() => heute),
      uebenApi.faellig(profil.id).catch(() => [] as ServerWort[]),
    ]);
    if (h) setHeute(h);
    setFaellig(f);
    setErgebnis({ ...zaehlerRef.current, uebertragung });
    setModus('fertig');
  }

  // Immer die aktuelle Instanz bereithalten (für den Interval-Callback).
  beendenRef.current = () => void beenden();

  /** Antwort auf ein Wort verbuchen + Runden-Ende prüfen (gemeinsamer Kern). */
  function antwortVerbuchen(korrekt: boolean): { fertig: boolean } {
    const wort = runde[index];
    const uhr = uhrRef.current;
    if (!wort || !uhr || !heute) return { fertig: true };
    const aktiveMs = uhr.aktiveMs();
    eventsRef.current.push({
      wordId: wort.id,
      correct: korrekt,
      durationMs: Math.max(0, Math.round(aktiveMs - wortStartRef.current)),
      practicedAt: now(),
    });
    if (korrekt) zaehlerRef.current.richtig += 1;
    else zaehlerRef.current.zuUeben += 1;
    return { fertig: false };
  }

  /** Nächstes Wort — oder Runde beenden (Zeitziel/Wörter erschöpft). */
  function weiterOderBeenden(): void {
    const uhr = uhrRef.current;
    if (!uhr || !heute) return;
    const naechster = index + 1;
    const zielErreicht =
      !bonusRundeRef.current && istZeitUm(heute.goalSeconds, heute.secondsToday, uhr.aktiveMs());
    if (zielErreicht || naechster >= runde.length) {
      void beenden();
      return;
    }
    wortStartRef.current = uhr.aktiveMs();
    setIndex(naechster);
    setPhase('anschauen');
    setQuizPhase('frage');
  }

  /** Quiz (#16): „Groß oder klein?" beantworten → Feedback zeigen. */
  function quizBeantworten(antwortGross: boolean): void {
    const wort = runde[index];
    if (!wort) return;
    const korrekt = antwortGross === istNomen(wort);
    const { fertig } = antwortVerbuchen(korrekt);
    if (fertig) return;
    setQuizKorrekt(korrekt);
    setQuizPhase('feedback');
  }

  function bewerten(korrekt: boolean): void {
    const { fertig } = antwortVerbuchen(korrekt);
    if (!fertig) weiterOderBeenden();
  }

  const aktuelleRestSekunden =
    heute && uhrRef.current
      ? restSekunden(heute.goalSeconds, heute.secondsToday, uhrRef.current.aktiveMs())
      : 0;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-paper-100">
      <header className="border-b border-paper-200 bg-paper-50 px-4 py-4 text-center">
        <p className="text-sm text-ink-faint">Schreibzeit · Üben</p>
        <h1 className="font-serif text-2xl font-semibold text-ink">
          Hallo{profil ? ` ${profil.name}` : ''}! 👋
        </h1>
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-6">
        {modus === 'laden' && <Hinweiskarte symbol="⏳" titel="Einen Moment …" />}
        {modus === 'kein-server' && (
          <Hinweiskarte
            symbol="🔌"
            titel="Kein Übungsserver eingerichtet"
            text="Diese Übungsseite braucht den Familien-Server. Bitte frag deine Eltern oder deine Lehrerin."
          />
        )}
        {modus === 'legacy' && (
          <Hinweiskarte
            symbol="🕰️"
            titel="Dieser Link ist veraltet"
            text="Übungslinks funktionieren jetzt mit Anmeldung: Öffne den neuen Link und melde dich mit deinem Namen und deiner PIN an."
          />
        )}
        {modus === 'anmelden' && <Anmeldekarte onAngemeldet={ladeDaten} />}
        {modus === 'start' && heute && (
          <Startkarte
            heute={heute}
            anzahl={istQuiz ? Math.min(alleWoerter.length, 20) : faellig.length}
            uebungsModus={profil?.uebungsModus ?? 'alle'}
            onStart={starten}
          />
        )}
        {modus === 'ueben' && runde[index] && heute && !istQuiz && (
          <Uebungskarte
            wort={runde[index] as ServerWort}
            position={index + 1}
            gesamt={runde.length}
            restSekunden={aktuelleRestSekunden}
            bonus={bonusRundeRef.current}
            nurNomen={profil?.uebungsModus === 'nomen'}
            phase={phase}
            onAbdecken={() => setPhase('schreiben')}
            onAufdecken={() => setPhase('pruefen')}
            onBewerten={bewerten}
          />
        )}
        {modus === 'ueben' && runde[index] && heute && istQuiz && (
          <QuizKarte
            wort={runde[index] as ServerWort}
            position={index + 1}
            gesamt={runde.length}
            restSekunden={aktuelleRestSekunden}
            bonus={bonusRundeRef.current}
            phase={quizPhase}
            korrekt={quizKorrekt}
            onAntwort={quizBeantworten}
            onWeiter={weiterOderBeenden}
          />
        )}
        {modus === 'sendet' && <Hinweiskarte symbol="📨" titel="Speichere deine Übung …" />}
        {modus === 'fertig' && ergebnis && heute && (
          <Fertigkarte ergebnis={ergebnis} heute={heute} onZurueck={() => setModus('start')} />
        )}
      </main>

      <footer className="px-4 py-3 text-center text-xs text-ink-faint">
        Dein Fortschritt wird sicher auf eurem Familien-Server gespeichert.
      </footer>
    </div>
  );
}

function Hinweiskarte({ symbol, titel, text }: { symbol: string; titel: string; text?: string }) {
  return (
    <div className="card p-8 text-center">
      <p className="text-5xl">{symbol}</p>
      <h2 className="mt-3 font-serif text-xl font-semibold text-ink">{titel}</h2>
      {text && <p className="mt-2 text-sm text-ink-soft">{text}</p>}
    </div>
  );
}

function Anmeldekarte({ onAngemeldet }: { onAngemeldet: (p: ServerSchueler) => Promise<void> }) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [sendet, setSendet] = useState(false);

  async function anmelden(): Promise<void> {
    setSendet(true);
    setFehler(null);
    try {
      const profil = await uebenApi.login(name.trim(), pin);
      await onAngemeldet(profil);
    } catch (error) {
      setFehler(
        error instanceof ApiError && error.status !== 0
          ? error.message
          : 'Keine Verbindung — versuch es gleich nochmal.',
      );
    } finally {
      setSendet(false);
    }
  }

  return (
    <form
      className="card space-y-4 p-6 text-center sm:p-8"
      onSubmit={(e) => {
        e.preventDefault();
        void anmelden();
      }}
    >
      <p className="text-5xl">🔑</p>
      <h2 className="font-serif text-xl font-semibold text-ink">Melde dich an</h2>
      <input
        className="input w-full text-center text-lg"
        placeholder="Dein Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="username"
        required
      />
      <input
        className="input w-full text-center text-lg tracking-[0.5em]"
        placeholder="PIN"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        inputMode="numeric"
        pattern="[0-9]{4,8}"
        minLength={4}
        maxLength={8}
        autoComplete="current-password"
        type="password"
        required
      />
      {fehler && <p className="text-sm text-red-600">{fehler}</p>}
      <button className="btn-primary w-full py-3 text-base" type="submit" disabled={sendet}>
        Los geht's
      </button>
    </form>
  );
}

function Startkarte({
  heute,
  anzahl,
  uebungsModus,
  onStart,
}: {
  heute: HeuteStand;
  anzahl: number;
  uebungsModus: string;
  onStart: () => void;
}) {
  const rest = Math.max(0, heute.goalSeconds - heute.secondsToday);
  const istQuiz = uebungsModus === 'quiz';
  return (
    <div className="card p-6 text-center sm:p-8">
      <p className="text-5xl">{heute.goalMet ? '🌟' : istQuiz ? '🎲' : '📚'}</p>
      <h2 className="mt-3 font-serif text-xl font-semibold text-ink">
        {heute.goalMet ? 'Ziel für heute geschafft!' : 'Deine Schreibzeit'}
      </h2>
      {uebungsModus === 'nomen' && (
        <p className="mt-2 inline-block rounded-full bg-brand-500/10 px-3 py-1 text-sm font-medium text-brand-600">
          🔠 Großschreibung üben — heute nur Nomen
        </p>
      )}
      {istQuiz && (
        <p className="mt-2 inline-block rounded-full bg-brand-500/10 px-3 py-1 text-sm font-medium text-brand-600">
          🎲 Groß-oder-klein-Quiz
        </p>
      )}
      <div className="mt-4 flex justify-center gap-6 text-sm text-ink-soft">
        <span>
          <span className="block text-2xl font-semibold text-ink">{formatZeit(heute.secondsToday)}</span>
          heute geübt
        </span>
        <span>
          <span className="block text-2xl font-semibold text-brand-600">{formatZeit(rest)}</span>
          noch bis zum Ziel
        </span>
        <span>
          <span className="block text-2xl font-semibold text-accent-600">{anzahl}</span>
          {istQuiz ? 'Quiz-Wörter' : 'Wörter dran'}
        </span>
      </div>

      {anzahl > 0 ? (
        <button className="btn-primary mt-6 w-full py-3 text-base" onClick={onStart}>
          {istQuiz ? '▶ Quiz starten' : '▶ Üben starten'}
        </button>
      ) : (
        <p className="mt-6 text-sm text-ink-soft">
          {istQuiz
            ? 'Noch keine Wörter in deiner Kartei — frag deine Eltern. 🙂'
            : 'Gerade ist kein Wort fällig — komm später wieder. 🎉'}
        </p>
      )}

      <p className="mt-6 text-left text-xs leading-relaxed text-ink-faint">
        <strong className="text-ink-soft">So geht's:</strong> Schau dir das Wort genau an und merk
        es dir. Dann decke es ab und schreibe es auf dein Blatt. Zum Schluss deckst du es wieder auf
        und vergleichst. Die Uhr läuft nur, solange du übst.
      </p>
    </div>
  );
}

function Uebungskarte({
  wort,
  position,
  gesamt,
  restSekunden,
  bonus,
  nurNomen,
  phase,
  onAbdecken,
  onAufdecken,
  onBewerten,
}: {
  wort: ServerWort;
  position: number;
  gesamt: number;
  restSekunden: number;
  bonus: boolean;
  nurNomen: boolean;
  phase: Phase;
  onAbdecken: () => void;
  onAufdecken: () => void;
  onBewerten: (korrekt: boolean) => void;
}) {
  const fach = Math.min(5, Math.max(1, wort.fach));
  return (
    <div className="card p-6 sm:p-8">
      <div className="flex items-center justify-between text-xs text-ink-faint">
        <span>
          Wort {position} von {gesamt}
        </span>
        {bonus ? (
          <span className="font-semibold text-accent-600" aria-label="Bonusrunde">
            ✓ Ziel geschafft
          </span>
        ) : (
          <span className="font-semibold text-brand-600" aria-label="Verbleibende Übungszeit">
            ⏱ {formatZeit(restSekunden)}
          </span>
        )}
        <span aria-label={`Kasten ${fach} von 5`}>
          {'★'.repeat(fach)}
          <span className="text-paper-300">{'★'.repeat(5 - fach)}</span>
        </span>
      </div>

      <div className="mt-4 flex min-h-[160px] items-center justify-center rounded-xl2 border border-paper-200 bg-paper-50 px-3 py-8">
        {phase === 'schreiben' ? (
          <p className="text-center text-lg text-ink-soft">
            ✍️ Schreibe das Wort
            <br />
            auf dein Blatt.
          </p>
        ) : (
          <WortAnzeige
            wort={wort.wort}
            silben={wort.silben.length > 0 ? wort.silben : [wort.wort]}
            merkstellen={wort.merkstellen}
            mitSilben
            mitMerkstellen
            artikel={wort.artikel || undefined}
            groesse={56}
          />
        )}
      </div>

      <p className="mt-4 text-center text-sm text-ink-soft">
        {phase === 'anschauen' && 'Schau genau hin und merk dir das Wort.'}
        {phase === 'schreiben' && 'Fertig geschrieben? Dann vergleiche.'}
        {phase === 'pruefen' && 'Hast du es richtig geschrieben?'}
      </p>
      {nurNomen && (
        <p className="mt-2 text-center text-xs font-medium text-brand-600">
          🔠 Merke: Nomen schreibt man groß!
        </p>
      )}

      <div className="mt-5 flex flex-wrap justify-center gap-3">
        {phase === 'anschauen' && (
          <button className="btn-primary w-full py-3 text-base" onClick={onAbdecken}>
            Abdecken
          </button>
        )}
        {phase === 'schreiben' && (
          <button className="btn-primary w-full py-3 text-base" onClick={onAufdecken}>
            Aufdecken & vergleichen
          </button>
        )}
        {phase === 'pruefen' && (
          <>
            <button className="btn-secondary flex-1 py-3 text-base" onClick={() => onBewerten(false)}>
              ✗ Nochmal üben
            </button>
            <button className="btn-primary flex-1 py-3 text-base" onClick={() => onBewerten(true)}>
              ✓ Richtig
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Groß/klein-Quiz (#16): Wort kleingeschrieben zeigen, Kind entscheidet. */
function QuizKarte({
  wort,
  position,
  gesamt,
  restSekunden,
  bonus,
  phase,
  korrekt,
  onAntwort,
  onWeiter,
}: {
  wort: ServerWort;
  position: number;
  gesamt: number;
  restSekunden: number;
  bonus: boolean;
  phase: 'frage' | 'feedback';
  korrekt: boolean;
  onAntwort: (gross: boolean) => void;
  onWeiter: () => void;
}) {
  const nomen = istNomen(wort);
  const richtigeSchreibung = nomen
    ? `${wort.artikel ? `${wort.artikel} ` : ''}${wort.wort}`
    : wort.wort.toLocaleLowerCase('de');
  return (
    <div className="card p-6 sm:p-8">
      <div className="flex items-center justify-between text-xs text-ink-faint">
        <span>
          Wort {position} von {gesamt}
        </span>
        {bonus ? (
          <span className="font-semibold text-accent-600" aria-label="Bonusrunde">
            ✓ Ziel geschafft
          </span>
        ) : (
          <span className="font-semibold text-brand-600" aria-label="Verbleibende Übungszeit">
            ⏱ {formatZeit(restSekunden)}
          </span>
        )}
        <span aria-hidden>🎲</span>
      </div>

      <div className="mt-4 flex min-h-[160px] items-center justify-center rounded-xl2 border border-paper-200 bg-paper-50 px-3 py-8">
        {phase === 'frage' ? (
          <p className="font-serif text-5xl text-ink">{wort.wort.toLocaleLowerCase('de')}</p>
        ) : (
          <div className="text-center">
            <p className="text-4xl">{korrekt ? '✅' : '❌'}</p>
            <p className="mt-2 font-serif text-4xl text-ink">{richtigeSchreibung}</p>
            <p className="mt-2 text-sm text-ink-soft">
              {nomen ? 'Ein Nomen — wird großgeschrieben.' : 'Kein Nomen — bleibt klein.'}
            </p>
          </div>
        )}
      </div>

      <p className="mt-4 text-center text-sm text-ink-soft">
        {phase === 'frage'
          ? 'Schreibt man dieses Wort groß oder klein?'
          : korrekt
            ? 'Richtig — super!'
            : 'Merk es dir für das nächste Mal.'}
      </p>

      <div className="mt-5 flex flex-wrap justify-center gap-3">
        {phase === 'frage' ? (
          <>
            <button className="btn-primary flex-1 py-3 text-base" onClick={() => onAntwort(true)}>
              🔠 Groß
            </button>
            <button className="btn-secondary flex-1 py-3 text-base" onClick={() => onAntwort(false)}>
              🔡 klein
            </button>
          </>
        ) : (
          <button className="btn-primary w-full py-3 text-base" onClick={onWeiter}>
            Weiter
          </button>
        )}
      </div>
    </div>
  );
}

function Fertigkarte({
  ergebnis,
  heute,
  onZurueck,
}: {
  ergebnis: RundenErgebnis;
  heute: HeuteStand;
  onZurueck: () => void;
}) {
  return (
    <div className="card p-6 text-center sm:p-8">
      <p className="text-5xl">{heute.goalMet ? '🌟' : '👏'}</p>
      <h2 className="mt-3 font-serif text-2xl font-semibold text-ink">
        {heute.goalMet ? 'Tagesziel geschafft!' : 'Gut gemacht!'}
      </h2>
      <p className="mt-2 text-ink-soft">
        ✅ {ergebnis.richtig} richtig
        {ergebnis.zuUeben > 0 && <> · ✏️ {ergebnis.zuUeben} weiterüben</>}
        {' · '}⏱ {formatZeit(heute.secondsToday)} heute geübt
      </p>
      {ergebnis.uebertragung === 'offline' && (
        <p className="mt-2 text-xs text-ink-faint">
          Keine Verbindung — deine Übung ist gespeichert und wird nachgereicht.
        </p>
      )}
      <button className="btn-primary mt-6 w-full py-3 text-base" onClick={onZurueck}>
        Zurück
      </button>
    </div>
  );
}
