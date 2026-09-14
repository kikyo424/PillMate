import { getDatabasePath } from "./connection.js";
import { applyMigrations } from "./migrations.js";

await applyMigrations();

console.log(`PillMate SQLite schema is ready: ${getDatabasePath()}`);
