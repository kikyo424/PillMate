import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, "apps", "server", ".env");

function readDatabaseUrl() {
  const configured = process.env.DATABASE_URL;

  if (configured) {
    return configured;
  }

  if (!fs.existsSync(envPath)) {
    return "../../data/pillmate.sqlite";
  }

  const env = fs.readFileSync(envPath, "utf8");
  const match = env.match(/^DATABASE_URL=(.+)$/m);

  return match?.[1]?.trim().replace(/^["']|["']$/g, "") || "../../data/pillmate.sqlite";
}

const serverRoot = path.join(root, "apps", "server");
const databasePath = path.resolve(serverRoot, readDatabaseUrl());
const databaseFiles = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];

for (const filePath of databaseFiles) {
  if (!fs.existsSync(filePath)) {
    continue;
  }

  try {
    fs.unlinkSync(filePath);
    console.log(`Deleted ${filePath}`);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EBUSY") {
      console.error("SQLite DB is currently in use. Stop the API/dev server and run pnpm db:reset again.");
      process.exit(1);
    }

    throw error;
  }
}

console.log(`PillMate SQLite database was reset: ${databasePath}`);
