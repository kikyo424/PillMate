import type { Server } from "socket.io";
import { db } from "../db/connection.js";

export function createSystemFeedMessage(
  io: Server,
  groupId: number,
  content: string,
  photoUrl: string | null = null
) {
  const result = db
    .prepare(
      `INSERT INTO chat_messages (group_id, sender_id, message_type, content, photo_url)
       VALUES (?, NULL, 'SYSTEM_VERIFICATION', ?, ?)`
    )
    .run(groupId, content, photoUrl);

  const message = db
    .prepare(
      `SELECT id, group_id, sender_id, message_type, content, photo_url, created_at
       FROM chat_messages
       WHERE id = ?`
    )
    .get(Number(result.lastInsertRowid));

  io.to(`group:${groupId}`).emit("chat:message", message);

  return message;
}
