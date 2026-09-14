import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const rootDir = process.cwd();
const dbPath = path.join(rootDir, "data", "pillmate.sqlite");
const outputPath = path.join(rootDir, "data", "dev-users.json");

if (!fs.existsSync(dbPath)) {
  console.error("SQLite DB가 없습니다. 먼저 pnpm db:init 또는 pnpm dev를 실행해주세요.");
  process.exit(1);
}

const db = new DatabaseSync(dbPath, { readOnly: true });

const users = db
  .prepare(
    `SELECT id, name, email, password_hash, created_at
     FROM users
     ORDER BY id ASC`
  )
  .all();

const payload = {
  note: "비밀번호 원문은 저장하지 않습니다. password_hash는 로그인 검증용 해시입니다.",
  exported_at: new Date().toISOString(),
  users
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(`사용자 목록을 저장했습니다: ${outputPath}`);
