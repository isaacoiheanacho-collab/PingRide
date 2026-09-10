// migrate.js
require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Configuration
const MIGRATIONS_TABLE = 'migrations';
const MIGRATIONS_DIR = path.join(__dirname, 'src', 'database', 'migrations');

async function runMigration() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' 
            ? { rejectUnauthorized: false } 
            : false
    });

    try {
        console.log('📦 Connecting to database...');
        await client.connect();
        console.log('✅ Connected successfully!');

        // Create migrations table if it doesn't exist
        await createMigrationsTable(client);

        // Get list of migration files
        const migrationFiles = getMigrationFiles();
        console.log(`📁 Found ${migrationFiles.length} migration file(s)`);

        // Get already applied migrations
        const appliedMigrations = await getAppliedMigrations(client);
        console.log(`✅ ${appliedMigrations.length} migration(s) already applied`);

        // Filter pending migrations
        const pendingMigrations = migrationFiles.filter(
            file => !appliedMigrations.includes(file)
        );

        if (pendingMigrations.length === 0) {
            console.log('✅ All migrations are already applied. No action needed.');
            await client.end();
            return;
        }

        console.log(`🔄 ${pendingMigrations.length} migration(s) pending...`);

        // Run each pending migration in a transaction
        for (const migrationFile of pendingMigrations) {
            await runSingleMigration(client, migrationFile);
        }

        // Verify all tables
        await verifyTables(client);

        await client.end();
        console.log('✅ All migrations completed successfully!');
    } catch (err) {
        console.error('❌ Migration failed:', err.message);
        console.error(err.stack);
        process.exit(1);
    }
}

/**
 * Create migrations table if it doesn't exist
 */
async function createMigrationsTable(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL UNIQUE,
            applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            checksum VARCHAR(64)
        )
    `);
    console.log('📋 Migrations table ready');
}

/**
 * Get list of migration files sorted by name
 */
function getMigrationFiles() {
    try {
        const files = fs.readdirSync(MIGRATIONS_DIR);
        const sqlFiles = files
            .filter(file => file.endsWith('.sql'))
            .sort();
        return sqlFiles;
    } catch (error) {
        console.log(`📁 No migrations directory found at ${MIGRATIONS_DIR}`);
        console.log('💡 Creating migrations directory...');
        fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
        return [];
    }
}

/**
 * Get already applied migrations
 */
async function getAppliedMigrations(client) {
    const result = await client.query(
        `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY id`
    );
    return result.rows.map(row => row.name);
}

/**
 * Run a single migration file
 */
async function runSingleMigration(client, migrationFile) {
    const filePath = path.join(MIGRATIONS_DIR, migrationFile);
    const sql = fs.readFileSync(filePath, 'utf8');

    console.log(`\n📝 Running: ${migrationFile}`);

    try {
        // Run migration in a transaction
        await client.query('BEGIN');

        // Execute the migration
        await client.query(sql);

        // Calculate checksum (optional)
        const checksum = require('crypto')
            .createHash('sha256')
            .update(sql)
            .digest('hex');

        // Record the migration
        await client.query(
            `INSERT INTO ${MIGRATIONS_TABLE} (name, checksum) VALUES ($1, $2)`,
            [migrationFile, checksum]
        );

        await client.query('COMMIT');

        console.log(`✅ Applied: ${migrationFile}`);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`❌ Failed: ${migrationFile}`);
        throw err;
    }
}

/**
 * Verify all tables exist
 */
async function verifyTables(client) {
    const result = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name
    `);

    console.log('\n📋 Tables in database:');
    const tables = result.rows.map(row => row.table_name);
    
    // Group tables by category
    const categories = {
        'Core': ['users', 'sessions', 'otp_codes', 'user_roles', 'admin_profiles'],
        'Passenger': ['passenger_profiles', 'passenger_preferences', 'saved_locations'],
        'Driver': ['driver_profiles', 'driver_documents', 'driver_kyc_records', 'vehicles', 'driver_availability', 'driver_availability_log', 'driver_location_history', 'driver_risk_insurance', 'driver_suspensions', 'driver_daily_performance'],
        'Ride': ['ride_requests', 'ride_bids', 'rides', 'ride_cancellations', 'ride_locations', 'ride_status_history', 'gps_tracking'],
        'Payment': ['wallets', 'wallet_transactions', 'payments', 'payment_authorisations', 'refunds', 'withdrawals', 'settlements', 'fare_calculations', 'fare_estimates'],
        'Virtual Accounts': ['virtual_accounts', 'bank_transfer_events', 'unmatched_transfers'],
        'Incentive': ['programme_periods', 'passenger_qualification_registry', 'passenger_qualification_progress', 'driver_qualification_registry', 'driver_qualification_progress', 'rebate_fund_balance', 'rebate_fund_contributions', 'rebate_allocations', 'rebate_credits', 'rebate_credit_usage', 'winners', 'incentive_fraud_cases', 'qualification_exclusions'],
        'Other': ['cash_violations', 'fraud_cases', 'ratings', 'disputes', 'incidents', 'sos_events', 'notifications', 'notification_templates', 'promotions', 'promotion_usage', 'support_tickets', 'audit_logs', 'daily_reservations', 'daily_reservation_bids', 'daily_reservation_stops', 'daily_metrics', 'platform_configuration']
    };

    // Display tables by category
    for (const [category, expectedTables] of Object.entries(categories)) {
        const found = expectedTables.filter(t => tables.includes(t));
        const missing = expectedTables.filter(t => !tables.includes(t));
        
        console.log(`\n  ${category}:`);
        if (found.length > 0) {
            console.log(`    ✅ Found: ${found.join(', ')}`);
        }
        if (missing.length > 0) {
            console.log(`    ❌ Missing: ${missing.join(', ')}`);
        }
    }

    console.log(`\n📊 Total tables: ${tables.length}`);
}

// Run the migration
runMigration();