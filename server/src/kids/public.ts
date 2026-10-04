// Public (client-facing) shape of a kid — camelCase, no secrets (pin_hash,
// lockout counters stay server-only).
import type { KidRow } from '../types';

export function toPublicKid(k: KidRow) {
  return {
    id: k.id,
    name: k.name,
    lernstand: k.lernstand,
    notiz: k.notiz,
    dailyGoalSeconds: k.daily_goal_seconds,
    uebungsModus: k.uebungs_modus,
    createdAt: k.created_at,
    updatedAt: k.updated_at,
  };
}
