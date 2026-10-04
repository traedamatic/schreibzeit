// Standard-Einstellungen — eigenes Modul, damit Repository-Implementierungen
// und UI-Hooks sie ohne Importzyklen teilen können.
import type { Einstellungen } from '@/types';

export const DEFAULT_EINSTELLUNGEN: Einstellungen = {
  id: 'app',
  geminiApiKey: '',
  geminiModell: 'gemini-2.5-flash',
  claudeVisionAktiv: false,
  claudeApiKey: '',
  claudeModell: 'claude-opus-4-8',
  lehrkraftName: '',
  schulName: '',
  standardLineatur: 'klasse2',
  standardVorlageFont: 'Andika',
  standardWoerterProBlatt: 10,
  nurInitialen: false,
  datenschutzBestaetigt: false,
  standardSpalten: ['vorlage', 'schwingen', 'merkstellen', 'auswendig'],
  customLineaturen: [],
  grundwortschatzId: '',
};
