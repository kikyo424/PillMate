import { getDatabasePath } from "./connection.js";
import { applyMigrations } from "./migrations.js";

applyMigrations();

console.log(`PillMate SQLite schema is ready: ${getDatabasePath()}`);
