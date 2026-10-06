// Server-side domain types. Column-shaped row interfaces (snake_case) mirror the
// SQLite schema and the client model in `src/types/index.ts` + `src/core/srs.ts`,
// so the server stays the source of truth for the same data the client uses.

export type Lernstand = 'klasse1' | 'klasse2' | 'klasse3' | 'klasse4' | 'foerder' | 'lrs';
export type WortStatus = 'neu' | 'wird_geuebt' | 'sitzt';
export type Artikel = 'der' | 'die' | 'das' | '';
export type SubjectType = 'admin' | 'kid';

export const LERNSTAND_VALUES: readonly Lernstand[] = [
  'klasse1',
  'klasse2',
  'klasse3',
  'klasse4',
  'foerder',
  'lrs',
];
export const WORT_STATUS_VALUES: readonly WortStatus[] = ['neu', 'wird_geuebt', 'sitzt'];
export const ARTIKEL_VALUES: readonly Artikel[] = ['der', 'die', 'das', ''];

/** Übungsart eines Kindes: alles üben, nur Nomen (#15) oder Groß/klein-Quiz (#16). */
export type UebungsModus = 'alle' | 'nomen' | 'quiz';
export const UEBUNGS_MODUS_VALUES: readonly UebungsModus[] = ['alle', 'nomen', 'quiz'];

/** Art eines Practice-Events (#16): Schreibübung (SRS) oder Quiz (nur Zeit). */
export type PracticeArt = 'schreiben' | 'quiz';
export const PRACTICE_ART_VALUES: readonly PracticeArt[] = ['schreiben', 'quiz'];

export interface FamilyRow {
  id: string;
  name: string | null;
  created_at: number;
}

export interface AdminRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  /** Familie, zu der dieser Admin gehört (Tenant-Grenze). */
  family_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface KidRow {
  id: string;
  /** Creating admin (audit only — not an access boundary; family-shared). */
  admin_id: string | null;
  /** Familie, der das Kind gehört — die Sichtbarkeits-/Zugriffsgrenze. */
  family_id: string | null;
  name: string;
  pin_hash: string | null;
  lernstand: Lernstand;
  notiz: string | null;
  /** Daily practice time goal in seconds (default 300 = 5 min). */
  daily_goal_seconds: number;
  /** Harte Tagesobergrenze in Sekunden (#18, default 600 = 10 min). */
  daily_cap_seconds: number;
  /**
   * Übungsart (#15). Seit #18 wählt das Kind die Übung pro Session selbst; dieses
   * Feld bleibt für Abwärtskompatibilität erhalten, steuert aber nichts mehr.
   */
  uebungs_modus: UebungsModus;
  pin_failed_count: number;
  pin_locked_until: number | null;
  created_at: number;
  updated_at: number;
}

export interface WordRow {
  id: string;
  kid_id: string;
  wort: string;
  artikel: string | null;
  wortart: string | null;
  /** JSON array of syllables. */
  silben: string;
  /** JSON array of 0-based char indices. */
  merkstellen: string;
  status: WortStatus;
  fach: number;
  faellig_am: number | null;
  quelle: string | null;
  notiz: string | null;
  created_at: number;
  updated_at: number;
}

export interface PracticeEventRow {
  id: string;
  kid_id: string;
  word_id: string;
  /** Client-supplied grouping id for one practice run. */
  session_id: string;
  /** 0 | 1. */
  correct: number;
  duration_ms: number;
  /** 'schreiben' (SRS-wirksam) oder 'quiz' (nur Zeit/Statistik, #16). */
  art: PracticeArt;
  fach_before: number | null;
  fach_after: number | null;
  practiced_at: number;
}

export interface AuthSessionRow {
  id: string;
  subject_type: SubjectType;
  subject_id: string;
  created_at: number;
  expires_at: number;
  last_seen_at: number | null;
}
