import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "../../data/pillmate.sqlite",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  escalationMinutes: Number(process.env.ESCALATION_MINUTES ?? 30),
  vapidSubject: process.env.VAPID_SUBJECT ?? "mailto:admin@example.com",
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY
};
