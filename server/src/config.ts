// Validated configuration — the single place environment input enters the app.
// Per code_guidelines.md: validate at boundaries with a schema, fail fast with
// a clear, actionable message. No scattered `process.env` reads elsewhere.
import { z } from 'zod';

const EnvSchema = z.object({
  /** Port the HTTP server listens on. */
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  /** Path to the SQLite database file (created if missing). */
  DB_PATH: z.string().min(1).default('schreibzeit.sqlite'),
  /** Login session lifetime in seconds (default 30 days). */
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),
  /** Set the `Secure` flag on session cookies (true in production/HTTPS). */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Family timezone for day boundaries (practice "today"/goal). */
  TZ: z.string().min(1).default('Europe/Berlin'),
});

export type Config = z.infer<typeof EnvSchema>;

/** Raw environment shape accepted by {@link loadConfig}. */
export type RawEnv = Record<string, string | undefined>;

/**
 * Parse and validate the environment into a typed {@link Config}.
 * Throws an `Error` with a human-readable, line-per-issue message when any
 * value is invalid — the caller is expected to log it and exit.
 */
export function loadConfig(env: RawEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}
