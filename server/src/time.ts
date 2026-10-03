// Timezone-aware day boundaries. Used for the daily practice goal: "today" is
// the local day in the configured family timezone, not UTC.

/** Offset (ms) such that `localWallClockAsUTC - atMs` for the given tz. */
function tzOffsetMs(tz: string, atMs: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(atMs)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUTC - atMs;
}

/** Epoch ms of local midnight (start of "today") in `tz` for the instant `nowMs`. */
export function startOfDayMs(tz: string, nowMs: number): number {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [y, m, d] = dtf.format(nowMs).split('-').map(Number);
  const localMidnightAsUTC = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0);
  return localMidnightAsUTC - tzOffsetMs(tz, nowMs);
}
