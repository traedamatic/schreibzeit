// Kid authentication: name + PIN login (child-friendly), kid-me, kid-logout,
// plus the admin-only set/reset-PIN endpoint. PINs are argon2id-hashed; the
// real defense against low-entropy PINs is per-kid lockout after N failures.
import { Elysia, t } from 'elysia';
import type { Database } from 'bun:sqlite';
import type { Config } from '../config';
import type { KidRow } from '../types';
import { adminContext, kidContext } from '../auth/guards';
import { hashSecret, verifySecret } from '../auth/password';
import { createSession, deleteSession } from '../auth/sessions';
import {
  clearPinFailures,
  getKidFuerFamilie,
  getKidsByName,
  isKidLocked,
  recordPinFailure,
  setKidPinHash,
} from '../kids/data';
import { KID_COOKIE } from '../auth/constants';

const PIN_PATTERN = '^[0-9]{4,8}$';
const MAX_PIN_FAILURES = 5;
const PIN_LOCK_MS = 5 * 60 * 1000;

function publicKid(kid: KidRow) {
  return {
    id: kid.id,
    name: kid.name,
    lernstand: kid.lernstand,
    dailyGoalSeconds: kid.daily_goal_seconds,
    uebungsModus: kid.uebungs_modus,
  };
}

export function kidAuthRoutes(db: Database, config: Config) {
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.COOKIE_SECURE,
    path: '/',
    maxAge: config.SESSION_TTL_SECONDS,
  };

  return new Elysia()
    .use(adminContext(db))
    .use(kidContext(db))
    // Admin-only: set or reset a kid's PIN.
    .put(
      '/kids/:id/pin',
      async ({ params, body, admin, set }) => {
        if (!admin) {
          set.status = 401;
          return { error: 'Not authenticated.' };
        }
        const kid = getKidFuerFamilie(db, params.id, admin.family_id);
        if (!kid) {
          set.status = 404;
          return { error: 'Kid not found.' };
        }
        setKidPinHash(db, kid.id, await hashSecret(body.pin));
        return { ok: true };
      },
      { body: t.Object({ pin: t.String({ pattern: PIN_PATTERN }) }) },
    )
    // Kid login: name + PIN.
    .post(
      '/auth/kid-login',
      async ({ body, cookie, set }) => {
        // Über Familien hinweg kann es Namensgleichheit geben — die PIN
        // disambiguiert: geprüft wird gegen alle Namenstreffer, die nicht
        // gesperrt sind. Fehlermeldung bleibt generisch (keine Enumeration).
        const kandidaten = getKidsByName(db, body.name).filter((k) => k.pin_hash !== null);
        if (kandidaten.length === 0) {
          set.status = 401;
          return { error: 'Wrong name or PIN.' };
        }
        const offen = kandidaten.filter((k) => !isKidLocked(k));
        if (offen.length === 0) {
          set.status = 429;
          return { error: 'Too many tries. Wait a little and ask a grown-up.' };
        }
        for (const kid of offen) {
          if (await verifySecret(body.pin, kid.pin_hash as string)) {
            clearPinFailures(db, kid.id);
            const token = createSession(db, 'kid', kid.id, config.SESSION_TTL_SECONDS);
            cookie[KID_COOKIE]?.set({ value: token, ...cookieOptions });
            return publicKid(kid);
          }
        }
        // Falsche PIN: Fehlversuch bei allen offenen Namenstreffern zählen
        // (pro-Kind-Lockout bleibt die Verteidigung gegen Raten).
        for (const kid of offen) recordPinFailure(db, kid, MAX_PIN_FAILURES, PIN_LOCK_MS);
        set.status = 401;
        return { error: 'Wrong name or PIN.' };
      },
      {
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 120 }),
          pin: t.String({ pattern: PIN_PATTERN }),
        }),
      },
    )
    .get('/auth/kid-me', ({ kid, set }) => {
      if (!kid) {
        set.status = 401;
        return { error: 'Not authenticated.' };
      }
      return publicKid(kid);
    })
    .post('/auth/kid-logout', ({ cookie, kidToken }) => {
      if (kidToken) deleteSession(db, kidToken);
      cookie[KID_COOKIE]?.remove();
      return { ok: true };
    });
}
