import { getIO } from './socket.server';
import { ConnectionManager } from './connection.manager';
import { encode, neighbours } from '../utils/geohash';
import logger from '../utils/logger';

/**
 * Driver location room management.
 *
 * When a driver goes online, we add all of their connected sockets to
 * the driver-near room matching their geohash. When they go offline,
 * we remove them from every driver-near room.
 *
 * Called from DriverService.setAvailability().
 */

/**
 * Add every connected socket of the given user to the driver-near room
 * for the given coordinates.
 *
 * Idempotent — calling twice with the same coordinates is a no-op.
 */
export function joinDriverNearRooms(
  driverUserId: string,
  lat: number,
  lng: number
): void {
  let io;
  try {
    io = getIO();
  } catch {
    logger.debug('joinDriverNearRooms: socket server not initialised yet');
    return;
  }

  const geohash = encode(lat, lng);
  const cm = new ConnectionManager(io);

  // Find every socket currently authenticated as this driver user.
  const userRoom = `user:${driverUserId}`;
  const socketIds = io.sockets.adapter.rooms.get(userRoom);

  if (!socketIds || socketIds.size === 0) {
    logger.debug(
      `joinDriverNearRooms: no active sockets for driver ${driverUserId}`
    );
    return;
  }

  for (const socketId of socketIds) {
    cm.joinDriversNear(socketId, geohash);
  }

  logger.info(
    `Driver ${driverUserId} joined drivers:near:${geohash} (${socketIds.size} socket(s))`
  );
}

/**
 * Remove every connected socket of the given user from all driver-near
 * rooms.
 *
 * Idempotent — calling twice is a no-op.
 */
export function leaveAllDriverNearRooms(driverUserId: string): void {
  let io;
  try {
    io = getIO();
  } catch {
    logger.debug('leaveAllDriverNearRooms: socket server not initialised yet');
    return;
  }

  const cm = new ConnectionManager(io);
  const userRoom = `user:${driverUserId}`;
  const socketIds = io.sockets.adapter.rooms.get(userRoom);

  if (!socketIds || socketIds.size === 0) {
    logger.debug(
      `leaveAllDriverNearRooms: no active sockets for driver ${driverUserId}`
    );
    return;
  }

  for (const socketId of socketIds) {
    cm.leaveAllDriversNear(socketId);
  }

  logger.info(
    `Driver ${driverUserId} left all drivers:near rooms (${socketIds.size} socket(s))`
  );
}

/**
 * Recompute the driver's geohash rooms after a location change while
 * online. Removes the socket from all driver-near rooms, then adds it
 * to the new geohash.
 *
 * Only used when the driver is online and changes geohash cells. Not
 * called on every location update (that would be wasteful).
 */
export function refreshDriverNearRooms(
  driverUserId: string,
  lat: number,
  lng: number
): void {
  leaveAllDriverNearRooms(driverUserId);
  joinDriverNearRooms(driverUserId, lat, lng);
}

/**
 * Return the list of geohashes a ride request should be broadcast to.
 * Wraps the geohash utility so callers do not have to import it directly.
 */
export function broadcastGeohashes(lat: number, lng: number): string[] {
  return neighbours(lat, lng);
}