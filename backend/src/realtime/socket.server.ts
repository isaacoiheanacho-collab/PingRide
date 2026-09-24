import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { env } from '../config/env';
import logger from '../utils/logger';
import { socketAuthMiddleware } from './auth.handshake';
import { registerConnectionHandlers } from './connection.manager';
import { attachEventBus, detachEventBus } from './event.bus';

let io: SocketIOServer | null = null;

/**
 * Initialize the Socket.io server.
 *
 * Attached to the same HTTP server as Express so it shares the port.
 * Namespace: /realtime — keeps WebSocket traffic separated from any
 * future REST-over-WebSocket experiments.
 */
export function initializeSocketServer(httpServer: HTTPServer): SocketIOServer {
  if (io) {
    logger.warn('Socket.io server already initialized');
    return io;
  }

  io = new SocketIOServer(httpServer, {
    path: '/realtime',
    cors: {
      origin: (origin, callback) => {
        // Allow mobile apps (no origin) and configured frontend origins.
        if (!origin) return callback(null, true);

        const allowed = [
          env.frontendUrl,
          env.apiUrl,
          env.mobileApiUrl,
        ].filter(Boolean);

        if (allowed.includes(origin)) {
          return callback(null, true);
        }

        logger.warn(`Socket.io CORS rejected origin: ${origin}`);
        return callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
    },
    pingInterval: 25000,
    pingTimeout: 60000,
    transports: ['websocket', 'polling'],
  });

  // ✅ NEW — require authentication before any connection is accepted
  io.use(socketAuthMiddleware);

  // Register room logic and connection lifecycle handlers
  registerConnectionHandlers(io);
  attachEventBus(io);

  logger.info('Socket.io server initialized on namespace /realtime');

  return io;
}

/**
 * Get the initialized Socket.io instance.
 * Throws if called before initialization — this is deliberate, so that
 * any code importing this function at module load time fails loudly
 * rather than silently creating a second server.
 */
export function getIO(): SocketIOServer {
  if (!io) {
    throw new Error('Socket.io server has not been initialized. Call initializeSocketServer() first.');
  }
  return io;
}

/**
 * Check whether the Socket.io server is ready.
 * Used by the health endpoint.
 */
export function isSocketServerReady(): boolean {
  return io !== null;
}

/**
 * Graceful shutdown helper — closes all connections and stops the server.
 * Wired into process shutdown in a later task (X4).
 */
export async function shutdownSocketServer(): Promise<void> {
  detachEventBus();
  if (!io) return;
  logger.info('Shutting down Socket.io server…');
  await new Promise<void>((resolve) => {
    io!.close(() => resolve());
  });
  io = null;
  logger.info('Socket.io server shut down');
}