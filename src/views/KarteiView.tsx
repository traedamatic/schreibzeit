import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, StatusBadge, EmptyState } from '@/components/ui';
import {
  IconPlus,
  IconTrash,
  IconEdit,
  IconCopy,
  IconCheck,
  IconSparkles,
  IconLink,
} from '@/components/icons';
import { repository } from '@/db/repository';
import { useLernwoerter, useWortlisten } from '@/state/hooks';
import { syllablesFromBreakpoints, breakpointsFromSyllables } from '@/core/syllables';
import { suggestMerkstellen } from '@/core/merkstellen';
import { tokenize, buildExistingSet, normalizeForCompare } from '@/core/tokenize';
import { formatSyllables } from '@/core/syllables';
import { lookupWort, woerterbuchSilben } from '@/services/dictionary';
import { uebernehmeWort, uebernehmeWoerter } from '@/services/lernwortHelfer';
import { erkenneTextAusFoto } from '@/services/ocr';
import {
  GRUNDWORTSCHATZ_LISTEN,
  ladeGrundwortschatz,
  type GrundwortschatzEintrag,
} from '@/data/grundwortschatz';
import { IconCamera, IconList, IconBook } from '@/components/icons';
import { WortChips } from '@/components/WortChips';
import { PrintPortal } from '@/components/print/PrintPortal';
import { LernstandDocument } from '@/components/print/LernstandDocument';
import { ElternblattDocument } from '@/components/print/ElternblattDocument';
import { UebungslinkModal } from '@/components/UebungslinkModal';
import { displayName } from '@/state/store';
import { t } from '@/i18n/de';
import { drucke } from '@/services/print';
import type { Einstellungen, Kind, Lernwort, WortStatus } from '@/types';

const STATUS_REIHENFOLGE: WortStatus[] = ['neu', 'wird_geuebt', 'sitzt'];

/** Reiter im „Wörter hinzufügen"-Popup. */
type AddTab = 'einzeln' | 'text' | 'gws';

