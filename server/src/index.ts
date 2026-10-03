// Entry point: load config (fail fast), open the database, start the server.
import { loadConfig } from './config';
import { openDatabase } from './db';
import { createApp } from './app';

function main(): void {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    // Operational error (bad env) — report clearly and exit non-zero.
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const db = openDatabase(config.DB_PATH);
  createApp(db).listen(config.PORT);
  console.log(`Schreibzeit API listening on http://localhost:${config.PORT}`);
}

main();
