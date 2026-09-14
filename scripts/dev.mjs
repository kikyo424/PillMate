import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();

function runStep(label, command, args, options = {}) {
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: false,
    ...options
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function startProcess(label, command, args, options = {}) {
  console.log(`\n> ${label}`);
  const child = spawn(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: false,
    ...options
  });

  child.on("exit", (code) => {
    if (!shuttingDown && code !== 0) {
      console.error(`${label} exited with code ${code}`);
      shutdown(code ?? 1);
    }
  });

  children.add(child);
  return child;
}

let shuttingDown = false;
const children = new Set();

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }

  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const tsc = path.join(rootDir, "node_modules", "typescript", "bin", "tsc");
const vite = path.join(rootDir, "node_modules", "vite", "bin", "vite.js");

runStep("서버 TypeScript 컴파일", process.execPath, [tsc, "-p", "apps/server/tsconfig.json"]);
runStep("SQLite 테이블 생성/갱신", process.execPath, ["apps/server/dist/db/migrate.js"]);

startProcess("서버 TypeScript watch", process.execPath, [
  tsc,
  "-w",
  "-p",
  "apps/server/tsconfig.json",
  "--preserveWatchOutput"
]);
startProcess("API 서버", process.execPath, ["--watch", "apps/server/dist/index.js"]);
startProcess("웹앱", process.execPath, [vite, "--host", "0.0.0.0"], {
  cwd: path.join(rootDir, "apps", "web")
});

console.log("\nPillMate 개발 서버가 실행 중입니다.");
console.log("- 웹앱: http://localhost:5173");
console.log("- API 서버: http://localhost:4000");
