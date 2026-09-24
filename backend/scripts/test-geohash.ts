import { encode, decode, neighbours } from '../src/utils/geohash';

/**
 * Standalone sanity check for the geohash utility.
 * Run: npm run test:geohash
 */

// ============================================
// SAMPLE COORDINATES
// ============================================
// Two real Lagos landmarks used throughout PingRide development.
// If the geohash utility is working, these should produce stable
// strings and sensible neighbour sets.

const SAMPLE = {
  lagos: { lat: 6.5244, lng: 3.3792, label: 'Lagos Island' },
  ikeja: { lat: 6.6018, lng: 3.3515, label: 'Ikeja' },
};

function line(label: string, value: unknown): void {
  console.log(`  ${label.padEnd(28)} ${JSON.stringify(value)}`);
}

console.log('🧪 Geohash utility sanity check\n');

// ============================================
// TEST 1 — ENCODE
// ============================================
console.log('▶️  TEST 1 — encode()');

for (const point of Object.values(SAMPLE)) {
  const hash = encode(point.lat, point.lng);
  console.log(`  ${point.label}`);
  line('input', `${point.lat}, ${point.lng}`);
  line('geohash (precision 5)', hash);
  line('length', hash.length);

  if (hash.length !== 5) {
    console.error(`  ❌ FAIL: expected length 5, got ${hash.length}`);
    process.exit(1);
  }
}

console.log('  ✅ encode() works\n');

// ============================================
// TEST 2 — DETERMINISM
// ============================================
console.log('▶️  TEST 2 — determinism');

const h1 = encode(SAMPLE.lagos.lat, SAMPLE.lagos.lng);
const h2 = encode(SAMPLE.lagos.lat, SAMPLE.lagos.lng);
const h3 = encode(SAMPLE.lagos.lat, SAMPLE.lagos.lng);

if (h1 === h2 && h2 === h3) {
  console.log(`  ✅ three calls, same hash: ${h1}\n`);
} else {
  console.error('  ❌ FAIL: encode() is not deterministic');
  process.exit(1);
}

// ============================================
// TEST 3 — DECODE
// ============================================
console.log('▶️  TEST 3 — decode()');

const decoded = decode(h1);
console.log(`  input geohash: ${h1}`);
line('decoded lat', decoded.lat);
line('decoded lng', decoded.lng);

// The decoded point is the cell's center, so it will be close to
// the original but not identical. Assert within ~1km.
const latDelta = Math.abs(decoded.lat - SAMPLE.lagos.lat);
const lngDelta = Math.abs(decoded.lng - SAMPLE.lagos.lng);

if (latDelta < 0.05 && lngDelta < 0.05) {
  console.log(`  ✅ decode() within tolerance (Δlat=${latDelta.toFixed(4)}, Δlng=${lngDelta.toFixed(4)})\n`);
} else {
  console.error('  ❌ FAIL: decode() drifted too far from input');
  process.exit(1);
}

// ============================================
// TEST 4 — NEIGHBOURS
// ============================================
console.log('▶️  TEST 4 — neighbours()');

const n = neighbours(SAMPLE.lagos.lat, SAMPLE.lagos.lng);

console.log(`  total cells returned: ${n.length}`);
console.log(`  centre cell: ${n[0]}`);
console.log(`  list:`);
for (const hash of n) {
  console.log(`    - ${hash}`);
}

if (n.length !== 9) {
  console.error(`  ❌ FAIL: expected 9 cells, got ${n.length}`);
  process.exit(1);
}

const unique = new Set(n);
if (unique.size !== 9) {
  console.error(`  ❌ FAIL: expected 9 unique cells, got ${unique.size}`);
  process.exit(1);
}

console.log('  ✅ neighbours() returns 9 unique cells\n');

// ============================================
// TEST 5 — STABILITY OF NEIGHBOURS
// ============================================
console.log('▶️  TEST 5 — neighbour stability');

const n1 = neighbours(SAMPLE.lagos.lat, SAMPLE.lagos.lng);
const n2 = neighbours(SAMPLE.lagos.lat, SAMPLE.lagos.lng);

if (JSON.stringify(n1) === JSON.stringify(n2)) {
  console.log('  ✅ neighbours() is deterministic\n');
} else {
  console.error('  ❌ FAIL: neighbours() returned different results');
  process.exit(1);
}

// ============================================
// TEST 6 — DIFFERENT LOCATIONS, DIFFERENT CELLS
// ============================================
console.log('▶️  TEST 6 — Lagos vs Ikeja');

const lagosHash = encode(SAMPLE.lagos.lat, SAMPLE.lagos.lng);
const ikejaHash = encode(SAMPLE.ikeja.lat, SAMPLE.ikeja.lng);

console.log(`  Lagos: ${lagosHash}`);
console.log(`  Ikeja: ${ikejaHash}`);

if (lagosHash === ikejaHash) {
  console.error('  ❌ FAIL: different locations produced same hash at precision 5');
  process.exit(1);
}

console.log('  ✅ distinct locations produce distinct hashes\n');

console.log('🎉 All geohash tests passed.');