import { useEffect, useRef, useState } from 'react';
import { Sidebar, SidebarRail } from './components/Sidebar';
import { AppMenuBar } from './components/AppMenuBar';
import { KarteiView } from './views/KarteiView';
import { KnickblattView } from './views/KnickblattView';
import { UebungstextView } from './views/UebungstextView';
import { WortkartenView } from './views/WortkartenView';
import { DashboardView } from './views/DashboardView';
import { EinstellungenModal } from './views/EinstellungenView';
import { DatenschutzBanner } from './components/DatenschutzBanner';
import { AdminAnmeldung, SyncStatusChip } from './components/ServerSync';
import { Modal } from './components/ui';
import {
  IconBook,
  IconCards,
  IconFold,
  IconMenu,
  IconSparkles,
  IconUsers,
} from './components/icons';
import { istRemoteAktiv } from './services/api';
import { useEinstellungen, useKinder, useKlassen } from './state/hooks';
import { displayName, useUiStore, type TabId } from './state/store';
import { repository } from './db/repository';
import { ladeWoerterbuch } from './services/dictionary';
import { registriereAlleFonts } from './services/fonts';
import { t } from './i18n/de';

const TABS: { id: TabId; label: string; icon: typeof IconBook }[] = [
  { id: 'kartei', label: t.nav.kartei, icon: IconBook },
  { id: 'knickblatt', label: t.nav.knickblatt, icon: IconFold },
  { id: 'uebungstext', label: t.nav.uebungstext, icon: IconSparkles },
  { id: 'wortkarten', label: t.nav.wortkarten, icon: IconCards },
  // Das Dashboard (Familien-Überblick) gibt es nur im Server-Betrieb.
  ...(istRemoteAktiv()
    ? [{ id: 'dashboard' as TabId, label: t.nav.dashboard, icon: IconUsers }]
    : []),
];

