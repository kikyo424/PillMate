import { db } from "./connection.js";
import { schemaSql } from "./schema.js";
import { getMigrations } from "better-auth/db/migration";
import { auth } from "../auth.js";

export async function applyMigrations() {
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

  const groupMemberColumns = db
    .prepare("PRAGMA table_info(group_members)")
    .all() as Array<{ name: string }>;
  const groupMemberColumnNames = new Set(groupMemberColumns.map((column) => column.name));

  if (!groupMemberColumnNames.has("nickname")) {
    db.exec("ALTER TABLE group_members ADD COLUMN nickname TEXT NULL;");
  }

  const scheduleColumns = db
    .prepare("PRAGMA table_info(schedules)")
    .all() as Array<{ name: string }>;
  const scheduleColumnNames = new Set(scheduleColumns.map((column) => column.name));

  if (!scheduleColumnNames.has("escalation_minutes")) {
    db.exec("ALTER TABLE schedules ADD COLUMN escalation_minutes INTEGER DEFAULT 30;");
  }

  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
}
