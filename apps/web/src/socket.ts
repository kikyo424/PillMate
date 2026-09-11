import { io } from "socket.io-client";
import { apiBaseUrl } from "./api";

export function createPillMateSocket(userId: number, groupId: number) {
  const socket = io(apiBaseUrl, {
    transports: ["websocket", "polling"]
  });

  socket.on("connect", () => {
    socket.emit("user:join", userId);
    socket.emit("group:join", groupId);
  });

  return socket;
}