export default function App() {
  const kinder = useKinder();
  const klassen = useKlassen();
  const einstellungen = useEinstellungen();
  const { selectedKindId, activeTab, setTab, setSelectedKind, einstellungenOffen, setEinstellungenOffen } =
    useUiStore();
  const [sidebarOffen, setSidebarOffen] = useState(false); // Mobil-Drawer
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('sz-sidebar-collapsed') === '1',
  );
  const [sidebarWidth, setSidebarWidth] = useState(
    () => Number(localStorage.getItem('sz-sidebar-width')) || 288,
  );
  const resizing = useRef(false);

  useEffect(() => {
    localStorage.setItem('sz-sidebar-collapsed', sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);
  useEffect(() => {
    localStorage.setItem('sz-sidebar-width', String(sidebarWidth));
  }, [sidebarWidth]);

  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    resizing.current = true;
    const onMove = (ev: PointerEvent) => {
      if (resizing.current) setSidebarWidth(Math.min(520, Math.max(240, ev.clientX)));
    };
    const onUp = () => {
      resizing.current = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // Sicherstellen, dass Einstellungen initialisiert sind, und das große
  // Wörterbuch (Artikel) im Hintergrund nachladen.
  useEffect(() => {
    void repository.getEinstellungen();
    void ladeWoerterbuch();
    void registriereAlleFonts();
  }, []);

  // Falls das ausgewählte Kind gelöscht wurde, Auswahl zurücksetzen.
  useEffect(() => {
    if (selectedKindId && !kinder.some((k) => k.id === selectedKindId)) {
      setSelectedKind(kinder[0]?.id);
    }
  }, [kinder, selectedKindId, setSelectedKind]);

  const kind = kinder.find((k) => k.id === selectedKindId);

  return (
    <>
      <div className="app-shell flex h-full flex-col overflow-hidden">
        <AppMenuBar />
        <div className="flex min-h-0 flex-1">
        {/* Sidebar – auf Mobil als Overlay */}
        <div
          className={`fixed inset-0 z-30 bg-ink/40 transition-opacity lg:hidden ${
            sidebarOffen ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
          onClick={() => setSidebarOffen(false)}
        />
        {/* Desktop eingeklappt: schmale Icon-Leiste statt komplettem Ausblenden,
            damit die Kinder sichtbar bleiben und das Ausklappen offensichtlich ist. */}
        {sidebarCollapsed && !sidebarOffen && (
          <div className="hidden lg:block">
            <SidebarRail
              kinder={kinder}
              klassen={klassen}
              einstellungen={einstellungen}
              selectedKindId={selectedKindId}
              onSelect={(id) => setSelectedKind(id)}
              onExpand={() => setSidebarCollapsed(false)}
            />
          </div>
        )}
        {(sidebarOffen || !sidebarCollapsed) && (
          <div
            className={`fixed inset-y-0 left-0 z-40 max-w-[85vw] transform transition-transform lg:static lg:translate-x-0 ${
              sidebarOffen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
            } ${sidebarCollapsed ? 'lg:hidden' : ''}`}
            style={{ width: sidebarWidth }}
          >
            <div className="relative h-full">
              <Sidebar
                kinder={kinder}
                klassen={klassen}
                einstellungen={einstellungen}
                selectedKindId={selectedKindId}
                onSelect={(id) => {
                  setSelectedKind(id);
                  setSidebarOffen(false);
                }}
                onCollapse={() => setSidebarCollapsed(true)}
              />
              {/* Breite ziehen (nur Desktop) */}
              <div
                onPointerDown={startResize}
                className="absolute right-0 top-0 hidden h-full w-1.5 cursor-col-resize bg-transparent hover:bg-brand-300/50 lg:block"
                role="separator"
                aria-orientation="vertical"
                aria-label="Seitenleiste breiter/schmaler ziehen"
              />
            </div>
          </div>
        )}

        {/* Hauptbereich */}
        <main className="flex min-w-0 flex-1 flex-col bg-paper-100">
          <header className="flex items-center gap-3 border-b border-paper-200 bg-paper-50 px-4 py-3">
            <button
              className="btn-ghost p-2 lg:hidden"
              onClick={() => setSidebarOffen(true)}
              aria-label="Menü öffnen"
            >
              <IconMenu />
            </button>
            {kind ? (
              <div className="min-w-0">
                <h1 className="truncate font-serif text-xl font-semibold text-ink">
                  {displayName(kind.name, einstellungen.nurInitialen)}
                </h1>
                <p className="text-sm text-ink-soft">
                  {t.lernstand[kind.lernstand]}
                  {kind.klasseId &&
                    ` · ${klassen.find((c) => c.id === kind.klasseId)?.name ?? ''}`}
                </p>
              </div>
            ) : (
              <h1 className="font-serif text-xl font-semibold text-ink">{t.app.name}</h1>
            )}
            <div className="ml-auto">
              <SyncStatusChip />
            </div>
          </header>

          {(kind || istRemoteAktiv()) && (
            <nav className="flex gap-1 overflow-x-auto border-b border-paper-200 bg-paper-50 px-2">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const aktiv = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setTab(tab.id)}
                    className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors ${
                      aktiv
                        ? 'border-brand-500 text-brand-600'
                        : 'border-transparent text-ink-soft hover:text-ink'
                    }`}
                    aria-current={aktiv ? 'page' : undefined}
                  >
                    <Icon width={18} height={18} />
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          )}

          <div className="flex-1 overflow-y-auto">
            {activeTab === 'dashboard' ? (
              <div className="mx-auto w-full max-w-[1400px] px-4 py-5 xl:mx-0">
                <DashboardView einstellungen={einstellungen} />
              </div>
            ) : !kind ? (
              <div className="mx-auto max-w-2xl px-4 py-16">
                <Willkommen onOpenSidebar={() => setSidebarOffen(true)} />
              </div>
            ) : (
              <div className="mx-auto w-full max-w-[1400px] px-4 py-5 xl:mx-0">
                {activeTab === 'kartei' && <KarteiView kind={kind} einstellungen={einstellungen} />}
                {activeTab === 'knickblatt' && (
                  <KnickblattView kind={kind} einstellungen={einstellungen} klassen={klassen} />
                )}
                {activeTab === 'uebungstext' && (
                  <UebungstextView kind={kind} einstellungen={einstellungen} />
                )}
                {activeTab === 'wortkarten' && (
                  <WortkartenView kind={kind} einstellungen={einstellungen} klassen={klassen} />
                )}
              </div>
            )}
          </div>
        </main>
        </div>
      </div>

      <Modal
        offen={einstellungenOffen}
        titel={t.nav.einstellungen}
        onClose={() => setEinstellungenOffen(false)}
        weit
      >
        <EinstellungenModal
          einstellungen={einstellungen}
          kinder={kinder}
          klassen={klassen}
          onClose={() => setEinstellungenOffen(false)}
        />
      </Modal>

      <AdminAnmeldung />
      {!einstellungen.datenschutzBestaetigt && <DatenschutzBanner />}
    </>
  );
}

function Willkommen({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  return (
    <div className="card p-8 text-center">
      <h2 className="font-serif text-2xl font-semibold text-ink">Willkommen bei Schreibzeit</h2>
      <p className="mx-auto mt-3 max-w-prose text-ink-soft">
        Führen Sie pro Kind eine Lernwörter-Kartei, erzeugen Sie druckfertige Knickblätter und
        passende Übungstexte. Alle Daten bleiben lokal auf diesem Gerät.
      </p>
      <ol className="mx-auto mt-6 max-w-md space-y-2 text-left text-sm text-ink-soft">
        <li>1. Links ein Kind anlegen (Klasse & Lernstand wählen).</li>
        <li>2. Lernwörter eintippen oder aus einem Text herauspicken.</li>
        <li>3. Knickblatt drucken oder einen KI-Übungstext erstellen.</li>
      </ol>
      <button className="btn-primary mt-6 lg:hidden" onClick={onOpenSidebar}>
        Zur Kinderliste
      </button>
    </div>
  );
}