export function KarteiView({
  kind,
  einstellungen,
}: {
  kind: Kind;
  einstellungen: Einstellungen;
}) {
  const woerter = useLernwoerter(kind.id);
  const [filter, setFilter] = useState<WortStatus | 'alle'>('alle');
  const [editor, setEditor] = useState<{ offen: boolean; wort?: Lernwort }>({ offen: false });
  // Gemeinsames „Wörter hinzufügen"-Popup mit Reitern (einzeln / Text / Grundwortschatz).
  const [addModal, setAddModal] = useState<{ offen: boolean; tab: AddTab }>({
    offen: false,
    tab: 'einzeln',
  });
  const [linkOffen, setLinkOffen] = useState(false);
  const [auswahl, setAuswahl] = useState<Set<string>>(new Set());
  const [uebersichtDruck, setUebersichtDruck] = useState(false);
  const [elternDruck, setElternDruck] = useState(false);

  const gefiltert = useMemo(
    () => (filter === 'alle' ? woerter : woerter.filter((w) => w.status === filter)),
    [woerter, filter],
  );

  function toggleAuswahl(id: string) {
    setAuswahl((alt) => {
      const neu = new Set(alt);
      if (neu.has(id)) neu.delete(id);
      else neu.add(id);
      return neu;
    });
  }

  async function massenStatus(status: WortStatus) {
    await Promise.all([...auswahl].map((id) => repository.updateLernwort(id, { status })));
    setAuswahl(new Set());
  }
  async function massenLoeschen() {
    if (!confirm(`${auswahl.size} Wörter löschen?`)) return;
    await repository.deleteLernwoerter([...auswahl]);
    setAuswahl(new Set());
  }

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn-primary"
          onClick={() => setAddModal({ offen: true, tab: 'einzeln' })}
        >
          <IconPlus width={18} height={18} /> Wörter hinzufügen
        </button>
        {woerter.length > 0 && (
          <button
            className="btn-secondary"
            onClick={() => setLinkOffen(true)}
            title="Teilbaren Übungslink für dieses Kind erzeugen"
          >
            <IconLink width={18} height={18} /> Übungslink
          </button>
        )}
        {woerter.length > 0 && (
          <button
            className="btn-ghost"
            onClick={() => {
              setElternDruck(true);
              setTimeout(() => drucke(), 60);
            }}
            title="Übungsblatt für zu Hause drucken"
          >
            <IconBook width={18} height={18} /> Elternblatt
          </button>
        )}
        {woerter.length > 0 && (
          <button
            className="btn-ghost"
            onClick={() => {
              setUebersichtDruck(true);
              setTimeout(() => drucke(), 60);
            }}
            title="Lernstands-Übersicht drucken"
          >
            <IconList width={18} height={18} /> Übersicht
          </button>
        )}

        <div className="ml-auto flex items-center gap-1 rounded-lg border border-paper-300 bg-white p-0.5">
          {(['alle', ...STATUS_REIHENFOLGE] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                filter === f ? 'bg-brand-500 text-white' : 'text-ink-soft hover:bg-paper-100'
              }`}
            >
              {f === 'alle' ? `Alle (${woerter.length})` : t.status[f]}
            </button>
          ))}
        </div>
      </div>

      {auswahl.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
          <span className="font-medium text-brand-700">{auswahl.size} ausgewählt</span>
          {STATUS_REIHENFOLGE.map((s) => (
            <button key={s} className="btn-ghost py-1" onClick={() => massenStatus(s)}>
              → {t.status[s]}
            </button>
          ))}
          <button className="btn-ghost py-1 text-danger-500" onClick={massenLoeschen}>
            <IconTrash width={16} height={16} /> Löschen
          </button>
          <button className="btn-ghost py-1" onClick={() => setAuswahl(new Set())}>
            Auswahl aufheben
          </button>
        </div>
      )}

      {gefiltert.length === 0 ? (
        <EmptyState
          titel="Noch keine Lernwörter"
          text="Fügen Sie Wörter manuell hinzu oder picken Sie sie aus einem eingefügten Kindertext heraus."
        >
          <button
            className="btn-primary"
            onClick={() => setAddModal({ offen: true, tab: 'text' })}
          >
            <IconSparkles width={18} height={18} /> Aus Text herauspicken
          </button>
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {gefiltert.map((w) => (
            <LernwortZeile
              key={w.id}
              wort={w}
              ausgewaehlt={auswahl.has(w.id)}
              onToggle={() => toggleAuswahl(w.id)}
              onEdit={() => setEditor({ offen: true, wort: w })}
            />
          ))}
        </ul>
      )}

      <LernwortEditor
        state={editor}
        kindId={kind.id}
        onClose={() => setEditor({ offen: false })}
      />
      <WortHinzufuegenModal
        state={addModal}
        kind={kind}
        einstellungen={einstellungen}
        vorhandene={woerter}
        onClose={() => setAddModal((a) => ({ ...a, offen: false }))}
      />
      <UebungslinkModal
        offen={linkOffen}
        kind={kind}
        woerter={woerter}
        einstellungen={einstellungen}
        onClose={() => setLinkOffen(false)}
      />

      {uebersichtDruck && (
        <PrintPortal solo>
          <LernstandDocument
            kindName={displayName(kind.name, einstellungen.nurInitialen)}
            lernstand={t.lernstand[kind.lernstand]}
            datum={new Date().toLocaleDateString('de-DE')}
            woerter={woerter}
            lehrkraft={einstellungen.lehrkraftName || undefined}
            schule={einstellungen.schulName || undefined}
          />
        </PrintPortal>
      )}
      {elternDruck && (
        <PrintPortal solo>
          <ElternblattDocument
            woerter={gefiltert}
            kindName={displayName(kind.name, einstellungen.nurInitialen)}
            datum={new Date().toLocaleDateString('de-DE')}
            lineatur={einstellungen.standardLineatur}
            lehrkraft={einstellungen.lehrkraftName || undefined}
            schule={einstellungen.schulName || undefined}
            fontFamily={einstellungen.standardVorlageFont}
          />
        </PrintPortal>
      )}
    </div>
  );
}

function LernwortZeile({
  wort,
  ausgewaehlt,
  onToggle,
  onEdit,
}: {
  wort: Lernwort;
  ausgewaehlt: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  async function zyklusStatus() {
    const idx = STATUS_REIHENFOLGE.indexOf(wort.status);
    const next = STATUS_REIHENFOLGE[(idx + 1) % STATUS_REIHENFOLGE.length];
    await repository.updateLernwort(wort.id, { status: next });
  }
  async function duplizieren() {
    await repository.addLernwort(wort.kindId, wort.wort, {
      artikel: wort.artikel,
      wortart: wort.wortart,
      silben: wort.silben,
      merkstellen: wort.merkstellen,
      quelle: wort.quelle,
      notiz: wort.notiz,
    });
  }
  async function loeschen() {
    if (confirm(`„${wort.wort}" löschen?`)) await repository.deleteLernwort(wort.id);
  }

  const merkSet = new Set(wort.merkstellen);

  return (
    <li className="card flex items-center gap-3 px-3 py-2.5">
      <input
        type="checkbox"
        checked={ausgewaehlt}
        onChange={onToggle}
        className="h-4 w-4 shrink-0 accent-brand-500"
        aria-label={`${wort.wort} auswählen`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          {wort.artikel && <span className="text-sm text-ink-faint">{wort.artikel}</span>}
          <span className="font-serif text-lg text-ink">
            {wort.wort.split('').map((ch, i) => (
              <span
                key={i}
                className={merkSet.has(i) ? 'border-b-2 border-danger-500 text-danger-500' : ''}
              >
                {ch}
              </span>
            ))}
          </span>
          <span className="text-sm text-ink-faint">{formatSyllables(wort.silben)}</span>
        </div>
        {(wort.quelle || wort.notiz) && (
          <p className="truncate text-xs text-ink-faint">
            {[wort.quelle, wort.notiz].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
      <button onClick={zyklusStatus} aria-label="Status ändern" title="Status weiterschalten">
        <StatusBadge status={wort.status} />
      </button>
      <div className="flex shrink-0">
        <button className="btn-ghost p-1.5" onClick={onEdit} aria-label="Bearbeiten">
          <IconEdit width={16} height={16} />
        </button>
        <button className="btn-ghost p-1.5" onClick={duplizieren} aria-label="Duplizieren">
          <IconCopy width={16} height={16} />
        </button>
        <button
          className="btn-ghost p-1.5 text-danger-500"
          onClick={loeschen}
          aria-label="Löschen"
        >
          <IconTrash width={16} height={16} />
        </button>
      </div>
    </li>
  );
}

/** Bearbeiten eines vorhandenen Lernworts (eigener Dialog). */
function LernwortEditor({
  state,
  kindId,
  onClose,
}: {
  state: { offen: boolean; wort?: Lernwort };
  kindId: string;
  onClose: () => void;
}) {
  return (
    <Modal
      offen={state.offen}
      titel={state.wort ? 'Lernwort bearbeiten' : 'Lernwort hinzufügen'}
      onClose={onClose}
      weit
    >
      <LernwortForm vorhanden={state.wort} kindId={kindId} onClose={onClose} />
    </Modal>
  );
}

/**
 * Formular für ein einzelnes Lernwort. Ohne Modalrahmen, damit es sowohl im
 * Bearbeiten-Dialog als auch im „Wörter hinzufügen"-Popup (Reiter „Einzeln")
 * verwendet werden kann. Im Anlege-Modus bleibt es nach dem Speichern offen,
 * damit mehrere Wörter zügig nacheinander erfasst werden können.
 */
function LernwortForm({
  vorhanden,
  kindId,
  onClose,
}: {
  vorhanden?: Lernwort;
  kindId: string;
  onClose: () => void;
}) {
  const wortRef = useRef<HTMLInputElement>(null);
  const [zuletzt, setZuletzt] = useState<string | null>(null);
  const [wort, setWort] = useState('');
  const [artikel, setArtikel] = useState('');
  const [wortart, setWortart] = useState('');
  const [breaks, setBreaks] = useState<number[]>([]);
  const [merkstellen, setMerkstellen] = useState<number[]>([]);
  const [status, setStatus] = useState<WortStatus>('neu');
  const [quelle, setQuelle] = useState('');
  const [notiz, setNotiz] = useState('');

  // Felder initialisieren (beim Mounten und falls sich das bearbeitete Wort ändert).
  useEffect(() => {
    const w = vorhanden;
    setWort(w?.wort ?? '');
    setArtikel(w?.artikel ?? '');
    setWortart(w?.wortart ?? '');
    setBreaks(w ? breakpointsFromSyllables(w.silben) : []);
    setMerkstellen(w?.merkstellen ?? []);
    setStatus(w?.status ?? 'neu');
    setQuelle(w?.quelle ?? '');
    setNotiz(w?.notiz ?? '');
  }, [vorhanden]);

  function felderLeeren() {
    setWort('');
    setArtikel('');
    setWortart('');
    setBreaks([]);
    setMerkstellen([]);
    setStatus('neu');
    setQuelle('');
    setNotiz('');
  }

  // Beim Tippen eines neuen Wortes automatisch Vorschläge aus dem Wörterbuch
  // erzeugen (korrekte Silbentrennung; Artikel, falls bekannt).
  function onWortChange(v: string) {
    setWort(v);
    if (!vorhanden) {
      const info = lookupWort(v);
      setBreaks(breakpointsFromSyllables(info.silben));
      setMerkstellen(info.merkstellen);
      if (info.artikelGefunden && info.artikel) setArtikel(info.artikel);
    }
  }

  function toggleBreak(idx: number) {
    setBreaks((alt) =>
      alt.includes(idx) ? alt.filter((b) => b !== idx) : [...alt, idx].sort((a, b) => a - b),
    );
  }
  function toggleMerk(idx: number) {
    setMerkstellen((alt) =>
      alt.includes(idx) ? alt.filter((m) => m !== idx) : [...alt, idx].sort((a, b) => a - b),
    );
  }

  const silben = syllablesFromBreakpoints(wort, breaks);

  async function speichern() {
    if (!wort.trim()) return;
    const daten: Partial<Lernwort> = {
      artikel: (artikel as Lernwort['artikel']) || '',
      wortart: wortart.trim() || undefined,
      silben,
      merkstellen,
      status,
      quelle: quelle.trim() || undefined,
      notiz: notiz.trim() || undefined,
    };
    if (vorhanden) {
      await repository.updateLernwort(vorhanden.id, { wort: wort.trim(), ...daten });
      onClose();
    } else {
      // Anlege-Modus: offen lassen und für das nächste Wort zurücksetzen.
      const gespeichert = wort.trim();
      await repository.addLernwort(kindId, gespeichert, daten);
      setZuletzt(gespeichert);
      felderLeeren();
      wortRef.current?.focus();
    }
  }

  return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <div>
            <label className="label" htmlFor="lw-wort">
              Wort
            </label>
            <input
              id="lw-wort"
              ref={wortRef}
              className="input font-serif text-lg"
              value={wort}
              autoFocus
              onChange={(e) => onWortChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void speichern();
                }
              }}
            />
          </div>
          <div>
            <label className="label" htmlFor="lw-artikel">
              Artikel
            </label>
            <select
              id="lw-artikel"
              className="input"
              value={artikel}
              onChange={(e) => setArtikel(e.target.value)}
            >
              <option value="">—</option>
              <option value="der">der</option>
              <option value="die">die</option>
              <option value="das">das</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="lw-wortart">
              Wortart (optional)
            </label>
            <input
              id="lw-wortart"
              className="input"
              value={wortart}
              placeholder="Nomen, Verb …"
              onChange={(e) => setWortart(e.target.value)}
            />
          </div>
        </div>

        {/* Silbentrennung – Trennstellen per Klick setzen/entfernen */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="label mb-0">Silbentrennung (Vorschlag – bitte prüfen)</span>
            <button
              className="text-xs text-brand-600 hover:underline"
              onClick={() => setBreaks(breakpointsFromSyllables(woerterbuchSilben(wort)))}
            >
              Vorschlag neu
            </button>
          </div>
          <ClickbareLuecken
            wort={wort}
            breaks={breaks}
            onToggle={toggleBreak}
          />
          <p className="mt-1 text-sm text-ink-faint">
            Ergebnis: <span className="font-serif">{formatSyllables(silben) || '—'}</span>
          </p>
        </div>

        {/* Merkstellen – Buchstaben per Klick markieren */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="label mb-0">Merkstellen (schwierige Stellen)</span>
            <button
              className="text-xs text-brand-600 hover:underline"
              onClick={() => setMerkstellen(suggestMerkstellen(wort))}
            >
              Vorschlag neu
            </button>
          </div>
          <ClickbareBuchstaben wort={wort} markiert={merkstellen} onToggle={toggleMerk} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="lw-status">
              Status
            </label>
            <select
              id="lw-status"
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value as WortStatus)}
            >
              {STATUS_REIHENFOLGE.map((s) => (
                <option key={s} value={s}>
                  {t.status[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="lw-quelle">
              Quelle / Textbezug
            </label>
            <input
              id="lw-quelle"
              className="input"
              value={quelle}
              placeholder="z. B. Aufsatz Wochenende"
              onChange={(e) => setQuelle(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="lw-notiz">
            Notiz
          </label>
          <textarea
            id="lw-notiz"
            className="input min-h-[52px]"
            value={notiz}
            onChange={(e) => setNotiz(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          {zuletzt && !vorhanden && (
            <span className="mr-auto flex items-center gap-1 text-sm text-brand-700">
              <IconCheck width={16} height={16} /> „{zuletzt}" hinzugefügt
            </span>
          )}
          <button className="btn-secondary" onClick={onClose}>
            {vorhanden ? t.common.abbrechen : t.common.schliessen}
          </button>
          <button className="btn-primary" onClick={speichern} disabled={!wort.trim()}>
            <IconCheck width={18} height={18} />{' '}
            {vorhanden ? t.common.speichern : 'Hinzufügen'}
          </button>
        </div>
      </div>
  );
}

/** Wort mit klickbaren Lücken zwischen den Buchstaben (Trennstellen-Editor). */
function ClickbareLuecken({
  wort,
  breaks,
  onToggle,
}: {
  wort: string;
  breaks: number[];
  onToggle: (idx: number) => void;
}) {
  if (!wort) return <p className="text-sm text-ink-faint">Bitte zuerst ein Wort eingeben.</p>;
  const breakSet = new Set(breaks);
  return (
    <div className="flex flex-wrap items-center rounded-lg border border-paper-300 bg-paper-50 px-2 py-3 font-serif text-2xl">
      {wort.split('').map((ch, i) => (
        <span key={i} className="flex items-center">
          <span>{ch}</span>
          {i < wort.length - 1 && (
            <button
              onClick={() => onToggle(i + 1)}
              className={`mx-0.5 h-7 w-2 rounded-full transition-colors ${
                breakSet.has(i + 1) ? 'bg-brand-500' : 'bg-paper-300 hover:bg-brand-200'
              }`}
              aria-label={breakSet.has(i + 1) ? 'Trennstelle entfernen' : 'Trennstelle setzen'}
              title="Trennstelle umschalten"
            />
          )}
        </span>
      ))}
    </div>
  );
}

/** Wort mit klickbaren Buchstaben (Merkstellen-Editor). */
function ClickbareBuchstaben({
  wort,
  markiert,
  onToggle,
}: {
  wort: string;
  markiert: number[];
  onToggle: (idx: number) => void;
}) {
  if (!wort) return <p className="text-sm text-ink-faint">Bitte zuerst ein Wort eingeben.</p>;
  const markSet = new Set(markiert);
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border border-paper-300 bg-paper-50 px-2 py-3 font-serif text-2xl">
      {wort.split('').map((ch, i) => (
        <button
          key={i}
          onClick={() => onToggle(i)}
          className={`min-w-[1.4rem] rounded px-1 transition-colors ${
            markSet.has(i)
              ? 'bg-danger-500 text-white'
              : 'hover:bg-paper-200'
          }`}
          aria-pressed={markSet.has(i)}
          aria-label={`Buchstabe ${ch} markieren`}
        >
          {ch}
        </button>
      ))}
    </div>
  );
}

function TextExtraktorBody({
  kind,
  einstellungen,
  vorhandene,
}: {
  kind: Kind;
  einstellungen: Einstellungen;
  vorhandene: Lernwort[];
}) {
  const [text, setText] = useState('');
  const [hinzugefuegt, setHinzugefuegt] = useState<Set<string>>(new Set());
  const [ocrLaden, setOcrLaden] = useState(false);
  const [ocrInfo, setOcrInfo] = useState<string | null>(null);
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [fotoGross, setFotoGross] = useState(false);
  const fotoRef = useRef<HTMLInputElement>(null);

  // Beim Verlassen des Reiters eine evtl. erzeugte Foto-Vorschau freigeben.
  useEffect(() => {
    return () => {
      if (fotoUrl) URL.revokeObjectURL(fotoUrl);
    };
  }, [fotoUrl]);

  const tokens = useMemo(() => tokenize(text), [text]);
  const existierende = useMemo(
    () => buildExistingSet(vorhandene.map((w) => w.wort)),
    [vorhandene],
  );

  async function uebernehmen(wort: string) {
    await uebernehmeWort(kind.id, wort, 'Text-Extraktion');
    setHinzugefuegt((alt) => new Set(alt).add(normalizeForCompare(wort)));
  }

  // Offene (noch nicht vorhandene) Wörter der Tokenliste, ohne Dubletten.
  const offeneWoerter = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const tk of tokens) {
      const n = normalizeForCompare(tk.wort);
      if (existierende.has(n) || hinzugefuegt.has(n) || seen.has(n)) continue;
      seen.add(n);
      result.push(tk.wort);
    }
    return result;
  }, [tokens, existierende, hinzugefuegt]);

  async function alleUebernehmen() {
    const woerter = offeneWoerter;
    await uebernehmeWoerter(kind.id, woerter, 'Text-Extraktion');
    setHinzugefuegt((alt) => {
      const s = new Set(alt);
      woerter.forEach((w) => s.add(normalizeForCompare(w)));
      return s;
    });
  }

  async function fotoGewaehlt(file: File) {
    // Vorschau erzeugen (vorherige URL freigeben)
    setFotoUrl((alt) => {
      if (alt) URL.revokeObjectURL(alt);
      return URL.createObjectURL(file);
    });
    setOcrLaden(true);
    setOcrInfo(null);
    try {
      const { text: erkannt, engine } = await erkenneTextAusFoto(file, einstellungen);
      setText((alt) => (alt.trim() ? `${alt}\n${erkannt}` : erkannt));
      setOcrInfo(`Text erkannt mit ${engine === 'claude' ? 'Claude Vision' : 'Gemini'}.`);
    } catch (e) {
      setOcrInfo(e instanceof Error ? e.message : 'Texterkennung fehlgeschlagen.');
    } finally {
      setOcrLaden(false);
    }
  }

  return (
      <div className="space-y-3">
        <p className="text-sm text-ink-soft">
          Fügen Sie den (abgetippten) Text des Kindes ein oder laden Sie ein Foto hoch – klicken Sie
          dann die Lernwörter an. Bereits vorhandene Wörter sind markiert.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fotoRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void fotoGewaehlt(f);
              e.target.value = '';
            }}
          />
          <button
            className="btn-secondary"
            onClick={() => fotoRef.current?.click()}
            disabled={ocrLaden}
          >
            <IconCamera width={18} height={18} />
            {ocrLaden ? 'Text wird erkannt …' : 'Foto hochladen (Texterkennung)'}
          </button>
          {fotoUrl && (
            <button
              type="button"
              onClick={() => setFotoGross(true)}
              className="group relative h-12 w-12 shrink-0 overflow-hidden rounded-md border border-paper-300"
              title="Foto groß anzeigen"
            >
              <img src={fotoUrl} alt="Hochgeladenes Foto" className="h-full w-full object-cover" />
              <span className="absolute inset-0 hidden items-center justify-center bg-ink/40 text-[10px] font-medium text-white group-hover:flex">
                Groß
              </span>
            </button>
          )}
          {ocrInfo && <span className="text-xs text-ink-soft">{ocrInfo}</span>}
        </div>
        {fotoGross && fotoUrl && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/80 p-6"
            onClick={() => setFotoGross(false)}
            role="dialog"
            aria-label="Foto-Vollansicht"
          >
            <img
              src={fotoUrl}
              alt="Hochgeladenes Foto (groß)"
              className="max-h-full max-w-full rounded-lg shadow-card"
            />
            <button
              className="absolute right-4 top-4 rounded-md bg-white/90 px-3 py-1.5 text-sm font-medium text-ink"
              onClick={() => setFotoGross(false)}
            >
              Schließen
            </button>
          </div>
        )}
        <textarea
          className="input min-h-[120px] font-serif"
          placeholder="Text hier einfügen oder per Foto erkennen lassen …"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        {tokens.length > 0 && (
          <div className="rounded-lg border border-paper-200 bg-paper-50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                Wörter anklicken zum Übernehmen
              </p>
              {offeneWoerter.length > 0 && (
                <button className="btn-ghost py-1 text-xs" onClick={alleUebernehmen}>
                  <IconCheck width={14} height={14} /> Alle übernehmen ({offeneWoerter.length})
                </button>
              )}
            </div>
            <WortChips
              items={tokens}
              istVorhanden={(w) => {
                const n = normalizeForCompare(w);
                return existierende.has(n) || hinzugefuegt.has(n);
              }}
              onAdd={uebernehmen}
            />
          </div>
        )}
      </div>
  );
}

function GrundwortschatzBody({
  kind,
  einstellungen,
  vorhandene,
}: {
  kind: Kind;
  einstellungen: Einstellungen;
  vorhandene: Lernwort[];
}) {
  const eigeneListen = useWortlisten();
  const [listeId, setListeId] = useState(
    () => einstellungen.grundwortschatzId || GRUNDWORTSCHATZ_LISTEN[0].id,
  );
  const [eintraege, setEintraege] = useState<GrundwortschatzEintrag[]>([]);
  const [hinzugefuegt, setHinzugefuegt] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (listeId) void ladeGrundwortschatz(listeId).then(setEintraege);
  }, [listeId]);

  const existierende = useMemo(
    () => buildExistingSet(vorhandene.map((w) => w.wort)),
    [vorhandene],
  );

  const offene = useMemo(
    () =>
      eintraege.filter((e) => {
        const n = normalizeForCompare(e.wort);
        return !existierende.has(n) && !hinzugefuegt.has(n);
      }),
    [eintraege, existierende, hinzugefuegt],
  );

  const eintragProWort = useMemo(() => new Map(eintraege.map((e) => [e.wort, e])), [eintraege]);

  // Kuratierter Listen-Artikel (#14) überschreibt beim Import den
  // Wörterbuch-Vorschlag (null = bewusst ohne Artikel).
  async function uebernehmen(e: GrundwortschatzEintrag) {
    await uebernehmeWort(kind.id, e.wort, 'Grundwortschatz', e.artikel);
    setHinzugefuegt((alt) => new Set(alt).add(normalizeForCompare(e.wort)));
  }

  async function alleUebernehmen() {
    const liste = offene;
    for (const e of liste) {
      await uebernehmeWort(kind.id, e.wort, 'Grundwortschatz', e.artikel);
    }
    setHinzugefuegt((alt) => {
      const s = new Set(alt);
      liste.forEach((e) => s.add(normalizeForCompare(e.wort)));
      return s;
    });
  }

  return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input max-w-xs"
            value={listeId}
            onChange={(e) => setListeId(e.target.value)}
          >
            <optgroup label="Mitgeliefert">
              {GRUNDWORTSCHATZ_LISTEN.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </optgroup>
            {eigeneListen.length > 0 && (
              <optgroup label="Eigene (importiert)">
                {eigeneListen.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label} ({l.woerter.length})
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {offene.length > 0 && (
            <button className="btn-secondary" onClick={alleUebernehmen}>
              <IconCheck width={16} height={16} /> Alle übernehmen ({offene.length})
            </button>
          )}
        </div>
        <p className="text-sm text-ink-soft">
          {eintraege.length} Wörter · bereits in der Kartei vorhandene sind markiert.
        </p>
        <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-paper-200 bg-paper-50 p-3">
          <WortChips
            items={eintraege.map((e) => ({ wort: e.wort, key: e.wort }))}
            istVorhanden={(w) => {
              const n = normalizeForCompare(w);
              return existierende.has(n) || hinzugefuegt.has(n);
            }}
            onAdd={(w) => {
              void uebernehmen(eintragProWort.get(w) ?? { wort: w });
            }}
          />
        </div>
      </div>
  );
}

/** Gemeinsames Popup mit drei Wegen, Wörter hinzuzufügen. */
function WortHinzufuegenModal({
  state,
  kind,
  einstellungen,
  vorhandene,
  onClose,
}: {
  state: { offen: boolean; tab: AddTab };
  kind: Kind;
  einstellungen: Einstellungen;
  vorhandene: Lernwort[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<AddTab>(state.tab);
  // Beim Öffnen den gewünschten Reiter setzen (z. B. „Aus Text" aus dem Leerzustand).
  useEffect(() => {
    if (state.offen) setTab(state.tab);
  }, [state.offen, state.tab]);

  const reiter: { id: AddTab; label: string; icon: typeof IconPlus }[] = [
    { id: 'einzeln', label: 'Einzeln', icon: IconPlus },
    { id: 'text', label: 'Aus Text', icon: IconSparkles },
    { id: 'gws', label: 'Aus Grundwortschatz', icon: IconBook },
  ];

  return (
    <Modal offen={state.offen} titel="Wörter hinzufügen" onClose={onClose} weit>
      <div className="mb-4 flex flex-wrap gap-1 rounded-lg border border-paper-300 bg-white p-0.5 text-sm">
        {reiter.map((r) => {
          const Icon = r.icon;
          const aktiv = tab === r.id;
          return (
            <button
              key={r.id}
              onClick={() => setTab(r.id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
                aktiv ? 'bg-brand-500 text-white' : 'text-ink-soft hover:bg-paper-100'
              }`}
            >
              <Icon width={16} height={16} /> {r.label}
            </button>
          );
        })}
      </div>

      {tab === 'einzeln' && <LernwortForm kindId={kind.id} onClose={onClose} />}
      {tab === 'text' && (
        <TextExtraktorBody kind={kind} einstellungen={einstellungen} vorhandene={vorhandene} />
      )}
      {tab === 'gws' && (
        <GrundwortschatzBody kind={kind} einstellungen={einstellungen} vorhandene={vorhandene} />
      )}
    </Modal>
  );
}
