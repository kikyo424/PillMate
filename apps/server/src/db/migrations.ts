import { db } from "./connection.js";
import { schemaSql } from "./schema.js";

export function applyMigrations() {
  db.exec(schemaSql);

  const intakeLogColumns = db
    .prepare("PRAGMA table_info(intake_logs)")
    .all() as Array<{ name: string }>;
  const intakeLogColumnNames = new Set(intakeLogColumns.map((column) => column.name));

  if (!intakeLogColumnNames.has("notification_sent_at")) {
    db.exec("ALTER TABLE intake_logs ADD COLUMN notification_sent_at TEXT NULL;");
  }

  if (!intakeLogColumnNames.has("escalated_at")) {
    db.exec("ALTER TABLE intake_logs ADD COLUMN escalated_at TEXT NULL;");
  }
}
