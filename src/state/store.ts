// UI-Zustand (nicht persistent): aktuelle Auswahl und aktiver Tab.
import { create } from 'zustand';

export type TabId = 'kartei' | 'knickblatt' | 'uebungstext' | 'wortkarten' | 'dashboard';

interface UiState {
  selectedKindId?: string;
  activeTab: TabId;
  einstellungenOffen: boolean;
  setSelectedKind: (id: string | undefined) => void;
  setTab: (tab: TabId) => void;
  setEinstellungenOffen: (offen: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  selectedKindId: undefined,
  activeTab: 'kartei',
  einstellungenOffen: false,
  setSelectedKind: (id) => set({ selectedKindId: id }),
  setTab: (tab) => set({ activeTab: tab }),
  setEinstellungenOffen: (offen) => set({ einstellungenOffen: offen }),
}));

/** Anzeigename eines Kindes – respektiert die „nur Initialen"-Einstellung. */
export function displayName(name: string, nurInitialen: boolean): string {
  if (!nurInitialen) return name;
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((teil) => teil[0]?.toUpperCase() + '.')
    .join(' ');
}
