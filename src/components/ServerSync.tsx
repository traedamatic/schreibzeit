// UI für den Familien-Server-Sync: Anmelde-Banner (erscheint bei 401) und ein
// kleiner Status-Chip für die Kopfzeile. Beide rendern nichts, wenn die App
// ohne Server (rein lokal) läuft.
import { useState } from 'react';
import { ApiError, adminApi, istRemoteAktiv } from '@/services/api';
import { useSyncStore, vollSync } from '@/services/serverSync';
import { t } from '@/i18n/de';

export function SyncStatusChip() {
  const { angemeldet, laeuft, fehler, adminEmail } = useSyncStore();
  if (!istRemoteAktiv()) return null;

  const [farbe, text] = laeuft
    ? ['bg-brand-500', t.sync.statusLaeuft]
    : angemeldet === false
      ? ['bg-amber-500', t.sync.statusAbgemeldet]
      : fehler
        ? ['bg-amber-500', t.sync.statusOffline]
        : ['bg-accent-600', t.sync.statusSynchron];

  return (
    <div className="flex items-center gap-2 text-xs text-ink-soft" title={adminEmail ?? undefined}>
      <span className={`inline-block h-2 w-2 rounded-full ${farbe}`} aria-hidden />
      <span className="hidden sm:inline">{text}</span>
      {angemeldet && (
        <button
          className="btn-ghost px-2 py-1 text-xs"
          onClick={() => {
            void adminApi.logout().catch(() => {});
            useSyncStore.getState().setAngemeldet(false);
          }}
        >
          {t.sync.abmelden}
        </button>
      )}
    </div>
  );
}

export function AdminAnmeldung() {
  const { angemeldet } = useSyncStore();
  const [modus, setModus] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [passwort, setPasswort] = useState('');
  const [name, setName] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [sendet, setSendet] = useState(false);

  if (!istRemoteAktiv() || angemeldet !== false) return null;

  async function absenden() {
    setSendet(true);
    setFehler(null);
    try {
      const admin =
        modus === 'login'
          ? await adminApi.login(email, passwort)
          : await adminApi.signup(email, passwort, name || undefined);
      useSyncStore.getState().setAngemeldet(true, admin.email);
      void vollSync();
    } catch (error) {
      setFehler(error instanceof ApiError ? error.message : 'Unbekannter Fehler.');
    } finally {
      setSendet(false);
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[22rem] max-w-[calc(100vw-2rem)]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void absenden();
        }}
        className="card space-y-3 p-5 shadow-lg"
      >
        <div>
          <h2 className="font-serif text-lg font-semibold text-ink">{t.sync.bannerTitel}</h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">{t.sync.bannerText}</p>
        </div>
        <input
          className="input w-full"
          type="email"
          required
          placeholder={t.sync.email}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
        <input
          className="input w-full"
          type="password"
          required
          minLength={8}
          placeholder={t.sync.passwort}
          value={passwort}
          onChange={(e) => setPasswort(e.target.value)}
          autoComplete={modus === 'login' ? 'current-password' : 'new-password'}
        />
        {modus === 'signup' && (
          <input
            className="input w-full"
            type="text"
            placeholder={t.sync.anzeigename}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
        {fehler && <p className="text-xs text-red-600">{fehler}</p>}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="btn-ghost px-2 py-1 text-xs"
            onClick={() => setModus(modus === 'login' ? 'signup' : 'login')}
          >
            {modus === 'login' ? t.sync.kontoErstellen : t.sync.zurAnmeldung}
          </button>
          <button type="submit" className="btn-primary" disabled={sendet}>
            {modus === 'login' ? t.sync.anmelden : t.sync.kontoErstellen}
          </button>
        </div>
      </form>
    </div>
  );
}
