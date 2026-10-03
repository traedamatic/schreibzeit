import { describe, expect, it } from 'bun:test';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('applies sensible defaults when env is empty', () => {
    const config = loadConfig({});
    expect(config.PORT).toBe(3000);
    expect(config.DB_PATH).toBe('schreibzeit.sqlite');
  });

  it('reads provided values', () => {
    const config = loadConfig({ PORT: '8080', DB_PATH: '/data/app.sqlite' });
    expect(config.PORT).toBe(8080);
    expect(config.DB_PATH).toBe('/data/app.sqlite');
  });

  it('fails fast with a clear, field-named message on invalid input', () => {
    expect(() => loadConfig({ PORT: 'not-a-number' })).toThrow(/PORT/);
  });
});
