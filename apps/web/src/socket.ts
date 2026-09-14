import { io } from "socket.io-client";
import { apiBaseUrl } from "./api";

export function createPillMateSocket(userId: number, groupIds: number[]) {
  const socket = io(apiBaseUrl, {
    transports: ["websocket", "polling"]
  });

  socket.on("connect", () => {
    socket.emit("user:join", userId);
    for (const groupId of groupIds) {
      socket.emit("group:join", groupId);
    }
  });

  return socket;
}
