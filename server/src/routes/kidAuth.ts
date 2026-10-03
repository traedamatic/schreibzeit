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
  getKidById,
  getKidByName,
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
        const kid = getKidById(db, params.id);
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
        const kid = getKidByName(db, body.name);
        // Generic message: don't confirm which names exist.
        if (!kid || !kid.pin_hash) {
          set.status = 401;
          return { error: 'Wrong name or PIN.' };
        }
        if (isKidLocked(kid)) {
          set.status = 429;
          return { error: 'Too many tries. Wait a little and ask a grown-up.' };
        }
        const ok = await verifySecret(body.pin, kid.pin_hash);
        if (!ok) {
          recordPinFailure(db, kid, MAX_PIN_FAILURES, PIN_LOCK_MS);
          set.status = 401;
          return { error: 'Wrong name or PIN.' };
        }
        clearPinFailures(db, kid.id);
        const token = createSession(db, 'kid', kid.id, config.SESSION_TTL_SECONDS);
        cookie[KID_COOKIE]?.set({ value: token, ...cookieOptions });
        return publicKid(kid);
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
