// ============================================
// PINGRIDE SEED DATA SCRIPT
// ============================================
// Usage:
//   Development: node seed.js
//   Dry run:     node seed.js --dry-run
//   Force:       node seed.js --force
// ============================================

require('dotenv').config();
const { Client } = require('pg');
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 12;

// ============================================
// CONFIGURATION
// ============================================

const SEED_CONFIG = {
    // Admin user
    admin: {
        phone: '+2348076543210',
        email: 'admin@pingride.com',
        password: 'Admin@1234',
        firstName: 'Super',
        lastName: 'Admin',
        role: 'admin',
        adminRole: 'super_admin',
        department: 'Platform Operations',
    },
    // Driver user
    driver: {
        phone: '+2348098765432',
        email: 'driver@pingride.com',
        password: 'Driver@1234',
        firstName: 'James',
        lastName: 'Okonkwo',
        role: 'driver',
        licenseNumber: 'DL-123456789',
        licenseExpiry: '2030-12-31',
        address: '10 Adeola Street, Lagos',
        stateOfOrigin: 'Lagos',
        emergencyContactName: 'Mary Okonkwo',
        emergencyContactPhone: '+2348098765433',
        vehicleReg: 'LAG-5678-HIJ',
        vehicleMake: 'Honda',
        vehicleModel: 'Accord',
        vehicleYear: 2023,
        vehicleColour: 'Red',
        vehicleType: 'standard',
    },
    // Passenger user
    passenger: {
        phone: '+2348012345678',
        email: 'passenger@pingride.com',
        password: 'Passenger@1234',
        firstName: 'John',
        lastName: 'Smith',
        role: 'passenger',
        trustScore: 4.5,
    },
};

// ============================================
// MAIN SEED FUNCTION
// ============================================

