import { db, getDatabasePath } from "./connection.js";
import { schemaSql } from "./schema.js";

db.exec(schemaSql);

console.log(`PillMate SQLite schema is ready: ${getDatabasePath()}`);
