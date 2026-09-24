/**
 * Real-time event catalogue.
 *
 * Every event that flows over Socket.io is defined here. Business
 * services import these types and the EventBus, never Socket.io itself.
 *
 * Adding a new event:
 *   1. Add the payload interface below.
 *   2. Add an entry to EventPayloadMap.
 *   3. Add the event name to the EventName union (derived from the map).
 *   4. Wire the emitter into the relevant service.
 *
 * Removing or renaming an event is a breaking change — check all
 * consumers first, then follow the project's Change Control Process.
 */

// ============================================
// PAYLOAD TYPES
// ============================================

export interface RideRequestedPayload {
  rideRequestId: string;
  pickup: { lat: number; lng: number; address: string };
  dropoff: { lat: number; lng: number; address: string };
  distanceKm: number;
  estimatedDurationMin: number;
  biddingEndsAt: string; // ISO timestamp
}

export interface BidReceivedPayload {
  bidId: string;
  rideRequestId: string;
  driverId: string;
  driverDisplayName: string;
  driverRating: number | null;
  vehicleType: string;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleRegistration: string | null;
  bidAmount: number;
  etaMinutes: number;
  expiresAt: string; // ISO timestamp
}

export interface BidSelectedPayload {
  rideId: string;
  rideRequestId: string;
  bidId: string;
  passengerId: string;
  driverId: string;
  agreedFare: number;
}

export interface DriverEnRoutePayload {
  rideId: string;
  driverId: string;
  etaMinutes: number;
}

export interface DriverArrivedPayload {
  rideId: string;
  driverId: string;
  arrivedAt: string; // ISO timestamp
}

export interface RideStartedPayload {
  rideId: string;
  startedAt: string; // ISO timestamp
}

export interface RideCompletedPayload {
  rideId: string;
  completedAt: string; // ISO timestamp
  finalFare: number;
  distanceKm: number | null;
}

export interface RideCancelledPayload {
  rideId: string;
  cancelledBy: 'passenger' | 'driver' | 'system';
  reason: string | null;
  cancelledAt: string; // ISO timestamp
}

export interface DriverLocationPayload {
  rideId: string;
  driverId: string;
  lat: number;
  lng: number;
  heading: number | null;
  speedKmh: number | null;
  recordedAt: string; // ISO timestamp
}

export interface PaymentSucceededPayload {
  paymentId: string;
  rideId: string | null;
  amount: number;
  currency: string;
  paidAt: string; // ISO timestamp
}

export interface PaymentFailedPayload {
  paymentId: string;
  rideId: string | null;
  reason: string;
  failedAt: string; // ISO timestamp
}

export interface NotificationPayload {
  title: string;
  body: string;
  category?: string;
  meta?: Record<string, unknown>;
}

// ============================================
// EVENT MAP
// ============================================
// The single source of truth. Adding an entry here adds the event name
// to the EventName union below and gives EventBus type-safe payloads.

export interface EventPayloadMap {
  'ride:requested': RideRequestedPayload;
  'ride:bid_received': BidReceivedPayload;
  'ride:bid_selected': BidSelectedPayload;
  'ride:driver_en_route': DriverEnRoutePayload;
  'ride:driver_arrived': DriverArrivedPayload;
  'ride:started': RideStartedPayload;
  'ride:completed': RideCompletedPayload;
  'ride:cancelled': RideCancelledPayload;
  'driver:location': DriverLocationPayload;
  'payment:succeeded': PaymentSucceededPayload;
  'payment:failed': PaymentFailedPayload;
  notification: NotificationPayload;
}

/**
 * Union of all valid event names.
 * Derived from the map — do not edit directly.
 */
export type EventName = keyof EventPayloadMap;

/**
 * Extract the payload type for a given event name.
 * Usage: EventPayload<'ride:bid_received'> → BidReceivedPayload
 */
export type EventPayload<E extends EventName> = EventPayloadMap[E];