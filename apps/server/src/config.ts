import dotenv from "dotenv";
import path from "node:path";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), "apps/server/.env") });

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "../../data/pillmate.sqlite",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  betterAuthUrl: process.env.BETTER_AUTH_URL ?? `http://localhost:${Number(process.env.PORT ?? 4000)}`,
  betterAuthSecret:
    process.env.BETTER_AUTH_SECRET ?? "pillmate-dev-secret-change-before-production-32",
  escalationMinutes: Number(process.env.ESCALATION_MINUTES ?? 30),
  vapidSubject: process.env.VAPID_SUBJECT ?? "mailto:admin@example.com",
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY
};
