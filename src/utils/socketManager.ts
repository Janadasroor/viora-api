import { Server as SocketIOServer } from "socket.io";
import type { Server as HTTPServer } from "http";
import type { Server as HTTPSServer } from "https";

let io: SocketIOServer | null = null;

/**
 * Initialize Socket.IO server instance
 * 
 * @param serverInstance - HTTP or HTTPS server instance
 * @returns Initialized Socket.IO server
 */
export function initSocketIO(
  serverInstance: HTTPServer | HTTPSServer
): SocketIOServer {
  io = new SocketIOServer(serverInstance, {
    cors: { 
      origin: "*" 
    },
  });
  
  return io;
}

/**
 * Get the Socket.IO server instance
 * 
 * @returns Socket.IO server instance
 * @throws Error if Socket.IO has not been initialized
 */
export function getIO(): SocketIOServer {
  if (!io) {
    throw new Error("Socket.io not initialized!");
  }
  
  return io;
}