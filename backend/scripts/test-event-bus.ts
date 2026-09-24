import { io as ioClient } from 'socket.io-client';
import axios from 'axios';
import { env } from '../src/config/env';

const BASE_URL = `http://localhost:${env.port}`;

// ============================================
// CONFIGURATION
// ============================================
// This script needs a way to trigger an EventBus emit from outside
// the socket connection itself. We use a temporary dev-only HTTP
// endpoint that fires a 'notification' event to the authenticated user.
//
// If that endpoint does not exist yet, this test will fail with 404.
// In that case, see Instruction #2 — we add the endpoint.

const TEST_PHONE = '+2348000000001';
const TEST_PASSWORD = 'TestPass123!';

async function login(): Promise<{ token: string; userId: string }> {
  const res = await axios.post(`${BASE_URL}/api/v1/auth/login`, {
    phone_number: TEST_PHONE,
    password: TEST_PASSWORD,
  });

  return {
    token: res.data.data.tokens.accessToken,
    userId: res.data.data.user.id,
  };
}

async function run() {
  console.log('🔐 Logging in test user…');
  const { token, userId } = await login();
  console.log(`✅ Logged in as ${userId}`);

  // ============================================
  // STEP 1 — Connect the socket
  // ============================================
  console.log('\n▶️  Connecting socket…');

  const socket = ioClient(BASE_URL, {
    path: '/realtime',
    transports: ['websocket'],
    auth: { token: `Bearer ${token}` },
    reconnection: false,
  });

  // ============================================
  // STEP 2 — Listen for the 'notification' event
  // ============================================
  // The dev endpoint will emit a 'notification' event to this user's
  // room. If EventBus is working, the socket receives it.

  const received = new Promise<void>((resolve, reject) => {
    socket.on('notification', (payload) => {
      console.log('✅ Received notification via EventBus:', payload);
      resolve();
    });

    setTimeout(() => {
      reject(new Error('Timed out waiting for notification event'));
    }, 10000);
  });

  socket.on('connect', async () => {
    console.log(`✅ Socket connected: ${socket.id}`);

    // ============================================
    // STEP 3 — Trigger the emit via HTTP
    // ============================================
    // Ask the server to emit an event to this user via the EventBus.
    // The server-side handler calls EventBus.emitToUser(...).

    console.log('\n▶️  Triggering EventBus emit via HTTP…');

    try {
      await axios.post(
        `${BASE_URL}/api/v1/realtime/dev-emit`,
        {
          userId,
          event: 'notification',
          payload: {
            title: 'EventBus Test',
            body: 'If you see this, the EventBus works.',
            category: 'dev-test',
          },
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
    } catch (err: any) {
      console.error('❌ Failed to trigger emit:', err.response?.data || err.message);
      process.exit(1);
    }
  });

  socket.on('connect_error', (err) => {
    console.error('❌ Socket connect error:', err.message);
    process.exit(1);
  });

  // ============================================
  // STEP 4 — Await the received event
  // ============================================
  try {
    await received;
    console.log('\n🎉 EventBus verified end-to-end.');
    socket.disconnect();
    process.exit(0);
  } catch (err: any) {
    console.error(`\n❌ ${err.message}`);
    socket.disconnect();
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});