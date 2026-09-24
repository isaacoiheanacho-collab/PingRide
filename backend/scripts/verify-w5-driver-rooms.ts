/**
 * W5 Step 3 verification.
 *
 * Proves four things end-to-end:
 *   1. Driver online WITH location   → socket receives a broadcast aimed
 *                                     at the geohash room.
 *   2. Driver offline                → socket stops receiving those broadcasts.
 *   3. Driver online WITHOUT location → 422 "Location is required to go online"
 *   4. Full bidding loop             → driver receives ride:requested & passenger receives ride:bid_received
 *
 * Run with:  npx ts-node --transpile-only scripts/verify-w5-driver-rooms.ts
 */

import { io as ioClient, Socket } from 'socket.io-client';
import axios from 'axios';
import { encode } from '../src/utils/geohash';

// ============================================
// CONFIG
// ============================================
const BASE_URL = 'http://localhost:4000';
const DRIVER_PHONE = '+2347012345698';
const DRIVER_PASSWORD = 'Test02!A';
const DRIVER_LAT = 6.5244;
const DRIVER_LNG = 3.3792;

const PASSENGER_PHONE = '+2349012345678';
const PASSENGER_PASSWORD = 'Test01!A';

const EXPECTED_GEOHASH = encode(DRIVER_LAT, DRIVER_LNG);
const EXPECTED_ROOM = `drivers:near:${EXPECTED_GEOHASH}`;

// ============================================
// HELPERS
// ============================================

const log = {
  info: (msg: string) => console.log(`ℹ️  ${msg}`),
  pass: (msg: string) => console.log(`✅ ${msg}`),
  fail: (msg: string) => console.log(`❌ ${msg}`),
  step: (msg: string) => console.log(`\n▶️  ${msg}`),
};

function assert(condition: boolean, passMsg: string, failMsg: string): void {
  if (condition) log.pass(passMsg);
  else {
    log.fail(failMsg);
    process.exitCode = 1;
  }
}