async function seedDatabase() {
    // Safety check - prevent running in production
    if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
        console.log('❌ Cannot run seeds in production!');
        console.log('   Use --force only if you know what you are doing.');
        process.exit(1);
    }

    // Dry run check
    if (process.argv.includes('--dry-run')) {
        console.log('📋 DRY RUN - No changes will be made');
        console.log('   To run: node seed.js');
        console.log('   To force in production: node seed.js --force');
        process.exit(0);
    }

    console.log('🌱 Seeding database in', process.env.NODE_ENV, 'mode...');
    console.log('⚠️  This will create test accounts if they do not exist.\n');

    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
    });

    try {
        await client.connect();
        console.log('✅ Connected to database');

        const results = {
            users: 0,
            profiles: 0,
            vehicles: 0,
            wallets: 0,
            documents: 0,
        };

        // ============================================
        // 1. CREATE OR UPDATE ADMIN
        // ============================================
        console.log('\n📋 Creating admin...');
        const adminHash = await bcrypt.hash(SEED_CONFIG.admin.password, SALT_ROUNDS);

        let adminId = await getUserId(client, SEED_CONFIG.admin.phone);

        if (!adminId) {
            const result = await client.query(
                `INSERT INTO users (
                    phone_number, email, password_hash, role, status, phone_verified
                ) VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id`,
                [
                    SEED_CONFIG.admin.phone,
                    SEED_CONFIG.admin.email,
                    adminHash,
                    SEED_CONFIG.admin.role,
                    'active',
                    true,
                ]
            );
            adminId = result.rows[0].id;
            results.users++;
            console.log('   ✅ Admin user created');
        } else {
            console.log('   ℹ️  Admin already exists');
        }

        // Admin profile
        const adminProfile = await client.query(
            'SELECT id FROM admin_profiles WHERE user_id = $1',
            [adminId]
        );

        if (adminProfile.rows.length === 0) {
            await client.query(
                `INSERT INTO admin_profiles (
                    user_id, admin_role, department, status
                ) VALUES ($1, $2, $3, $4)`,
                [
                    adminId,
                    SEED_CONFIG.admin.adminRole,
                    SEED_CONFIG.admin.department,
                    'active',
                ]
            );
            results.profiles++;
            console.log('   ✅ Admin profile created');
        } else {
            console.log('   ℹ️  Admin profile already exists');
        }

        // ============================================
        // 2. CREATE OR UPDATE DRIVER
        // ============================================
        console.log('\n📋 Creating driver...');
        const driverHash = await bcrypt.hash(SEED_CONFIG.driver.password, SALT_ROUNDS);

        let driverUserId = await getUserId(client, SEED_CONFIG.driver.phone);

        if (!driverUserId) {
            const result = await client.query(
                `INSERT INTO users (
                    phone_number, email, password_hash, role, status, phone_verified
                ) VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id`,
                [
                    SEED_CONFIG.driver.phone,
                    SEED_CONFIG.driver.email,
                    driverHash,
                    SEED_CONFIG.driver.role,
                    'active',
                    true,
                ]
            );
            driverUserId = result.rows[0].id;
            results.users++;
            console.log('   ✅ Driver user created');
        } else {
            console.log('   ℹ️  Driver already exists');
        }

        // Driver profile
        let driverProfileId = await getDriverProfileId(client, driverUserId);

        if (!driverProfileId) {
            const result = await client.query(
                `INSERT INTO driver_profiles (
                    user_id, first_name, last_name,
                    driver_license_number, driver_license_expiry,
                    driver_status, availability_status, kyc_status,
                    address, state_of_origin,
                    emergency_contact_name, emergency_contact_phone,
                    has_air_conditioning, has_working_stereo,
                    max_trips_per_day, max_distance_per_day
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                RETURNING id`,
                [
                    driverUserId,
                    SEED_CONFIG.driver.firstName,
                    SEED_CONFIG.driver.lastName,
                    SEED_CONFIG.driver.licenseNumber,
                    SEED_CONFIG.driver.licenseExpiry,
                    'active',
                    'offline',
                    'approved',
                    SEED_CONFIG.driver.address,
                    SEED_CONFIG.driver.stateOfOrigin,
                    SEED_CONFIG.driver.emergencyContactName,
                    SEED_CONFIG.driver.emergencyContactPhone,
                    true,
                    true,
                    30,
                    300,
                ]
            );
            driverProfileId = result.rows[0].id;
            results.profiles++;
            console.log('   ✅ Driver profile created (KYC approved)');
        } else {
            // Ensure KYC is approved for existing driver
            await client.query(
                `UPDATE driver_profiles 
                 SET kyc_status = 'approved', driver_status = 'active', updated_at = NOW()
                 WHERE id = $1`,
                [driverProfileId]
            );
            console.log('   ✅ Driver KYC updated to approved');
        }

        // Driver KYC record
        const kycRecord = await client.query(
            'SELECT id FROM driver_kyc_records WHERE driver_id = $1',
            [driverProfileId]
        );

        if (kycRecord.rows.length === 0) {
            await client.query(
                `INSERT INTO driver_kyc_records (
                    driver_id, verification_status, verified_at
                ) VALUES ($1, $2, $3)`,
                [driverProfileId, 'approved', new Date()]
            );
            results.documents++;
            console.log('   ✅ KYC record created');
        }

        // ============================================
        // 3. CREATE VEHICLE FOR DRIVER
        // ============================================
        console.log('\n📋 Creating vehicle...');

        const vehicleExists = await client.query(
            'SELECT id FROM vehicles WHERE driver_id = $1 AND registration_number = $2',
            [driverProfileId, SEED_CONFIG.driver.vehicleReg]
        );

        if (vehicleExists.rows.length === 0) {
            await client.query(
                `INSERT INTO vehicles (
                    driver_id, registration_number, make, model, year, colour,
                    vehicle_type, status, is_primary, seat_count
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [
                    driverProfileId,
                    SEED_CONFIG.driver.vehicleReg,
                    SEED_CONFIG.driver.vehicleMake,
                    SEED_CONFIG.driver.vehicleModel,
                    SEED_CONFIG.driver.vehicleYear,
                    SEED_CONFIG.driver.vehicleColour,
                    SEED_CONFIG.driver.vehicleType,
                    'active',
                    true,
                    4,
                ]
            );
            results.vehicles++;
            console.log('   ✅ Vehicle created');
        } else {
            console.log('   ℹ️  Vehicle already exists');
        }

        // ============================================
        // 4. CREATE OR UPDATE PASSENGER
        // ============================================
        console.log('\n📋 Creating passenger...');
        const passengerHash = await bcrypt.hash(SEED_CONFIG.passenger.password, SALT_ROUNDS);

        let passengerUserId = await getUserId(client, SEED_CONFIG.passenger.phone);

        if (!passengerUserId) {
            const result = await client.query(
                `INSERT INTO users (
                    phone_number, email, password_hash, role, status, phone_verified
                ) VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id`,
                [
                    SEED_CONFIG.passenger.phone,
                    SEED_CONFIG.passenger.email,
                    passengerHash,
                    SEED_CONFIG.passenger.role,
                    'active',
                    true,
                ]
            );
            passengerUserId = result.rows[0].id;
            results.users++;
            console.log('   ✅ Passenger user created');
        } else {
            console.log('   ℹ️  Passenger already exists');
        }

        // Passenger profile
        const passengerProfile = await client.query(
            'SELECT id FROM passenger_profiles WHERE user_id = $1',
            [passengerUserId]
        );

        if (passengerProfile.rows.length === 0) {
            await client.query(
                `INSERT INTO passenger_profiles (
                    user_id, first_name, last_name, trust_score
                ) VALUES ($1, $2, $3, $4)`,
                [
                    passengerUserId,
                    SEED_CONFIG.passenger.firstName,
                    SEED_CONFIG.passenger.lastName,
                    SEED_CONFIG.passenger.trustScore,
                ]
            );
            results.profiles++;
            console.log('   ✅ Passenger profile created');
        } else {
            console.log('   ℹ️  Passenger profile already exists');
        }

        // ============================================
        // 5. CREATE WALLETS
        // ============================================
        console.log('\n📋 Creating wallets...');

        // Driver wallet
        const driverWallet = await client.query(
            'SELECT id FROM wallets WHERE user_id = $1',
            [driverUserId]
        );
        if (driverWallet.rows.length === 0) {
            await client.query(
                `INSERT INTO wallets (user_id, balance, currency, status)
                 VALUES ($1, $2, $3, $4)`,
                [driverUserId, 25000.00, 'NGN', 'active']
            );
            results.wallets++;
            console.log('   ✅ Driver wallet created (₦25,000)');
        } else {
            console.log('   ℹ️  Driver wallet already exists');
        }

        // Passenger wallet
        const passengerWallet = await client.query(
            'SELECT id FROM wallets WHERE user_id = $1',
            [passengerUserId]
        );
        if (passengerWallet.rows.length === 0) {
            await client.query(
                `INSERT INTO wallets (user_id, balance, currency, status)
                 VALUES ($1, $2, $3, $4)`,
                [passengerUserId, 50000.00, 'NGN', 'active']
            );
            results.wallets++;
            console.log('   ✅ Passenger wallet created (₦50,000)');
        } else {
            console.log('   ℹ️  Passenger wallet already exists');
        }

        // Admin wallet
        const adminWallet = await client.query(
            'SELECT id FROM wallets WHERE user_id = $1',
            [adminId]
        );
        if (adminWallet.rows.length === 0) {
            await client.query(
                `INSERT INTO wallets (user_id, balance, currency, status)
                 VALUES ($1, $2, $3, $4)`,
                [adminId, 0.00, 'NGN', 'active']
            );
            results.wallets++;
            console.log('   ✅ Admin wallet created');
        }

        // ============================================
        // 6. SUMMARY
        // ============================================
        console.log('\n' + '='.repeat(50));
        console.log('✅🌱 SEEDING COMPLETED SUCCESSFULLY!');
        console.log('='.repeat(50));
        console.log('\n📊 Summary:');
        console.log(`   👤 Users:      ${results.users}`);
        console.log(`   📝 Profiles:   ${results.profiles}`);
        console.log(`   🚗 Vehicles:   ${results.vehicles}`);
        console.log(`   💳 Wallets:    ${results.wallets}`);
        console.log(`   📄 Documents:  ${results.documents}`);

        console.log('\n📋 TEST CREDENTIALS:');
        console.log('   👤 Admin:     +2348076543210 / Admin@1234');
        console.log('   👤 Driver:    +2348098765432 / Driver@1234');
        console.log('   👤 Passenger: +2348012345678 / Passenger@1234');

        console.log('\n✅ Driver KYC is PRE-APPROVED!');
        console.log('✅ Driver can go online immediately.');
        console.log('\n🚀 Ready for testing!');

        await client.end();
        process.exit(0);
    } catch (err) {
        console.error('\n❌ Seeding failed:', err.message);
        console.error('   Stack:', err.stack);
        await client.end();
        process.exit(1);
    }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get user ID by phone number
 */
async function getUserId(client, phoneNumber) {
    const result = await client.query(
        'SELECT id FROM users WHERE phone_number = $1 AND deleted_at IS NULL',
        [phoneNumber]
    );
    return result.rows.length > 0 ? result.rows[0].id : null;
}

/**
 * Get driver profile ID by user ID
 */
async function getDriverProfileId(client, userId) {
    const result = await client.query(
        'SELECT id FROM driver_profiles WHERE user_id = $1',
        [userId]
    );
    return result.rows.length > 0 ? result.rows[0].id : null;
}

// ============================================
// RUN THE SEED
// ============================================

if (require.main === module) {
    seedDatabase();
}

module.exports = seedDatabase;