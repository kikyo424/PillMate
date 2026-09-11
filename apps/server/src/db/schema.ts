export const schemaSql = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  push_subscription TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  invite_code TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS group_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT CHECK(role IN ('OWNER', 'MANAGER', 'MEMBER')) DEFAULT 'MEMBER',
  can_edit_schedule INTEGER DEFAULT 0,
  joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  target_user_id INTEGER NOT NULL,
  medicine_name TEXT NOT NULL,
  dosage TEXT NOT NULL,
  intake_time TEXT NOT NULL,
  days_of_week TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS intake_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL,
  target_user_id INTEGER NOT NULL,
  scheduled_time TEXT NOT NULL,
  status TEXT CHECK(status IN ('PENDING', 'COMPLETED', 'MISSED', 'SKIPPED')) DEFAULT 'PENDING',
  verification_type TEXT CHECK(verification_type IN ('BUTTON', 'PHOTO')) NULL,
  photo_url TEXT NULL,
  notification_sent_at TEXT NULL,
  escalated_at TEXT NULL,
  completed_at TEXT NULL,
  FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (schedule_id, scheduled_time)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  sender_id INTEGER NULL,
  message_type TEXT CHECK(message_type IN ('TEXT', 'PHOTO', 'SYSTEM_VERIFICATION')) DEFAULT 'TEXT',
  content TEXT NOT NULL,
  photo_url TEXT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_schedules_group_id ON schedules(group_id);
CREATE INDEX IF NOT EXISTS idx_schedules_target_user_id ON schedules(target_user_id);
CREATE INDEX IF NOT EXISTS idx_intake_logs_schedule_id ON intake_logs(schedule_id);
CREATE INDEX IF NOT EXISTS idx_intake_logs_target_user_id ON intake_logs(target_user_id);
CREATE INDEX IF NOT EXISTS idx_intake_logs_status_scheduled_time ON intake_logs(status, scheduled_time);
CREATE INDEX IF NOT EXISTS idx_chat_messages_group_created ON chat_messages(group_id, created_at);
`;
