import pool from '../config/database';
import logger from '../utils/logger';

// ============================================
// EXPECTED SCHEMA
// ============================================
// This list is the contract between the application code and the database.
// If any of these are missing at boot, the app refuses to start. That is
// deliberate: it is better to fail loudly on startup than to serve traffic
// that produces "column does not exist" errors on a rare code path.

const EXPECTED_TABLES: readonly string[] = [
  // Auth & users
  'users',
  'passenger_profiles',
  'driver_profiles',
  'admin_profiles',

  // Onboarding
  'user_consents',
  'driver_documents',
  'driver_kyc_records',
  'vehicles',

  // Wallet & payments
  'wallets',
  'wallet_transactions',
  'payments',
  'virtual_accounts',
  'bank_transfer_events',

  // Ledger & settlements (settlements table itself may be empty; we only
  // assert that the table exists so the ledger history endpoints keep working)
  'driver_ledger',
  'driver_ledger_transactions',

  // Rides
  'ride_requests',
  'ride_bids',
  'rides',

  // Incentive ecosystem
  'programme_periods',
  'passenger_qualification_registry',
  'driver_qualification_registry',
  'rebate_fund_balance',
  'rebate_fund_contributions',
  'rebate_allocations',
  'rebate_credits',
  'winners',
  'incentive_fraud_cases',
  'qualification_exclusions',

  // Violations & suspensions
  'cash_violations',
  'driver_suspensions',
];

// Columns that are required by code paths that were added in Phases 2C/2D
// and by the new suspension / commission-owed flow. If the DB is missing
// any of these, the corresponding endpoints would throw at runtime.
const EXPECTED_COLUMNS: Record<string, readonly string[]> = {
  driver_profiles: [
    // Phase 2B — subaccount
    'subaccount_code',
    'subaccount_status',
    // Phase 2C — identity
    'license_verified',
    'license_back_url',
    'nin',
    'nin_id_card_url',
    'nin_verified',
    'bvn',
    'bvn_verified',
    'selfie_url',
    'identity_fully_verified',
    'identity_verified_at',
    'identity_submitted_at',
    'identity_reviewed_at',
    'identity_reviewed_by',
    'identity_review_notes',
    // Commission owed (Phase D4)
    'total_commission_owed',
  ],
  vehicles: [
    // Phase 2D — compliance
    'poc_document_url',
    'poc_verified',
    'vehicle_license_url',
    'vehicle_license_verified',
    'roadworthiness_verified',
    'hackney_permit_url',
    'hackney_permit_verified',
    'insurance_verified',
    'insurance_policy_number',
    'insurance_provider',
    'plate_verified',
    'plate_verified_at',
    'compliance_fully_verified',
    'compliance_verified_at',
    'compliance_submitted_at',
    'compliance_reviewed_at',
    'compliance_reviewed_by',
    'compliance_notes',
  ],
  user_consents: [
    'user_id',
    'consent_type',
    'consent_version',
    'granted',
    'revoked_at',
  ],
  bank_transfer_events: [
    'metadata',
  ],
  wallets: [
    'deposited_balance',
    'rebate_credit_balance',
    'promotional_balance',
  ],
};

// ============================================
// VERIFICATION
// ============================================

interface VerificationResult {
  ok: boolean;
  missingTables: string[];
  missingColumns: Record<string, string[]>;
}

async function checkTables(): Promise<string[]> {
  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])`,
    [EXPECTED_TABLES as unknown as string[]]
  );

  const found = new Set(result.rows.map((r) => r.table_name));
  return EXPECTED_TABLES.filter((t) => !found.has(t));
}

async function checkColumns(): Promise<Record<string, string[]>> {
  const tableNames = Object.keys(EXPECTED_COLUMNS);
  const missing: Record<string, string[]> = {};

  for (const tableName of tableNames) {
    const expected = EXPECTED_COLUMNS[tableName];
    if (!expected || expected.length === 0) continue;

    const result = await pool.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = $1
         AND column_name = ANY($2::text[])`,
      [tableName, expected as unknown as string[]]
    );

    const found = new Set(result.rows.map((r) => r.column_name));
    const tableMissing = expected.filter((c) => !found.has(c));

    if (tableMissing.length > 0) {
      missing[tableName] = tableMissing;
    }
  }

  return missing;
}

async function runVerification(): Promise<VerificationResult> {
  const [missingTables, missingColumns] = await Promise.all([
    checkTables(),
    checkColumns(),
  ]);

  const ok =
    missingTables.length === 0 &&
    Object.keys(missingColumns).length === 0;

  return { ok, missingTables, missingColumns };
}

/**
 * Verify that the database has the tables and columns the application expects.
 *
 * Called once at boot, before the HTTP server starts accepting requests.
 *
 * On failure:
 *   - Logs every missing table and column.
 *   - Throws, so the caller can decide whether to exit the process.
 *
 * In production, you almost always want to exit on failure. In development,
 * you may want to log and continue so you can finish wiring things up — pass
 * `{ exitOnFailure: false }` to get that behaviour.
 */
export async function verifyDatabase(options?: {
  exitOnFailure?: boolean;
}): Promise<void> {
  const exitOnFailure = options?.exitOnFailure ?? true;

  logger.info('🔍 Verifying database schema…');

  let result: VerificationResult;
  try {
    result = await runVerification();
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`❌ Database verification could not run: ${msg}`);
    if (exitOnFailure) {
      process.exit(1);
    }
    return;
  }

  if (result.ok) {
    logger.info(
      `✅ Database schema verified: ${EXPECTED_TABLES.length} tables, ` +
      `${Object.values(EXPECTED_COLUMNS).reduce((n, cols) => n + cols.length, 0)} critical columns present`
    );
    return;
  }

  // Build a readable report
  const lines: string[] = [];
  if (result.missingTables.length > 0) {
    lines.push(`  Missing tables (${result.missingTables.length}):`);
    for (const t of result.missingTables) {
      lines.push(`    - ${t}`);
    }
  }

  const missingColumnTables = Object.keys(result.missingColumns);
  if (missingColumnTables.length > 0) {
    lines.push(`  Missing columns (${missingColumnTables.length} tables):`);
    for (const t of missingColumnTables) {
      lines.push(`    - ${t}: ${result.missingColumns[t]?.join(', ')}`);
    }
  }

  logger.error('❌ Database schema verification failed:');
  for (const line of lines) {
    logger.error(line);
  }
  logger.error(
    '   Run the pending migrations on this database before starting the server.'
  );

  if (exitOnFailure) {
    process.exit(1);
  }
}

export default verifyDatabase;