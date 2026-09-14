import crypto from "node:crypto";

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");

  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, passwordHash: string) {
  const [algorithm, salt, storedHash] = passwordHash.split(":");

  if (algorithm !== "scrypt" || !salt || !storedHash) {
    return false;
  }

  const candidateHash = crypto.scryptSync(password, salt, 64);
  const storedHashBuffer = Buffer.from(storedHash, "hex");

  if (candidateHash.length !== storedHashBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(candidateHash, storedHashBuffer);
}
