import { betterAuth } from "better-auth";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";
import { getDatabasePath } from "./db/connection.js";

export const auth = betterAuth({
  database: new DatabaseSync(getDatabasePath()),
  baseURL: config.betterAuthUrl,
  secret: config.betterAuthSecret,
  trustedOrigins: [
    config.corsOrigin,
    config.betterAuthUrl,
    "http://localhost:*",
    "http://*.localhost:*",
    "http://m.localhost:*",
    "http://127.0.0.1:*",
    "http://192.168.*.*:*",
    "http://10.*.*.*:*",
    "http://172.*.*.*:*"
  ],
  emailAndPassword: {
    enabled: true
  },
  advanced: {
    database: {
      validateSchema: false
    }
  }
});
