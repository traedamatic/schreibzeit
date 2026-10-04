// Admin authentication routes: signup (first admin open, then admin-gated),
// login, logout, and me. Sessions are httpOnly cookies; passwords argon2id.
import { Elysia, t } from 'elysia';
import type { Database } from 'bun:sqlite';
import type { Config } from '../config';
import type { AdminRow } from '../types';
import { adminContext } from '../auth/guards';
import { countAdmins, createAdmin, createFamily, getAdminByEmail } from '../auth/admins';
import { hashSecret, verifySecret } from '../auth/password';
import { createSession, deleteSession } from '../auth/sessions';
import { RateLimiter } from '../auth/rateLimit';
import { ADMIN_COOKIE } from '../auth/constants';

const EMAIL_PATTERN = '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$';

const CredentialsSchema = t.Object({
  email: t.String({ pattern: EMAIL_PATTERN, maxLength: 320 }),
  password: t.String({ minLength: 8, maxLength: 200 }),
});

const SignupSchema = t.Object({
  email: t.String({ pattern: EMAIL_PATTERN, maxLength: 320 }),
  password: t.String({ minLength: 8, maxLength: 200 }),
  displayName: t.Optional(t.String({ maxLength: 120 })),
});

function publicAdmin(row: AdminRow) {
  return { id: row.id, email: row.email, displayName: row.display_name };
}

export function authRoutes(db: Database, config: Config) {
  const loginLimiter = new RateLimiter(10, 15 * 60 * 1000);

  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.COOKIE_SECURE,
    path: '/',
    maxAge: config.SESSION_TTL_SECONDS,
  };

  return new Elysia({ prefix: '/auth' })
    .use(adminContext(db))
    .post(
      '/signup',
      async ({ body, admin, cookie, set }) => {
        // First admin may self-register; afterwards an admin must be logged in.
        if (countAdmins(db) > 0 && !admin) {
          set.status = 403;
          return { error: 'Signup is closed. Ask an existing admin to create your account.' };
        }
        if (getAdminByEmail(db, body.email)) {
          set.status = 409;
          return { error: 'That email is already registered.' };
        }
        // Familien-Zuordnung (#12): der erste Admin gründet die Familie;
        // eingeladene Admins (admin-gated signup) treten der Familie des
        // einladenden Admins bei.
        const familyId = admin ? admin.family_id : createFamily(db).id;
        const row = createAdmin(db, {
          email: body.email,
          passwordHash: await hashSecret(body.password),
          displayName: body.displayName ?? null,
          familyId,
        });
        const token = createSession(db, 'admin', row.id, config.SESSION_TTL_SECONDS);
        cookie[ADMIN_COOKIE]?.set({ value: token, ...cookieOptions });
        set.status = 201;
        return publicAdmin(row);
      },
      { body: SignupSchema },
    )
    .post(
      '/login',
      async ({ body, cookie, set }) => {
        const key = body.email.toLowerCase();
        if (!loginLimiter.check(key)) {
          set.status = 429;
          return { error: 'Too many attempts. Please wait and try again.' };
        }
        const row = getAdminByEmail(db, body.email);
        const ok = row ? await verifySecret(body.password, row.password_hash) : false;
        if (!row || !ok) {
          set.status = 401;
          return { error: 'Invalid email or password.' };
        }
        loginLimiter.reset(key);
        const token = createSession(db, 'admin', row.id, config.SESSION_TTL_SECONDS);
        cookie[ADMIN_COOKIE]?.set({ value: token, ...cookieOptions });
        return publicAdmin(row);
      },
      { body: CredentialsSchema },
    )
    .post('/logout', ({ cookie, adminToken }) => {
      if (adminToken) deleteSession(db, adminToken);
      cookie[ADMIN_COOKIE]?.remove();
      return { ok: true };
    })
    .get('/me', ({ admin, set }) => {
      if (!admin) {
        set.status = 401;
        return { error: 'Not authenticated.' };
      }
      return publicAdmin(admin);
    });
}
