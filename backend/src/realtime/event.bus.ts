import { Server as SocketIOServer } from 'socket.io';
import logger from '../utils/logger';
import { EventName, EventPayload } from './events';
import { Rooms } from './connection.manager';

/**
 * EventBus — the only interface between business services and Socket.io.
 *
 * Business services must never import Socket.io directly. They call
 * EventBus.emitToUser / emitToRide / emitToDriversNear / emitToAdmins.
 * This keeps business logic decoupled from transport and testable in
 * isolation.
 *
 * The bus wraps a Socket.io instance and translates room-addressed
 * emits into io.to(room).emit(event, payload) calls. If the Socket.io
 * server is not yet initialised, emits are silently dropped (with a
 * debug log) — this makes services safe to call before the socket
 * server has finished booting.
 */

let io: SocketIOServer | null = null;

/**
 * Called once at server boot, immediately after initializeSocketServer().
 * The bus does not own the socket server — it only borrows a reference.
 */
export function attachEventBus(socketServer: SocketIOServer): void {
  io = socketServer;
  logger.info('EventBus attached to Socket.io server');
}

/**
 * Detach the bus. Called during graceful shutdown to prevent further
 * emits after the socket server is closing.
 */
export function detachEventBus(): void {
  io = null;
}

/**
 * Internal helper. Every public emit method funnels through here.
 */
function safeEmit<E extends EventName>(
  room: string,
  event: E,
  payload: EventPayload<E>
): void {
  if (!io) {
    logger.debug(
      `EventBus dropped (socket server not initialised): ${event} → ${room}`
    );
    return;
  }

  try {
    io.to(room).emit(event, payload);
    logger.debug(`EventBus emitted ${event} → ${room}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`EventBus emit failed: ${event} → ${room}: ${msg}`);
  }
}

export const EventBus = {
  // ==========================================
  // TARGETED EMITS
  // ==========================================

  /**
   * Emit to a single user. Delivered to every socket that user has open
   * (phone, tablet, web session) simultaneously.
   *
   * Example: notify a passenger that a new bid arrived.
   */
  emitToUser<E extends EventName>(
    userId: string,
    event: E,
    payload: EventPayload<E>
  ): void {
    safeEmit(Rooms.user(userId), event, payload);
  },

  /**
   * Emit to everyone currently watching a specific ride — the passenger,
   * the assigned driver, and any admin monitoring it.
   *
   * Example: driver status changes (en_route, arrived, started, completed).
   */
  emitToRide<E extends EventName>(
    rideId: string,
    event: E,
    payload: EventPayload<E>
  ): void {
    safeEmit(Rooms.ride(rideId), event, payload);
  },

  /**
   * Emit to every online driver in a geohash cell.
   *
   * Example: broadcasting a new ride request.
   *
   * Note: geohash cells are ~1.2km × 0.6km. A ride request that should
   * reach a 5km radius must be emitted to every neighbouring cell — the
   * caller is responsible for computing the cell list (W5).
   */
  emitToDriversNear<E extends EventName>(
    geohash: string,
    event: E,
    payload: EventPayload<E>
  ): void {
    safeEmit(Rooms.driversNear(geohash), event, payload);
  },

  /**
   * Emit to the admin monitoring room.
   *
   * Example: live ride activity feed on the admin dashboard.
   */
  emitToAdmins<E extends EventName>(
    event: E,
    payload: EventPayload<E>
  ): void {
    safeEmit(Rooms.adminMonitoring(), event, payload);
  },

  // ==========================================
  // DIAGNOSTICS
  // ==========================================

  /**
   * Returns true if the bus has a live socket server reference.
   * Used by health checks.
   */
  isReady(): boolean {
    return io !== null;
  },

  /**
   * Returns the number of sockets currently connected.
   * Returns 0 if the bus is not ready.
   */
  connectedSocketCount(): number {
    return io ? io.engine.clientsCount : 0;
  },
} as const;

export default EventBus;