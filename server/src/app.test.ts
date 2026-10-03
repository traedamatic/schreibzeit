import { describe, expect, it } from 'bun:test';
import { createApp } from './app';
import { openDatabase } from './db';

describe('GET /api/health', () => {
  it('boots the app and returns ok with a version string', async () => {
    const app = createApp(openDatabase(':memory:'));

    const res = await app.handle(new Request('http://localhost/api/health'));
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string; version: string };
    expect(body.status).toBe('ok');
    expect(typeof body.version).toBe('string');
    expect(body.version.length).toBeGreaterThan(0);
  });
});
