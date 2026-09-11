import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "../../data/pillmate.sqlite",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173"
};
