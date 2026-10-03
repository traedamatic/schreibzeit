// Tiny in-memory fixed-window rate limiter for sensitive endpoints (e.g. login).
// Single-node family server — resets on restart, which is acceptable here.
import { now } from '../ids';

interface Window {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly hits = new Map<string, Window>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Record an attempt for `key`; return true if still within the allowance. */
  check(key: string): boolean {
    const ts = now();
    const current = this.hits.get(key);
    if (!current || current.resetAt <= ts) {
      this.hits.set(key, { count: 1, resetAt: ts + this.windowMs });
      return true;
    }
    current.count += 1;
    return current.count <= this.max;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}
