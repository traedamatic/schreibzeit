// Zentrale Datentypen der Anwendung. Diese Typen bilden die Grundlage für die
// Persistenzschicht (Dexie) und werden vom Backup-Export/Import versioniert.

export type Id = string;

/** Lernstand eines Kindes – steuert u. a. die KI-Textschwierigkeit. */
export type Lernstand =
  | 'klasse1'
  | 'klasse2'
  | 'klasse3'
  | 'klasse4'
  | 'foerder'
  | 'lrs';

/** Lernstatus eines einzelnen Lernworts. */
export type WortStatus = 'neu' | 'wird_geuebt' | 'sitzt';

export interface Klasse {
  id: Id;
  name: string;
  /** Farbe zur besseren Unterscheidung in der Kinderliste. */
  farbe?: string;
  notiz?: string;
  erstelltAm: number;
  geaendertAm: number;
}

export interface Kind {
  id: Id;
  /** Anzeigename – kann laut Einstellung auch nur Initialen/Spitzname sein. */
  name: string;
  klasseId?: Id;
  lernstand: Lernstand;
  notiz?: string;
  erstelltAm: number;
  geaendertAm: number;
}

/**
 * Ein Lernwort einer Kind-Kartei.
 *
 * `silben` ist die getrennte Darstellung als Array von Silben
 * (z. B. ["Som", "mer"]). `merkstellen` ist eine Liste von Zeichen-Indizes
 * (0-basiert, bezogen auf `wort`), die als schwierige Stellen markiert sind.
 */
export interface Lernwort {
  id: Id;
  kindId: Id;
  wort: string;
  artikel?: 'der' | 'die' | 'das' | '';
  wortart?: string;
  silben: string[];
  merkstellen: number[];
  status: WortStatus;
  /** Spaced-Repetition: Leitner-Fach (1–5). */
  fach?: number;
  /** Spaced-Repetition: nächste Wiedervorlage (Zeitstempel). */
  faelligAm?: number;
  quelle?: string;
  notiz?: string;
  erstelltAm: number;
  geaendertAm: number;
}

/** Eine an einem Kind gespeicherte KI-/Übungstext-Erzeugung. */
export interface Uebungstext {
  id: Id;
  kindId: Id;
  titel: string;
  textart: TextArt;
  /** Vollständiger Text (bei Lückentext: mit eingesetzten Lernwörtern). */
  text: string;
  /** Bei Lückentext: die ausgeblendeten Lösungswörter in Reihenfolge. */
  loesungswoerter?: string[];
  verwendeteWoerter: string[];
  erstelltAm: number;
  geaendertAm: number;
}

export type TextArt = 'geschichte' | 'lueckentext' | 'quatschsaetze';

/** Lineatur-Vorgaben für Grundschul-Schreiblinien. */
export type Lineatur = 'klasse1' | 'klasse2' | 'klasse3' | 'klasse4' | 'haus';

/** Maße einer Schreiblinie in Millimetern. */
export interface LineaturMasse {
  oberHoehe: number;
  bandHoehe: number;
  unterHoehe: number;
  mittelbandFarbig: boolean;
  /**
   * Anzahl der gezeichneten Linien (DIN-konforme Grundschul-Lineaturen):
   * 'vier' = Ober-/Mittel-/Grund-/Unterlinie (Lin. 1/2),
   * 'zwei' = nur Mittel- und Grundlinie (Lin. 3),
   * 'eins' = nur Grundlinie (Lin. 4). Standard: 'vier'.
   */
  linienModus?: 'vier' | 'zwei' | 'eins';
}

/**
 * Selbst angelegte Lineatur: ein aus einem Foto/Bild zugeschnittener Streifen,
 * der als Schreiblinie verwendet wird.
 */
export interface CustomLineatur {
  id: string;
  name: string;
  /** Zugeschnittenes Bild als Data-URL. */
  bildUrl: string;
  /** Druckhöhe einer Zeile in Millimetern. */
  hoeheMm: number;
}

