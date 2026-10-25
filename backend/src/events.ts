import type { Server as HttpServer } from "node:http";
import type { Logger } from "pino";
import { Server } from "socket.io";
import type { SocketEvents } from "../../shared/schemas/types.js";

type ServerToClient = { [K in keyof SocketEvents]: (payload: SocketEvents[K]) => void };
interface ClientToServer {
  /** Join "proposal:<slug>", or "proposal:*" for every proposal. */
  subscribe: (msg: { proposalId: string }) => void;
  unsubscribe: (msg: { proposalId: string }) => void;
}

export interface EventBus {
  emit<K extends keyof SocketEvents>(event: K, payload: SocketEvents[K]): void;
}

const room = (proposalId: string): string => `proposal:${proposalId}`;
const idOf = (msg: unknown): string | null => {
  const id = (msg as { proposalId?: unknown } | null)?.proposalId;
  return typeof id === "string" && id.length > 0 && id.length <= 64 ? id : null;
};

/** Socket.IO on the same HTTP server as the API. Events go to the proposal's room and to "proposal:*". */
export function attachSocket(httpServer: HttpServer, corsOrigin: string, logger: Pick<Logger, "debug">) {
  const io = new Server<ClientToServer, ServerToClient>(httpServer, { cors: { origin: corsOrigin } });

  io.on("connection", (socket) => {
    logger.debug({ id: socket.id }, "socket connected");
    socket.on("subscribe", (msg) => {
      const id = idOf(msg);
      if (id) void socket.join(room(id));
    });
    socket.on("unsubscribe", (msg) => {
      const id = idOf(msg);
      if (id) void socket.leave(room(id));
    });
  });

  const bus: EventBus = {
    emit(event, payload) {
      const rooms = [room("*")];
      if (payload.proposalId) rooms.push(room(payload.proposalId));
      // Typed per event above; socket.io's emit signature can't follow the generic K.
      (io.to(rooms).emit as (e: string, p: unknown) => boolean)(event, payload);
    },
  };

  return { io, bus };
}
