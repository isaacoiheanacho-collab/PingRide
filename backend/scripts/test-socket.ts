import { io as ioClient } from 'socket.io-client';
import axios from 'axios';
import { env } from '../src/config/env';

const BASE_URL = `http://localhost:${env.port}`;

// ============================================
// TEST USER CREDENTIALS
// ============================================
// These are seeded below on first run. Safe for local dev only.
const TEST_PHONE = '+2348000000001';
const TEST_PASSWORD = 'TestPass123!';

async function ensureTestUser(): Promise<string> {
  // Try to log in first
  try {
    const loginRes = await axios.post(`${BASE_URL}/api/v1/auth/login`, {
      phone_number: TEST_PHONE,
      password: TEST_PASSWORD,
    });
    console.log('✅ Logged in existing test user');
    return loginRes.data.data.tokens.accessToken;
  } catch (err: any) {
    if (err.response?.status !== 401 && err.response?.status !== 404) {
      throw err;
    }
  }

  // Register new test user
  try {
    await axios.post(`${BASE_URL}/api/v1/auth/register`, {
      first_name: 'Socket',
      last_name: 'Tester',
      phone_number: TEST_PHONE,
      password: TEST_PASSWORD,
      user_type: 'passenger',
    });
    console.log('✅ Registered test user (OTP required)');

    throw new Error(
      'Test user registered but not yet verified.\n' +
      '  1. Check server logs for the OTP line: "📱 OTP for +2348000000001 (registration): XXXXXX"\n' +
      '  2. Verify via curl:\n' +
      `     curl -X POST ${BASE_URL}/api/v1/auth/verify-otp -H "Content-Type: application/json" -d "{\\"phone_number\\":\\"${TEST_PHONE}\\",\\"otp\\":\\"XXXXXX\\",\\"purpose\\":\\"registration\\"}"\n` +
      '  3. Run this script again.'
    );
  } catch (err: any) {
    if (err.response?.status === 409) {
      throw new Error('Test user exists but login failed. Check password.');
    }
    throw err;
  }
}

async function run() {
  console.log('🔐 Authenticating test user…');
  const token = await ensureTestUser();
  console.log('✅ Token acquired');

  // ============================================
  // POSITIVE TEST — valid token
  // ============================================
  console.log('\n▶️  POSITIVE TEST: connecting with valid token…');

  const goodSocket = ioClient(BASE_URL, {
    path: '/realtime',
    transports: ['websocket'],
    auth: { token: `Bearer ${token}` },
    reconnection: false,
  });

  goodSocket.on('connect', () => {
    console.log('✅ Connected:', goodSocket.id);
  });

  goodSocket.on('connected', (payload) => {
    console.log('✅ Server ack:', payload);
    goodSocket.disconnect();

    // ============================================
    // NEGATIVE TEST — no token
    // ============================================
    console.log('\n▶️  NEGATIVE TEST: connecting with no token…');

    const badSocket = ioClient(BASE_URL, {
      path: '/realtime',
      transports: ['websocket'],
      auth: {},
      reconnection: false,
    });

    badSocket.on('connect', () => {
      console.error('❌ FAIL: bad socket connected but should have been rejected');
      process.exit(1);
    });

    badSocket.on('connect_error', (err) => {
      console.log('✅ Rejected as expected:', err.message);
      console.log('\n🎉 W2 auth handshake verified.');
      process.exit(0);
    });

    setTimeout(() => {
      console.error('❌ Timed out waiting for rejection');
      process.exit(1);
    }, 5000);
  });

  goodSocket.on('connect_error', (err) => {
    console.error('❌ Valid-token connect failed:', err.message);
    process.exit(1);
  });

  setTimeout(() => {
    console.error('❌ Timed out waiting for server ack');
    process.exit(1);
  }, 10000);
}

run().catch((err) => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});