/** Selbst hinzugefügte Schriftart (Datei liegt in der `fonts`-Tabelle). */
export interface FontEintrag {
  id: string;
  /** CSS-Familienname, unter dem die Schrift registriert wird. */
  name: string;
  mime: string;
  /** Schriftdatei als Data-URL (lokal gespeichert). Fehlt bei System-Schriften. */
  dataUrl?: string;
  /** True = bereits auf dem System installierte Schrift (kein Datei-Upload nötig). */
  system?: boolean;
}

/** Selbst importierte Wortliste (eigener „Grundwortschatz"). */
export interface Wortliste {
  id: string;
  label: string;
  woerter: string[];
  erstelltAm: number;
}

/** Strategie-/Spaltentyp eines Knickblatts. */
export type SpaltenTyp =
  | 'vorlage'
  | 'schwingen'
  | 'merkstellen'
  | 'auswendig'
  | 'partner'
  | 'verlaengern'
  | 'ableiten'
  | 'merkwort'
  | 'benutzerdefiniert';

export interface Knickspalte {
  /** Eindeutige ID (erlaubt mehrere eigene Spalten gleichen Typs). */
  id: string;
  typ: SpaltenTyp;
  /** Eigener Spaltentitel (überschreibt den Standardtitel). */
  titel?: string;
  /** Eigenes Symbol/Emoji (überschreibt das Standardsymbol). */
  symbol?: string;
  /** Gestrichelte Falzlinie unmittelbar vor dieser Spalte einzeichnen. */
  falzDavor?: boolean;
  aktiv: boolean;
}

/** Konfiguration eines Knickblatts (datengetrieben, erweiterbar). */
export interface KnickblattConfig {
  spalten: Knickspalte[];
  woerterProBlatt: number;
  /** Lineatur-Kennung: eingebaut (klasse1…haus) oder ID einer eigenen Lineatur. */
  lineatur: string;
  /** Schriftfamilie für die Vorlage-Spalte (CSS font-family bzw. eigener Font-Name). */
  vorlageFont?: string;
  /** Vorlage-Spalte mit vorgedruckten Silbenbögen (Differenzierung). */
  vorlageMitSilben: boolean;
  /** Vorlage-Spalte mit markierten Merkstellen (Differenzierung). */
  vorlageMitMerkstellen: boolean;
  /** Vorlage als Umriss-/Hohlschrift zum Nachspuren. */
  vorlageNachspur?: boolean;
  thema?: string;
}

/**
 * Outbox-Eintrag für den Server-Sync: ein offline (oder vor dem Server-Ack)
 * getätigter Schreibvorgang, der beim nächsten Sync zum Familien-Server
 * gespielt wird. Reihenfolge über `seq` (auto-increment).
 */
export type SyncOp =
  | { typ: 'kind.create'; kind: Kind }
  | { typ: 'kind.update'; kind: Kind }
  | { typ: 'kind.delete'; id: Id }
  | { typ: 'wort.create'; wort: Lernwort }
  | { typ: 'wort.update'; id: Id; patch: Partial<Lernwort> }
  | { typ: 'wort.delete'; ids: Id[] };

export interface OutboxEintrag {
  seq?: number;
  op: SyncOp;
  erstelltAm: number;
}

export interface Einstellungen {
  id: 'app';
  geminiApiKey: string;
  geminiModell: string;
  /** Optionale, bessere Foto-Texterkennung über Claude Vision. */
  claudeVisionAktiv: boolean;
  claudeApiKey: string;
  claudeModell: string;
  lehrkraftName: string;
  schulName: string;
  standardLineatur: Lineatur;
  /** Standard-Schrift für gedruckte Vorlagen (Knickblatt, Wortkarten, Elternblatt). */
  standardVorlageFont: string;
  standardWoerterProBlatt: number;
  /** Nur Initialen/Spitznamen statt Klarnamen anzeigen (DSGVO-Hilfe). */
  nurInitialen: boolean;
  datenschutzBestaetigt: boolean;
  standardSpalten: SpaltenTyp[];
  /** Eigene, parametrisch angelegte Lineaturen. */
  customLineaturen: CustomLineatur[];
  /** Vorausgewählte Grundwortschatz-Liste (z. B. Bundesland), leer = keine. */
  grundwortschatzId: string;
}
