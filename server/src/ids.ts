// Shared id/time helpers — server counterparts of the client's `src/core/id.ts`,
// so ids and epoch-ms timestamps match across the HTTP boundary.

/** Opaque unique id (UUID v4). */
export const newId = (): string => crypto.randomUUID();

/** Current time as epoch milliseconds (matches the client's `now()`). */
export const now = (): number => Date.now();
