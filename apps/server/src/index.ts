import cors from "cors";
import express from "express";
import http from "node:http";
import { toNodeHandler } from "better-auth/node";
import { Server } from "socket.io";
import { auth } from "./auth.js";
import { config } from "./config.js";
import { getDatabasePath } from "./db/connection.js";
import { applyMigrations } from "./db/migrations.js";
import { errorHandler } from "./http/errors.js";
import { createApiRouter } from "./routes/api.js";
import { startMedicationScheduler } from "./services/scheduler.js";
import { resolveCorsOrigin } from "./utils/origins.js";

await applyMigrations();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: resolveCorsOrigin,
    credentials: true
  }
});

app.use(cors({ origin: resolveCorsOrigin, credentials: true }));
app.all("/api/auth/*", toNodeHandler(auth));
app.use(express.json());
app.use("/uploads", express.static("uploads"));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "pillmate-server",
    database: getDatabasePath()
  });
});

app.use("/api", createApiRouter(io));

app.use(errorHandler);

io.on("connection", (socket) => {
  socket.on("user:join", (userId: number | string) => {
    socket.join(`user:${userId}`);
  });

  socket.on("group:join", (groupId: number | string) => {
    socket.join(`group:${groupId}`);
  });
});

startMedicationScheduler(io);

server.listen(config.port, () => {
  console.log(`PillMate server listening on http://localhost:${config.port}`);
});
