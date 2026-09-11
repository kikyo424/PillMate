import cors from "cors";
import express from "express";
import http from "node:http";
import { Server } from "socket.io";
import { config } from "./config.js";
import { db, getDatabasePath } from "./db/connection.js";
import { schemaSql } from "./db/schema.js";
import { errorHandler } from "./http/errors.js";
import { createApiRouter } from "./routes/api.js";

db.exec(schemaSql);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: config.corsOrigin,
    credentials: true
  }
});

app.use(cors({ origin: config.corsOrigin, credentials: true }));
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
  socket.on("group:join", (groupId: number | string) => {
    socket.join(`group:${groupId}`);
  });
});

server.listen(config.port, () => {
  console.log(`PillMate server listening on http://localhost:${config.port}`);
});
