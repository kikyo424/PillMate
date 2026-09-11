import crypto from "node:crypto";

export function createInviteCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}
