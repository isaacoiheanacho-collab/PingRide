import { Server as SocketIOServer } from 'socket.io';
import logger from '../utils/logger';
import { SocketUser } from './auth.handshake';

/**
 * Connection Manager — room strategy for PingRide sockets.
 *
 * Rooms are the routing mechanism. Every event target is expressed as
 * a room. This module centralises the room naming conventions and the
 * join/leave logic so no other file needs to know how rooms are named.
 *
 * Room patterns:
 *   user:{userId}              — personal events for one user
 *   ride:{rideId}              — events visible to passenger + driver
 *   drivers:near:{geohash}     — broadcast ride requests to nearby drivers
 *   admin:monitoring           — live feed for admin portal
 */

// ============================================
// ROOM NAME BUILDERS
// ============================================
// Single source of truth for room naming. Never build a room name
// inline in another file — always call one of these.

export const Rooms = {
  user: (userId: string) => `user:${userId}`,

  ride: (rideId: string) => `ride:${rideId}`,

  driversNear: (geohash: string) => `drivers:near:${geohash}`,

  adminMonitoring: () => 'admin:monitoring',
} as const;

// ============================================
// CONNECTION HANDLER
// ============================================

export function registerConnectionHandlers(io: SocketIOServer): void {
  io.on('connection', (socket) => {
    const user = (socket as any).user as SocketUser;
    if (!user) {
      // Should never happen — auth middleware guarantees a user.
      // If we get here, something has gone wrong; log and disconnect.
      logger.error(`Socket connected without user attached: ${socket.id}`);
      socket.disconnect(true);
      return;
    }

    logger.info(
      `Socket connected: ${socket.id} — user ${user.id} (${user.role})`
    );

    // ==========================================
    // AUTO-JOIN user:{userId}
    // ==========================================
    // Every socket belongs to exactly one user room.
    // This lets us emit to a user and all their devices receive it.
    const userRoom = Rooms.user(user.id);
    socket.join(userRoom);
    logger.debug(`Socket ${socket.id} joined room ${userRoom}`);

    // ==========================================
    // AUTO-JOIN admin:monitoring (admins only)
    // ==========================================
    if (user.role === 'admin' || user.role === 'operations') {
      const adminRoom = Rooms.adminMonitoring();
      socket.join(adminRoom);
      logger.debug(`Socket ${socket.id} joined room ${adminRoom}`);
    }

    // ==========================================
    // SEND CONNECTED ACK
    // ==========================================
    socket.emit('connected', {
      socketId: socket.id,
      userId: user.id,
      role: user.role,
      joinedRooms: Array.from(socket.rooms),
      message: 'Socket.io server is up',
      timestamp: new Date().toISOString(),
    });

    // ==========================================
    // DISCONNECT
    // ==========================================
    // Socket.io automatically removes the socket from all rooms on
    // disconnect. We only need to log it. No manual cleanup.
    socket.on('disconnect', (reason) => {
      logger.info(
        `Socket disconnected: ${socket.id} — user ${user.id} — ${reason}`
      );
    });
  });
}

// ============================================
// ROOM MEMBERSHIP HELPERS
// ============================================
// Used by higher-level services (MarketplaceService, RideService) to
// move sockets between rooms as the ride state changes.
//
// These functions take the io instance and emit admin-safe logs but do
// not throw if the target socket is gone — real-world sockets disconnect.

export class ConnectionManager {
  constructor(private io: SocketIOServer) {}

  /**
   * Add a socket to a ride room. Called when a passenger or driver
   * becomes associated with a ride (bid selected, ride assigned, etc.).
   */
  joinRide(socketId: string, rideId: string): void {
    const socket = this.io.sockets.sockets.get(socketId);
    if (!socket) {
      logger.warn(`joinRide: socket ${socketId} not found`);
      return;
    }
    const room = Rooms.ride(rideId);
    socket.join(room);
    logger.debug(`Socket ${socketId} joined room ${room}`);
  }

  /**
   * Add a socket to a driver-near room. Called when a driver goes online.
   */
  joinDriversNear(socketId: string, geohash: string): void {
    const socket = this.io.sockets.sockets.get(socketId);
    if (!socket) {
      logger.warn(`joinDriversNear: socket ${socketId} not found`);
      return;
    }
    const room = Rooms.driversNear(geohash);
    socket.join(room);
    logger.debug(`Socket ${socketId} joined room ${room}`);
  }

  /**
   * Remove a socket from all driver-near rooms. Called when a driver
   * goes offline. We remove from all geohash rooms because the driver
   * may have moved between geohashes while online.
   */
  leaveAllDriversNear(socketId: string): void {
    const socket = this.io.sockets.sockets.get(socketId);
    if (!socket) {
      logger.warn(`leaveAllDriversNear: socket ${socketId} not found`);
      return;
    }
    const rooms = Array.from(socket.rooms);
    for (const room of rooms) {
      if (room.startsWith('drivers:near:')) {
        socket.leave(room);
        logger.debug(`Socket ${socketId} left room ${room}`);
      }
    }
  }

  /**
   * Remove a socket from a specific ride room. Called when the ride
   * reaches a terminal state.
   */
  leaveRide(socketId: string, rideId: string): void {
    const socket = this.io.sockets.sockets.get(socketId);
    if (!socket) {
      logger.warn(`leaveRide: socket ${socketId} not found`);
      return;
    }
    const room = Rooms.ride(rideId);
    socket.leave(room);
    logger.debug(`Socket ${socketId} left room ${room}`);
  }

  /**
   * Get all sockets currently in a room.
   * Used for operational visibility.
   */
  getSocketsInRoom(room: string): string[] {
    const sockets = this.io.sockets.adapter.rooms.get(room);
    return sockets ? Array.from(sockets) : [];
  }

  /**
   * Get all rooms a given user's sockets are currently in.
   * Useful for diagnostics.
   */
  getRoomsForUser(userId: string): string[] {
    const sockets = this.io.sockets.adapter.rooms.get(Rooms.user(userId));
    if (!sockets) return [];

    const rooms = new Set<string>();
    for (const socketId of sockets) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) {
        for (const room of socket.rooms) {
          rooms.add(room);
        }
      }
    }
    return Array.from(rooms);
  }
}