function waitForEvent<T = any>(
  socket: Socket,
  event: string,
  timeoutMs = 5000
): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve(null);
    }, timeoutMs);
    const handler = (payload: T) => {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

// ============================================
// MAIN
// ============================================

async function main() {
  // ---- STEP 0: login + connect ----
  log.step('Logging in as test driver…');
  const login = await axios.post(`${BASE_URL}/api/v1/auth/login`, {
    phone_number: DRIVER_PHONE,
    password: DRIVER_PASSWORD,
  });
  const token: string = login.data.data.tokens.accessToken;
  const userId: string = login.data.data.user.id;
  log.pass(`Logged in as ${userId}`);

  log.step('Connecting socket…');
  const socket: Socket = ioClient(BASE_URL, {
    path: '/realtime',
    auth: { token },
    transports: ['websocket'],
  });

  await new Promise<void>((resolve, reject) => {
    socket.on('connected', () => resolve());
    socket.on('connect_error', (err) =>
      reject(new Error(`Socket connect_error: ${err.message}`))
    );
    setTimeout(() => reject(new Error('Socket connect timeout')), 8000);
  });
  log.pass(`Socket connected: ${socket.id}`);

  const authHeader = { headers: { Authorization: `Bearer ${token}` } };

  // ============================================
  // TEST 1 — go online WITH location
  // ============================================
  log.step('TEST 1 — Go online with location');
  log.info(`Expected geohash: ${EXPECTED_GEOHASH}`);
  log.info(`Expected room:    ${EXPECTED_ROOM}`);

  await axios.post(
    `${BASE_URL}/api/v1/driver/online`,
    { latitude: DRIVER_LAT, longitude: DRIVER_LNG },
    authHeader
  );
  log.pass('POST /driver/online returned success');

  // Give the room-join a beat.
  await new Promise((r) => setTimeout(r, 500));

  // IMPORTANT: set up the receive-promise NOW — right before the broadcast —
  // not before the go-online call, which can take several seconds.
  const receiveOnline = waitForEvent(socket, 'notification', 5000);

  await axios.post(
    `${BASE_URL}/api/v1/realtime/dev-emit-to-room`,
    {
      room: EXPECTED_ROOM,
      event: 'notification',
      payload: {
        title: 'Room Membership Test',
        body: 'If you receive this, your socket is in the geohash room.',
      },
    },
    authHeader
  );

  const receivedOnline = await receiveOnline;
  assert(
    receivedOnline !== null,
    `Socket received broadcast on ${EXPECTED_ROOM} — room membership confirmed`,
    `Socket did NOT receive broadcast on ${EXPECTED_ROOM} within 5s`
  );

  // ============================================
  // TEST 2 — go offline
  // ============================================
  log.step('TEST 2 — Go offline');
  await axios.post(`${BASE_URL}/api/v1/driver/offline`, {}, authHeader);
  log.pass('POST /driver/offline returned success');

  await new Promise((r) => setTimeout(r, 500));

  // Same pattern: attach the listener right before the broadcast.
  const receiveOffline = waitForEvent(socket, 'notification', 3000);

  await axios.post(
    `${BASE_URL}/api/v1/realtime/dev-emit-to-room`,
    {
      room: EXPECTED_ROOM,
      event: 'notification',
      payload: {
        title: 'Should NOT arrive',
        body: 'If you see this, the socket is still in the geohash room.',
      },
    },
    authHeader
  );

  const receivedOffline = await receiveOffline;
  assert(
    receivedOffline === null,
    'Socket did NOT receive broadcast after going offline — room membership removed',
    'Socket STILL received broadcast after going offline — room membership not removed'
  );

  // ============================================
  // TEST 3 — go online WITHOUT location
  // ============================================
  log.step('TEST 3 — Go online without location');
  try {
    await axios.post(`${BASE_URL}/api/v1/driver/online`, {}, authHeader);
    log.fail('Expected 422 but got success');
    process.exitCode = 1;
  } catch (err: any) {
    const status = err.response?.status;
    const message = err.response?.data?.error?.message;
    assert(
      status === 422 && message === 'Location is required to go online',
      `Got expected 422: "${message}"`,
      `Got unexpected ${status}: "${message}"`
    );
  }

  // ============================================
  // TEST 4 — Full bidding loop:
  //   passenger requests ride → driver receives ride:requested
  //   driver submits bid     → passenger receives ride:bid_received
  // ============================================
  log.step('TEST 4 — Full bidding loop (W5 + W6)');

  // -- Ensure the driver is online (TEST 3 left them offline) --
  await axios.post(
    `${BASE_URL}/api/v1/driver/online`,
    { latitude: DRIVER_LAT, longitude: DRIVER_LNG },
    authHeader
  );
  await new Promise((r) => setTimeout(r, 500));

  // -- Login passenger and connect their socket --
  const passengerLogin = await axios.post(`${BASE_URL}/api/v1/auth/login`, {
    phone_number: PASSENGER_PHONE,
    password: PASSENGER_PASSWORD,
  });
  const passengerToken: string = passengerLogin.data.data.tokens.accessToken;
  const passengerUserId: string = passengerLogin.data.data.user.id;
  log.pass(`Logged in passenger as ${passengerUserId}`);

  const passengerSocket: Socket = ioClient(BASE_URL, {
    path: '/realtime',
    auth: { token: passengerToken },
    transports: ['websocket'],
  });

  await new Promise<void>((resolve, reject) => {
    passengerSocket.on('connected', () => resolve());
    passengerSocket.on('connect_error', (err) =>
      reject(new Error(`Passenger socket error: ${err.message}`))
    );
    setTimeout(
      () => reject(new Error('Passenger socket connect timeout')),
      8000
    );
  });
  log.pass(`Passenger socket connected: ${passengerSocket.id}`);

  const passengerAuthHeader = {
    headers: { Authorization: `Bearer ${passengerToken}` },
  };

  // ------------------------------------------------------------
  // 4a. Driver listener BEFORE passenger requests the ride.
  // ------------------------------------------------------------
  const receiveRideRequested = waitForEvent(socket, 'ride:requested', 5000);

  const requestRes = await axios.post(
    `${BASE_URL}/api/v1/marketplace/request`,
    {
      pickup_latitude: DRIVER_LAT,
      pickup_longitude: DRIVER_LNG,
      pickup_address: 'Test Pickup',
      destination_latitude: 6.6018,
      destination_longitude: 3.3515,
      destination_address: 'Test Destination',
      vehicle_type: 'standard',
    },
    passengerAuthHeader
  );

  const rideRequestId = requestRes.data.data.rideRequest.id;
  log.info(`Ride request created: ${rideRequestId}`);

  const rideRequested = await receiveRideRequested;
  assert(
    rideRequested !== null && rideRequested.rideRequestId === rideRequestId,
    `Driver received ride:requested — rideRequestId=${rideRequested?.rideRequestId}`,
    `Driver did NOT receive ride:requested within 5s (expected rideRequestId=${rideRequestId})`
  );

  // ------------------------------------------------------------
  // 4b. Passenger listener BEFORE driver submits a bid.
  // ------------------------------------------------------------
  const receiveBidReceived = waitForEvent(
    passengerSocket,
    'ride:bid_received',
    5000
  );

  await axios.post(
    `${BASE_URL}/api/v1/marketplace/bids`,
    {
      ride_request_id: rideRequestId,
      bid_amount: 2500,
      eta_minutes: 8,
      driver_notes: 'Full-loop test bid',
    },
    authHeader
  );
  log.pass('Driver POST /marketplace/bids succeeded');

  const bidReceived = await receiveBidReceived;
  assert(
    bidReceived !== null && bidReceived.bidId,
    `Passenger received ride:bid_received — bidId=${bidReceived?.bidId}`,
    'Passenger did NOT receive ride:bid_received within 5s'
  );

  // ------------------------------------------------------------
  // 4c. Optional: assert the payload shape matches the interface.
  // ------------------------------------------------------------
  if (bidReceived) {
    const shapeOk =
      typeof bidReceived.bidId === 'string' &&
      typeof bidReceived.rideRequestId === 'string' &&
      typeof bidReceived.driverDisplayName === 'string' &&
      typeof bidReceived.bidAmount === 'number' &&
      typeof bidReceived.etaMinutes === 'number' &&
      typeof bidReceived.expiresAt === 'string';

    assert(
      shapeOk,
      'ride:bid_received payload has the expected shape',
      `ride:bid_received payload is missing fields: ${JSON.stringify(bidReceived)}`
    );
  }

  passengerSocket.disconnect();
  socket.disconnect();

  log.step('Done.');
  process.exit(process.exitCode ?? 0);
}

main().catch((err) => {
  log.fail(`Fatal: ${err.message}`);
  console.error(err);
  process.exit(1);
});