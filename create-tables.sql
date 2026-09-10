-- ============================================
-- PINGRIDE DATABASE SCHEMA
-- Complete production schema
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- USERS & AUTHENTICATION
-- ============================================

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number VARCHAR(20) NOT NULL UNIQUE,
    email VARCHAR(255) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(30) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending_verification',
    phone_verified BOOLEAN DEFAULT FALSE,
    email_verified BOOLEAN DEFAULT FALSE,
    last_login_at TIMESTAMP,
    login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP,
    preferred_language VARCHAR(10) DEFAULT 'en',
    CONSTRAINT users_role_check CHECK (role IN ('passenger', 'driver', 'admin', 'support', 'operations')),
    CONSTRAINT users_status_check CHECK (status IN ('active', 'pending_verification', 'suspended', 'deactivated', 'locked'))
);

CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(500) NOT NULL UNIQUE,
    refresh_token VARCHAR(500) NOT NULL UNIQUE,
    device_id VARCHAR(255) NOT NULL,
    device_type VARCHAR(50) NOT NULL,
    ip_address INET,
    user_agent TEXT,
    expires_at TIMESTAMP NOT NULL,
    revoked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT sessions_device_type_check CHECK (device_type IN ('ios', 'android', 'web'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_refresh ON sessions(refresh_token);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- OTP Codes table
CREATE TABLE IF NOT EXISTS otp_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number VARCHAR(20) NOT NULL,
    code VARCHAR(10) NOT NULL,
    purpose VARCHAR(50) NOT NULL,
    attempts INTEGER DEFAULT 0,
    expires_at TIMESTAMP NOT NULL,
    verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT otp_codes_purpose_check CHECK (purpose IN ('registration', 'login', 'password_reset', 'phone_change'))
);

CREATE INDEX IF NOT EXISTS idx_otp_created ON otp_codes(created_at);
CREATE INDEX IF NOT EXISTS idx_otp_expires ON otp_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone_number);

-- User Roles table
CREATE TABLE IF NOT EXISTS user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL,
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT user_roles_role_check CHECK (role IN ('passenger', 'driver', 'admin', 'support', 'operations', 'super_admin'))
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);

-- Admin Profiles table
CREATE TABLE IF NOT EXISTS admin_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
    admin_role VARCHAR(50) NOT NULL,
    permissions JSONB,
    department VARCHAR(100),
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT admin_profiles_admin_role_check CHECK (admin_role IN ('super_admin', 'operations_manager', 'support_manager', 'finance_manager', 'content_manager')),
    CONSTRAINT admin_profiles_status_check CHECK (status IN ('active', 'inactive', 'suspended'))
);

CREATE INDEX IF NOT EXISTS idx_admin_role ON admin_profiles(admin_role);
CREATE INDEX IF NOT EXISTS idx_admin_status ON admin_profiles(status);
CREATE INDEX IF NOT EXISTS idx_admin_user ON admin_profiles(user_id);

-- ============================================
-- PASSENGER MODULE
-- ============================================

-- Passenger Profiles table
CREATE TABLE IF NOT EXISTS passenger_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    profile_photo_url TEXT,
    date_of_birth DATE,
    gender VARCHAR(30),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    trust_score NUMERIC DEFAULT 4.0,
    total_rides INTEGER DEFAULT 0,
    lifetime_spend NUMERIC DEFAULT 0.00,
    rating_as_passenger NUMERIC,
    virtual_account_id UUID,
    bvn VARCHAR(20),
    nin VARCHAR(20),
    kyc_status VARCHAR(20) DEFAULT 'pending',
    kyc_verified_at TIMESTAMPTZ,
    kyc_verified_by UUID,
    kyc_failure_reason TEXT,
    CONSTRAINT passenger_profiles_gender_check CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say')),
    CONSTRAINT passenger_profiles_kyc_status_check CHECK (kyc_status IN ('pending', 'verified', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_passenger_created ON passenger_profiles(created_at);
CREATE INDEX IF NOT EXISTS idx_passenger_user ON passenger_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_passenger_virtual_account ON passenger_profiles(virtual_account_id);
CREATE INDEX IF NOT EXISTS idx_passenger_kyc_status ON passenger_profiles(kyc_status);
CREATE INDEX IF NOT EXISTS idx_passenger_bvn ON passenger_profiles(bvn);
CREATE INDEX IF NOT EXISTS idx_passenger_nin ON passenger_profiles(nin);

-- Passenger Preferences table
CREATE TABLE IF NOT EXISTS passenger_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    passenger_id UUID NOT NULL UNIQUE REFERENCES passenger_profiles(id) ON DELETE RESTRICT,
    preferred_vehicle_type VARCHAR(20) DEFAULT 'standard',
    music_preference VARCHAR(50) DEFAULT 'any',
    conversation_preference VARCHAR(50) DEFAULT 'any',
    max_wait_time INTEGER DEFAULT 10,
    notify_promotions BOOLEAN DEFAULT TRUE,
    notify_ride_updates BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT passenger_preferences_preferred_vehicle_type_check CHECK (preferred_vehicle_type IN ('standard', 'premium', 'executive')),
    CONSTRAINT passenger_preferences_music_preference_check CHECK (music_preference IN ('quiet', 'radio', 'podcast', 'any')),
    CONSTRAINT passenger_preferences_conversation_preference_check CHECK (conversation_preference IN ('quiet', 'friendly', 'business', 'any'))
);

-- Saved Locations table
CREATE TABLE IF NOT EXISTS saved_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    passenger_id UUID NOT NULL REFERENCES passenger_profiles(id) ON DELETE RESTRICT,
    label VARCHAR(50) NOT NULL,
    address TEXT NOT NULL,
    latitude NUMERIC NOT NULL,
    longitude NUMERIC NOT NULL,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_locations_passenger ON saved_locations(passenger_id);

-- ============================================
-- DRIVER MODULE
-- ============================================

-- Driver Profiles table
CREATE TABLE IF NOT EXISTS driver_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    profile_photo_url TEXT,
    date_of_birth DATE,
    driver_status VARCHAR(30) NOT NULL DEFAULT 'pending',
    availability_status VARCHAR(30) NOT NULL DEFAULT 'offline',
    rating_average NUMERIC,
    total_rides INTEGER DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    total_earnings NUMERIC DEFAULT 0.00,
    acceptance_rate NUMERIC DEFAULT 0.00,
    completion_rate NUMERIC DEFAULT 0.00,
    kyc_status VARCHAR(30) DEFAULT 'pending',
    driver_license_number VARCHAR(50) UNIQUE,
    driver_license_expiry DATE,
    address TEXT,
    state_of_origin VARCHAR(100),
    emergency_contact_name VARCHAR(100),
    emergency_contact_phone VARCHAR(20),
    hygiene_score NUMERIC,
    vehicle_cleanliness_score NUMERIC,
    drive_quality_score NUMERIC,
    overall_quality_badge VARCHAR(50) DEFAULT 'New',
    insurance_status VARCHAR(20) DEFAULT 'pending',
    insurance_expiry DATE,
    has_air_conditioning BOOLEAN DEFAULT TRUE,
    has_working_stereo BOOLEAN DEFAULT TRUE,
    interior_air_freshener BOOLEAN DEFAULT FALSE,
    kyc_approved_at TIMESTAMP,
    kyc_rejected_reason TEXT,
    is_online BOOLEAN DEFAULT FALSE,
    last_online_at TIMESTAMP,
    last_location_latitude NUMERIC,
    last_location_longitude NUMERIC,
    last_location_update TIMESTAMP,
    max_trips_per_day INTEGER DEFAULT 30,
    max_distance_per_day INTEGER DEFAULT 300,
    vehicle_id UUID,
    location_geo GEOGRAPHY(Point, 4326),
    CONSTRAINT driver_profiles_driver_status_check CHECK (driver_status IN ('pending', 'under_review', 'approved', 'active', 'suspended', 'rejected', 'deactivated')),
    CONSTRAINT driver_profiles_availability_status_check CHECK (availability_status IN ('online', 'offline', 'on_trip', 'unavailable')),
    CONSTRAINT driver_profiles_kyc_status_check CHECK (kyc_status IN ('pending', 'under_review', 'approved', 'rejected', 'suspended'))
);

CREATE INDEX IF NOT EXISTS idx_driver_kyc ON driver_profiles(kyc_status);
CREATE INDEX IF NOT EXISTS idx_driver_rating ON driver_profiles(rating_average);
CREATE INDEX IF NOT EXISTS idx_driver_status ON driver_profiles(driver_status, availability_status);
CREATE INDEX IF NOT EXISTS idx_driver_user ON driver_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_driver_location_geo ON driver_profiles USING GIST (location_geo);

-- Driver Availability table
CREATE TABLE IF NOT EXISTS driver_availability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL UNIQUE REFERENCES driver_profiles(id) ON DELETE RESTRICT,
    is_online BOOLEAN DEFAULT FALSE,
    last_online_at TIMESTAMP,
    last_offline_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Driver Availability Log table
CREATE TABLE IF NOT EXISTS driver_availability_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES driver_profiles(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL,
    latitude NUMERIC,
    longitude NUMERIC,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT driver_availability_log_status_check CHECK (status IN ('online', 'offline', 'on_trip', 'unavailable'))
);

CREATE INDEX IF NOT EXISTS idx_driver_avail_log_created ON driver_availability_log(created_at);
CREATE INDEX IF NOT EXISTS idx_driver_avail_log_driver ON driver_availability_log(driver_id);

-- Driver Location History table
CREATE TABLE IF NOT EXISTS driver_location_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES driver_profiles(id) ON DELETE RESTRICT,
    latitude NUMERIC NOT NULL,
    longitude NUMERIC NOT NULL,
    speed_kmh NUMERIC,
    heading INTEGER,
    accuracy_meters NUMERIC,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_driver_location_history_created ON driver_location_history(created_at);
CREATE INDEX IF NOT EXISTS idx_driver_location_history_driver ON driver_location_history(driver_id);

-- Driver Documents table
CREATE TABLE IF NOT EXISTS driver_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES driver_profiles(id) ON DELETE RESTRICT,
    document_type VARCHAR(50) NOT NULL,
    document_number VARCHAR(100),
    document_url TEXT NOT NULL,
    expiry_date DATE,
    verification_status VARCHAR(30) NOT NULL DEFAULT 'pending',
    verification_notes TEXT,
    verified_at TIMESTAMP,
    verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT driver_documents_document_type_check CHECK (document_type IN ('national_id', 'passport', 'driver_license', 'utility_bill', 'profile_photo', 'insurance', 'vehicle_registration', 'roadworthiness')),
    CONSTRAINT driver_documents_verification_status_check CHECK (verification_status IN ('pending', 'verified', 'rejected', 'expired'))
);

-- Passenger KYC Documents table
CREATE TABLE IF NOT EXISTS passenger_kyc_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_type VARCHAR(50) NOT NULL,
    document_url TEXT NOT NULL,
    mime_type VARCHAR(100),
    file_size INTEGER,
    upload_status VARCHAR(20) DEFAULT 'uploaded',
    verification_status VARCHAR(20) DEFAULT 'pending',
    verification_notes TEXT,
    verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kyc_docs_user_id ON passenger_kyc_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_docs_status ON passenger_kyc_documents(verification_status);
CREATE INDEX IF NOT EXISTS idx_kyc_docs_upload_status ON passenger_kyc_documents(upload_status);
CREATE INDEX IF NOT EXISTS idx_kyc_docs_created_at ON passenger_kyc_documents(created_at);

-- Driver KYC Records table
CREATE TABLE IF NOT EXISTS driver_kyc_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES driver_profiles(id) ON DELETE RESTRICT,
    verification_status VARCHAR(30) NOT NULL DEFAULT 'pending',
    verification_provider VARCHAR(100),
    verified_at TIMESTAMP,
    rejection_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT driver_kyc_records_verification_status_check CHECK (verification_status IN ('pending', 'under_review', 'approved', 'rejected', 'expired'))
);

-- Vehicles table
CREATE TABLE IF NOT EXISTS vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES driver_profiles(id) ON DELETE RESTRICT,
    registration_number VARCHAR(30) NOT NULL UNIQUE,
    make VARCHAR(100) NOT NULL,
    model VARCHAR(100) NOT NULL,
    year INTEGER,
    colour VARCHAR(50),
    vehicle_type VARCHAR(50) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending_approval',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    is_primary BOOLEAN DEFAULT FALSE,
    seat_count INTEGER DEFAULT 4,
    registration_document_url VARCHAR(500),
    insurance_document_url VARCHAR(500),
    roadworthiness_document_url VARCHAR(500),
    registration_expiry DATE,
    insurance_expiry DATE,
    roadworthiness_expiry DATE,
    CONSTRAINT vehicles_vehicle_type_check CHECK (vehicle_type IN ('standard', 'premium', 'executive', 'luxury')),
    CONSTRAINT vehicles_status_check CHECK (status IN ('active', 'pending_approval', 'suspended', 'deactivated', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_vehicle_driver ON vehicles(driver_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_registration ON vehicles(registration_number);
CREATE INDEX IF NOT EXISTS idx_vehicle_status ON vehicles(status);

-- Driver Risk Insurance table
CREATE TABLE IF NOT EXISTS driver_risk_insurance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES driver_profiles(id) ON DELETE RESTRICT,
    provider VARCHAR(100) NOT NULL,
    policy_number VARCHAR(100) NOT NULL,
    coverage_amount NUMERIC NOT NULL,
    coverage_type VARCHAR(50) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    document_url VARCHAR(500),
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT driver_risk_insurance_coverage_type_check CHECK (coverage_type IN ('comprehensive', 'third_party', 'accident_only', 'liability')),
    CONSTRAINT driver_risk_insurance_status_check CHECK (status IN ('pending', 'active', 'expired', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_driver_insurance_driver ON driver_risk_insurance(driver_id);

-- Driver Suspensions table
CREATE TABLE IF NOT EXISTS driver_suspensions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES driver_profiles(id) ON DELETE RESTRICT,
    reason VARCHAR(100) NOT NULL,
    violation_id UUID REFERENCES cash_violations(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'suspended',
    suspended_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reinstated_at TIMESTAMPTZ,
    suspended_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reinstated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT driver_suspensions_status_check CHECK (status IN ('suspended', 'reinstated'))
);

CREATE INDEX IF NOT EXISTS idx_driver_suspensions_driver ON driver_suspensions(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_suspensions_status ON driver_suspensions(status);

-- ============================================
-- RIDE MARKETPLACE MODULE
-- ============================================

-- Ride Requests table
CREATE TABLE IF NOT EXISTS ride_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    passenger_id UUID NOT NULL REFERENCES passenger_profiles(id) ON DELETE RESTRICT,
    pickup_latitude NUMERIC NOT NULL,
    pickup_longitude NUMERIC NOT NULL,
    pickup_address TEXT NOT NULL,
    destination_latitude NUMERIC NOT NULL,
    destination_longitude NUMERIC NOT NULL,
    destination_address TEXT NOT NULL,
    vehicle_type VARCHAR(20) DEFAULT 'standard',
    estimated_distance_km NUMERIC,
    estimated_duration_min INTEGER,
    estimated_fare NUMERIC,
    status VARCHAR(20) DEFAULT 'pending',
    bidding_started_at TIMESTAMPTZ,
    bidding_ends_at TIMESTAMPTZ,
    bidding_duration_seconds INTEGER DEFAULT 30,
    selected_driver_id UUID REFERENCES driver_profiles(id) ON DELETE SET NULL,
    selected_bid_id UUID REFERENCES ride_bids(id) ON DELETE SET NULL,
    cancelled_by VARCHAR(20),
    cancelled_at TIMESTAMP,
    cancellation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    timezone_id VARCHAR(50) DEFAULT 'Africa/Lagos',
    CONSTRAINT ride_requests_vehicle_type_check CHECK (vehicle_type IN ('standard', 'premium', 'executive')),
    CONSTRAINT ride_requests_status_check CHECK (status IN ('pending', 'bidding', 'assigned', 'expired', 'cancelled')),
    CONSTRAINT ride_requests_cancelled_by_check CHECK (cancelled_by IN ('passenger', 'driver', 'system'))
);

CREATE INDEX IF NOT EXISTS idx_ride_requests_bidding_ends ON ride_requests(bidding_ends_at) WHERE status = 'bidding';
CREATE INDEX IF NOT EXISTS idx_ride_requests_created ON ride_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_ride_requests_passenger ON ride_requests(passenger_id);
CREATE INDEX IF NOT EXISTS idx_ride_requests_passenger_status ON ride_requests(passenger_id, status);
CREATE INDEX IF NOT EXISTS idx_ride_requests_status ON ride_requests(status);

-- Ride Bids table
CREATE TABLE IF NOT EXISTS ride_bids (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID NOT NULL REFERENCES ride_requests(id) ON DELETE RESTRICT,
    driver_id UUID NOT NULL REFERENCES driver_profiles(id) ON DELETE RESTRICT,
    bid_amount NUMERIC NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    driver_notes TEXT,
    submitted_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    eta_minutes INTEGER,
    rank INTEGER,
    selected_at TIMESTAMP,
    CONSTRAINT ride_bids_bid_amount_check CHECK (bid_amount >= 0),
    CONSTRAINT ride_bids_status_check CHECK (status IN ('pending', 'accepted', 'rejected', 'expired', 'cancelled')),
    CONSTRAINT ride_bids_ride_id_driver_id_key UNIQUE (ride_id, driver_id)
);

CREATE INDEX IF NOT EXISTS idx_bid_created ON ride_bids(created_at);
CREATE INDEX IF NOT EXISTS idx_bid_driver ON ride_bids(driver_id);
CREATE INDEX IF NOT EXISTS idx_bid_ride ON ride_bids(ride_id);
CREATE INDEX IF NOT EXISTS idx_bid_ride_status ON ride_bids(ride_id, status);
CREATE INDEX IF NOT EXISTS idx_bid_status ON ride_bids(status);

-- Rides table
CREATE TABLE IF NOT EXISTS rides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    passenger_id UUID NOT NULL REFERENCES passenger_profiles(id) ON DELETE RESTRICT,
    driver_id UUID REFERENCES driver_profiles(id) ON DELETE SET NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'requested',
    pickup_latitude NUMERIC NOT NULL,
    pickup_longitude NUMERIC NOT NULL,
    pickup_address TEXT,
    destination_latitude NUMERIC NOT NULL,
    destination_longitude NUMERIC NOT NULL,
    destination_address TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL,
    final_distance_km NUMERIC,
    duration_minutes INTEGER,
    bid_id UUID REFERENCES ride_bids(id) ON DELETE SET NULL,
    bid_amount NUMERIC,
    driver_arrived_at TIMESTAMPTZ,
    dispute_initiated_at TIMESTAMP,
    dispute_resolved_at TIMESTAMP,
    dispute_outcome TEXT,
    estimated_fare NUMERIC,
    surge_multiplier NUMERIC DEFAULT 1.00,
    timezone_id VARCHAR(50) DEFAULT 'Africa/Lagos',
    programme_period_id UUID REFERENCES programme_periods(id) ON DELETE SET NULL,
    ride_eligible_for_qualification BOOLEAN DEFAULT TRUE,
    qualification_exclusion_reason TEXT,
    fraud_review_status VARCHAR(20) DEFAULT 'clean',
    rebate_contribution_amount NUMERIC DEFAULT 0.00,
    rebate_credit_used_amount NUMERIC DEFAULT 0.00,
    CONSTRAINT rides_status_check CHECK (status IN ('requested', 'confirmed', 'driver_en_route', 'driver_arrived', 'ride_started', 'ride_in_progress', 'ride_completed', 'cancelled', 'failed', 'disputed', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_ride_created ON rides(created_at);
CREATE INDEX IF NOT EXISTS idx_ride_driver ON rides(driver_id);
CREATE INDEX IF NOT EXISTS idx_ride_driver_status ON rides(driver_id, status);
CREATE INDEX IF NOT EXISTS idx_ride_passenger ON rides(passenger_id);
CREATE INDEX IF NOT EXISTS idx_ride_passenger_status ON rides(passenger_id, status);
CREATE INDEX IF NOT EXISTS idx_ride_requested ON rides(requested_at);
CREATE INDEX IF NOT EXISTS idx_ride_status ON rides(status);
CREATE INDEX IF NOT EXISTS idx_rides_programme_period ON rides(programme_period_id);
CREATE INDEX IF NOT EXISTS idx_rides_eligible ON rides(ride_eligible_for_qualification);
CREATE INDEX IF NOT EXISTS idx_rides_fraud_status ON rides(fraud_review_status);

-- Ride Cancellations table
CREATE TABLE IF NOT EXISTS ride_cancellations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE RESTRICT,
    cancelled_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reason_code VARCHAR(50) NOT NULL,
    reason_text TEXT,
    fee_applied NUMERIC DEFAULT 0.00,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Ride Locations table
CREATE TABLE IF NOT EXISTS ride_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE RESTRICT,
    driver_id UUID REFERENCES driver_profiles(id) ON DELETE SET NULL,
    latitude NUMERIC NOT NULL,
    longitude NUMERIC NOT NULL,
    speed_kmh NUMERIC,
    heading INTEGER,
    accuracy_meters NUMERIC,
    recorded_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rideloc_created ON ride_locations(recorded_at);
CREATE INDEX IF NOT EXISTS idx_rideloc_ride ON ride_locations(ride_id);

-- Ride Status History table
CREATE TABLE IF NOT EXISTS ride_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL,
    latitude NUMERIC,
    longitude NUMERIC,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ride_status_history_created ON ride_status_history(created_at);
CREATE INDEX IF NOT EXISTS idx_ride_status_history_ride ON ride_status_history(ride_id);

-- GPS Tracking table
CREATE TABLE IF NOT EXISTS gps_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE RESTRICT,
    driver_id UUID NOT NULL REFERENCES driver_profiles(id) ON DELETE RESTRICT,
    latitude NUMERIC NOT NULL,
    longitude NUMERIC NOT NULL,
    heading INTEGER,
    speed_kmh NUMERIC,
    accuracy_meters NUMERIC,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gps_tracking_created ON gps_tracking(created_at);
CREATE INDEX IF NOT EXISTS idx_gps_tracking_driver ON gps_tracking(driver_id);
CREATE INDEX IF NOT EXISTS idx_gps_tracking_ride ON gps_tracking(ride_id);

-- ============================================
-- PAYMENT & WALLET MODULE
-- ============================================

-- Wallets table
CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
    currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
    balance NUMERIC NOT NULL DEFAULT 0.00,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    frozen_at TIMESTAMP,
    frozen_reason TEXT,
    virtual_account_number VARCHAR(20) UNIQUE,
    virtual_account_bank VARCHAR(100),
    virtual_account_name VARCHAR(255),
    deposited_balance NUMERIC NOT NULL DEFAULT 0.00,
    rebate_credit_balance NUMERIC NOT NULL DEFAULT 0.00,
    promotional_balance NUMERIC NOT NULL DEFAULT 0.00,
    CONSTRAINT wallets_balance_check CHECK (balance >= 0),
    CONSTRAINT wallets_status_check CHECK (status IN ('active', 'frozen', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_wallet_status ON wallets(status);
CREATE INDEX IF NOT EXISTS idx_wallet_user ON wallets(user_id);

-- Wallet Transactions table
CREATE TABLE IF NOT EXISTS wallet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    transaction_type VARCHAR(50) NOT NULL,
    amount NUMERIC NOT NULL,
    balance_before NUMERIC NOT NULL,
    balance_after NUMERIC NOT NULL,
    reference_type VARCHAR(50),
    reference_id UUID,
    description TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    metadata JSONB,
    completed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    reversed_at TIMESTAMP,
    CONSTRAINT wallet_transactions_transaction_type_check CHECK (transaction_type IN ('top_up', 'payment', 'refund', 'commission', 'withdrawal', 'adjustment', 'bonus')),
    CONSTRAINT wallet_transactions_status_check CHECK (status IN ('pending', 'completed', 'failed', 'reversed')),
    CONSTRAINT wallet_transactions_amount_check CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_wallettxn_created ON wallet_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_wallettxn_status ON wallet_transactions(status);
CREATE INDEX IF NOT EXISTS idx_wallettxn_type ON wallet_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_wallettxn_wallet ON wallet_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallettxn_wallet_created ON wallet_transactions(wallet_id, created_at);

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID REFERENCES rides(id) ON DELETE SET NULL,
    passenger_id UUID NOT NULL REFERENCES passenger_profiles(id) ON DELETE RESTRICT,
    driver_id UUID REFERENCES driver_profiles(id) ON DELETE SET NULL,
    amount NUMERIC NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
    payment_method VARCHAR(30) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    gateway_reference VARCHAR(255) UNIQUE,
    gateway_response JSONB,
    authorised_at TIMESTAMP,
    captured_at TIMESTAMP,
    paid_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    commission_amount NUMERIC,
    commission_rate NUMERIC,
    driver_earnings NUMERIC,
    processed_at TIMESTAMP,
    settled_at TIMESTAMP,
    payment_type VARCHAR(30) DEFAULT 'ride',
    CONSTRAINT payments_status_check CHECK (status IN ('pending', 'authorised', 'captured', 'paid', 'failed', 'refunded', 'partially_refunded', 'cancelled')),
    CONSTRAINT payments_payment_method_check CHECK (payment_method IN ('card', 'bank_transfer', 'wallet', 'cash', 'promo_code')),
    CONSTRAINT payments_payment_type_check CHECK (payment_type IN ('ride', 'top_up', 'withdrawal', 'refund'))
);

CREATE INDEX IF NOT EXISTS idx_payment_created ON payments(created_at);
CREATE INDEX IF NOT EXISTS idx_payment_driver ON payments(driver_id);
CREATE INDEX IF NOT EXISTS idx_payment_gateway ON payments(gateway_reference);
CREATE INDEX IF NOT EXISTS idx_payment_passenger ON payments(passenger_id);
CREATE INDEX IF NOT EXISTS idx_payment_ride ON payments(ride_id);
CREATE INDEX IF NOT EXISTS idx_payment_status ON payments(status);

-- Payment Authorisations table
CREATE TABLE IF NOT EXISTS payment_authorisations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE RESTRICT,
    passenger_id UUID NOT NULL REFERENCES passenger_profiles(id) ON DELETE RESTRICT,
    amount NUMERIC NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    gateway_reference VARCHAR(100),
    status VARCHAR(20) DEFAULT 'pending',
    authorised_at TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT payment_authorisations_payment_method_check CHECK (payment_method IN ('card', 'bank_transfer', 'wallet', 'cash')),
    CONSTRAINT payment_authorisations_status_check CHECK (status IN ('pending', 'authorised', 'captured', 'failed', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_payment_auth_gateway ON payment_authorisations(gateway_reference);
CREATE INDEX IF NOT EXISTS idx_payment_auth_ride ON payment_authorisations(ride_id);

-- Refunds table
CREATE TABLE IF NOT EXISTS refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
    ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE RESTRICT,
    passenger_id UUID NOT NULL REFERENCES passenger_profiles(id) ON DELETE RESTRICT,
    refund_amount NUMERIC NOT NULL,
    reason VARCHAR(100) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    gateway_reference VARCHAR(100),
    initiated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    processed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT refunds_status_check CHECK (status IN ('pending', 'processed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_refunds_ride ON refunds(ride_id);
CREATE INDEX IF NOT EXISTS idx_refunds_transaction ON refunds(transaction_id);

-- Withdrawals table
CREATE TABLE IF NOT EXISTS withdrawals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES driver_profiles(id) ON DELETE RESTRICT,
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    amount NUMERIC NOT NULL,
    method VARCHAR(50) NOT NULL,
    account_name VARCHAR(100) NOT NULL,
    account_number VARCHAR(50) NOT NULL,
    bank_name VARCHAR(100),
    status VARCHAR(20) DEFAULT 'pending',
    reference VARCHAR(100),
    processed_at TIMESTAMP,
    completed_at TIMESTAMP,
    failure_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT withdrawals_method_check CHECK (method IN ('bank_transfer', 'mobile_money', 'cash')),
    CONSTRAINT withdrawals_status_check CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_driver ON withdrawals(driver_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);

-- Settlements table
CREATE TABLE IF NOT EXISTS settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES driver_profiles(id) ON DELETE RESTRICT,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    total_earnings NUMERIC NOT NULL,
    total_commission NUMERIC NOT NULL,
    net_payout NUMERIC NOT NULL,
    payout_method VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    reference VARCHAR(100),
    processed_at TIMESTAMP,
    paid_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT settlements_payout_method_check CHECK (payout_method IN ('bank_transfer', 'mobile_money', 'wallet')),
    CONSTRAINT settlements_status_check CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_settlements_driver ON settlements(driver_id);
CREATE INDEX IF NOT EXISTS idx_settlements_status ON settlements(status);

-- Fare Calculations table
CREATE TABLE IF NOT EXISTS fare_calculations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID NOT NULL UNIQUE REFERENCES rides(id) ON DELETE RESTRICT,
    estimated_distance_km NUMERIC,
    estimated_duration_min INTEGER,
    base_fare NUMERIC,
    bid_amount NUMERIC,
    final_fare NUMERIC NOT NULL,
    commission_amount NUMERIC NOT NULL DEFAULT 0.00,
    commission_rate NUMERIC DEFAULT 15.00,
    driver_earnings NUMERIC NOT NULL DEFAULT 0.00,
    currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
    calculated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Fare Estimates table
CREATE TABLE IF NOT EXISTS fare_estimates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    passenger_id UUID NOT NULL REFERENCES passenger_profiles(id) ON DELETE RESTRICT,
    pickup_latitude NUMERIC NOT NULL,
    pickup_longitude NUMERIC NOT NULL,
    destination_latitude NUMERIC NOT NULL,
    destination_longitude NUMERIC NOT NULL,
    estimated_fare NUMERIC NOT NULL,
    estimated_distance_km NUMERIC,
    estimated_duration_min INTEGER,
    requested_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fare_estimates_passenger ON fare_estimates(passenger_id);
CREATE INDEX IF NOT EXISTS idx_fare_estimates_requested ON fare_estimates(requested_at);

-- ============================================
-- RATINGS & TRUST
-- ============================================

-- Ratings table
CREATE TABLE IF NOT EXISTS ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID NOT NULL UNIQUE REFERENCES rides(id) ON DELETE RESTRICT,
    rater_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    rated_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    rating INTEGER NOT NULL,
    comment TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT ratings_rating_check CHECK (rating BETWEEN 1 AND 5),
    CONSTRAINT ratings_ride_id_rater_id_rated_user_id_key UNIQUE (ride_id, rater_id, rated_user_id)
);

CREATE INDEX IF NOT EXISTS idx_rating_created ON ratings(created_at);
CREATE INDEX IF NOT EXISTS idx_rating_rated ON ratings(rated_user_id);
CREATE INDEX IF NOT EXISTS idx_rating_rater ON ratings(rater_id);
CREATE INDEX IF NOT EXISTS idx_rating_ride ON ratings(ride_id);

-- ============================================
-- DISPUTES & INCIDENTS
-- ============================================

-- Disputes table
CREATE TABLE IF NOT EXISTS disputes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID REFERENCES rides(id) ON DELETE SET NULL,
    payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    category VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'open',
    evidence_urls JSONB,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    resolution TEXT,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT disputes_category_check CHECK (category IN ('payment', 'ride_quality', 'driver_behavior', 'passenger_behavior', 'cancellation', 'other')),
    CONSTRAINT disputes_status_check CHECK (status IN ('open', 'under_review', 'resolved', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_dispute_created ON disputes(created_at);
CREATE INDEX IF NOT EXISTS idx_dispute_ride ON disputes(ride_id);
CREATE INDEX IF NOT EXISTS idx_dispute_status ON disputes(status);
CREATE INDEX IF NOT EXISTS idx_dispute_user ON disputes(user_id);

-- Incidents table
CREATE TABLE IF NOT EXISTS incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID REFERENCES rides(id) ON DELETE SET NULL,
    reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reporter_type VARCHAR(20) NOT NULL,
    incident_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    description TEXT NOT NULL,
    evidence_urls JSONB,
    status VARCHAR(20) DEFAULT 'reported',
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    resolution TEXT,
    reported_at TIMESTAMP NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT incidents_reporter_type_check CHECK (reporter_type IN ('passenger', 'driver', 'admin')),
    CONSTRAINT incidents_incident_type_check CHECK (incident_type IN ('accident', 'harassment', 'theft', 'misconduct', 'vehicle_issue', 'other')),
    CONSTRAINT incidents_severity_check CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    CONSTRAINT incidents_status_check CHECK (status IN ('reported', 'under_review', 'resolved', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_incidents_reporter ON incidents(reporter_id);
CREATE INDEX IF NOT EXISTS idx_incidents_ride ON incidents(ride_id);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);

-- SOS Events table
CREATE TABLE IF NOT EXISTS sos_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    user_type VARCHAR(20) NOT NULL,
    ride_id UUID REFERENCES rides(id) ON DELETE SET NULL,
    latitude NUMERIC NOT NULL,
    longitude NUMERIC NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    escalated_to JSONB,
    response_notes TEXT,
    resolved_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT sos_events_user_type_check CHECK (user_type IN ('passenger', 'driver')),
    CONSTRAINT sos_events_status_check CHECK (status IN ('active', 'resolved', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS idx_sos_ride ON sos_events(ride_id);
CREATE INDEX IF NOT EXISTS idx_sos_user ON sos_events(user_id);

-- ============================================
-- NOTIFICATIONS MODULE
-- ============================================

-- Notification Templates table
CREATE TABLE IF NOT EXISTS notification_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    category VARCHAR(50) NOT NULL,
    type VARCHAR(50) NOT NULL,
    title_template VARCHAR(255),
    body_template TEXT NOT NULL,
    variables JSONB,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT notification_templates_type_check CHECK (type IN ('push', 'sms', 'email', 'in_app'))
);

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    channel VARCHAR(30) NOT NULL,
    title VARCHAR(255),
    body TEXT NOT NULL,
    data JSONB,
    action_url VARCHAR(500),
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    external_reference VARCHAR(255),
    sent_at TIMESTAMP,
    delivered_at TIMESTAMP,
    read_at TIMESTAMP,
    failed_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT notifications_type_check CHECK (type IN ('ride_update', 'payment', 'promotion', 'system', 'security')),
    CONSTRAINT notifications_channel_check CHECK (channel IN ('push', 'sms', 'email', 'in_app')),
    CONSTRAINT notifications_status_check CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_notification_created ON notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_notification_status ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_notification_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_user_status ON notifications(user_id, status);

-- ============================================
-- PROMOTIONS MODULE
-- ============================================

-- Promotions table
CREATE TABLE IF NOT EXISTS promotions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    discount_type VARCHAR(30) NOT NULL,
    discount_value NUMERIC NOT NULL,
    max_discount NUMERIC,
    min_ride_amount NUMERIC,
    start_date TIMESTAMP NOT NULL,
    end_date TIMESTAMP NOT NULL,
    usage_limit INTEGER,
    usage_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT promotions_discount_type_check CHECK (discount_type IN ('percentage', 'fixed_amount', 'free_ride'))
);

CREATE INDEX IF NOT EXISTS idx_promotions_code ON promotions(code);
CREATE INDEX IF NOT EXISTS idx_promotions_dates ON promotions(start_date, end_date);

-- Promotion Usage table
CREATE TABLE IF NOT EXISTS promotion_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    promotion_id UUID NOT NULL REFERENCES promotions(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    ride_id UUID REFERENCES rides(id) ON DELETE SET NULL,
    discount_amount NUMERIC NOT NULL,
    used_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promotion_usage_promotion ON promotion_usage(promotion_id);
CREATE INDEX IF NOT EXISTS idx_promotion_usage_user ON promotion_usage(user_id);

-- ============================================
-- SUPPORT & AUDIT
-- ============================================

-- Support Tickets table
CREATE TABLE IF NOT EXISTS support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    ride_id UUID REFERENCES rides(id) ON DELETE SET NULL,
    category VARCHAR(50) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'open',
    priority VARCHAR(30) NOT NULL DEFAULT 'medium',
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    resolution TEXT,
    resolved_at TIMESTAMP,
    closed_at TIMESTAMP,
    satisfaction_rating INTEGER,
    attachments JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT support_tickets_category_check CHECK (category IN ('ride_issue', 'payment_issue', 'account_issue', 'driver_issue', 'passenger_issue', 'other')),
    CONSTRAINT support_tickets_status_check CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    CONSTRAINT support_tickets_priority_check CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    CONSTRAINT support_tickets_satisfaction_rating_check CHECK (satisfaction_rating BETWEEN 1 AND 5)
);

CREATE INDEX IF NOT EXISTS idx_ticket_created ON support_tickets(created_at);
CREATE INDEX IF NOT EXISTS idx_ticket_priority ON support_tickets(priority);
CREATE INDEX IF NOT EXISTS idx_ticket_ride ON support_tickets(ride_id);
CREATE INDEX IF NOT EXISTS idx_ticket_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_ticket_user ON support_tickets(user_id);

-- Audit Logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'success',
    failure_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT audit_logs_status_check CHECK (status IN ('success', 'failure'))
);

CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);

-- ============================================
-- DAILY RESERVATIONS MODULE
-- ============================================

-- Daily Reservations table
CREATE TABLE IF NOT EXISTS daily_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    passenger_id UUID NOT NULL REFERENCES passenger_profiles(id) ON DELETE RESTRICT,
    driver_id UUID REFERENCES driver_profiles(id) ON DELETE SET NULL,
    reservation_date DATE NOT NULL,
    pickup_time TIME NOT NULL,
    pickup_location TEXT NOT NULL,
    pickup_latitude NUMERIC NOT NULL,
    pickup_longitude NUMERIC NOT NULL,
    trip_type VARCHAR(20) NOT NULL,
    destination_state VARCHAR(100),
    estimated_end_time TIME NOT NULL,
    vehicle_tier VARCHAR(20) DEFAULT 'standard',
    estimated_distance_km NUMERIC,
    estimated_duration_hrs NUMERIC,
    base_fee NUMERIC NOT NULL,
    fuel_estimate NUMERIC NOT NULL,
    total_fare_estimate NUMERIC NOT NULL,
    security_deposit NUMERIC DEFAULT 0.00,
    final_fare NUMERIC,
    actual_distance_km NUMERIC,
    actual_duration_hrs NUMERIC,
    status VARCHAR(20) DEFAULT 'pending',
    payment_status VARCHAR(20) DEFAULT 'unpaid',
    passenger_trust_score NUMERIC,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT daily_reservations_trip_type_check CHECK (trip_type IN ('one_way', 'round_trip', 'hourly', 'interstate')),
    CONSTRAINT daily_reservations_vehicle_tier_check CHECK (vehicle_tier IN ('standard', 'premium', 'executive')),
    CONSTRAINT daily_reservations_status_check CHECK (status IN ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled')),
    CONSTRAINT daily_reservations_payment_status_check CHECK (payment_status IN ('unpaid', 'partial', 'paid', 'refunded'))
);

CREATE INDEX IF NOT EXISTS idx_daily_res_date ON daily_reservations(reservation_date);
CREATE INDEX IF NOT EXISTS idx_daily_res_driver ON daily_reservations(driver_id);
CREATE INDEX IF NOT EXISTS idx_daily_res_passenger ON daily_reservations(passenger_id);

-- Daily Reservation Bids table
CREATE TABLE IF NOT EXISTS daily_reservation_bids (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_id UUID NOT NULL REFERENCES daily_reservations(id) ON DELETE RESTRICT,
    driver_id UUID NOT NULL REFERENCES driver_profiles(id) ON DELETE RESTRICT,
    bid_amount NUMERIC NOT NULL,
    driver_notes TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT daily_reservation_bids_status_check CHECK (status IN ('pending', 'accepted', 'rejected', 'expired', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_daily_res_bids_driver ON daily_reservation_bids(driver_id);
CREATE INDEX IF NOT EXISTS idx_daily_res_bids_reservation ON daily_reservation_bids(reservation_id);

-- Daily Reservation Stops table
CREATE TABLE IF NOT EXISTS daily_reservation_stops (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_id UUID NOT NULL REFERENCES daily_reservations(id) ON DELETE RESTRICT,
    stop_order INTEGER NOT NULL,
    address TEXT NOT NULL,
    latitude NUMERIC NOT NULL,
    longitude NUMERIC NOT NULL,
    stop_type VARCHAR(20) NOT NULL,
    planned_duration_minutes INTEGER,
    actual_arrival_time TIMESTAMP,
    actual_departure_time TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT daily_reservation_stops_stop_type_check CHECK (stop_type IN ('pickup', 'dropoff', 'rest_stop', 'fuel_stop'))
);

CREATE INDEX IF NOT EXISTS idx_daily_res_stops_reservation ON daily_reservation_stops(reservation_id);

-- ============================================
-- CASH VIOLATIONS MODULE
-- ============================================

-- Cash Violations table
CREATE TABLE IF NOT EXISTS cash_violations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE RESTRICT,
    passenger_id UUID NOT NULL REFERENCES passenger_profiles(id) ON DELETE RESTRICT,
    driver_id UUID NOT NULL REFERENCES driver_profiles(id) ON DELETE RESTRICT,
    fare_amount NUMERIC NOT NULL,
    commission_amount NUMERIC NOT NULL,
    passenger_deducted BOOLEAN DEFAULT FALSE,
    driver_suspended BOOLEAN DEFAULT TRUE,
    driver_reinstated BOOLEAN DEFAULT FALSE,
    driver_payment_confirmed BOOLEAN DEFAULT FALSE,
    violation_count INTEGER DEFAULT 1,
    penalty_level VARCHAR(20) DEFAULT 'first',
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT cash_violations_penalty_level_check CHECK (penalty_level IN ('first', 'second', 'third', 'permanent'))
);

CREATE INDEX IF NOT EXISTS idx_cash_violations_driver ON cash_violations(driver_id);
CREATE INDEX IF NOT EXISTS idx_cash_violations_ride ON cash_violations(ride_id);
CREATE INDEX IF NOT EXISTS idx_cash_violations_status ON cash_violations(driver_suspended, driver_reinstated);

-- ============================================
-- VIRTUAL ACCOUNTS MODULE
-- ============================================

-- Virtual Accounts table
CREATE TABLE IF NOT EXISTS virtual_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    provider VARCHAR(50) NOT NULL,
    provider_account_id VARCHAR(100) NOT NULL,
    account_number VARCHAR(20) NOT NULL,
    bank_name VARCHAR(100) NOT NULL,
    account_name VARCHAR(200) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'closed')),
    kyc_verified BOOLEAN DEFAULT FALSE,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, provider),
    UNIQUE(provider_account_id)
);

CREATE INDEX IF NOT EXISTS idx_virtual_accounts_user_id ON virtual_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_virtual_accounts_account_number ON virtual_accounts(account_number);
CREATE INDEX IF NOT EXISTS idx_virtual_accounts_provider ON virtual_accounts(provider);
CREATE INDEX IF NOT EXISTS idx_virtual_accounts_status ON virtual_accounts(status);

-- ============================================
-- BANK TRANSFER EVENTS MODULE
-- ============================================

-- Bank Transfer Events table
CREATE TABLE IF NOT EXISTS bank_transfer_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    virtual_account_id UUID REFERENCES virtual_accounts(id),
    user_id UUID NOT NULL REFERENCES users(id),
    provider_transaction_id VARCHAR(100) NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    sender_name VARCHAR(200),
    sender_account_number VARCHAR(20),
    sender_bank VARCHAR(100),
    narration TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'credited', 'failed', 'reversed')),
    idempotency_key VARCHAR(100) UNIQUE,
    credited_to_wallet BOOLEAN DEFAULT FALSE,
    wallet_transaction_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_transfer_events_user_id ON bank_transfer_events(user_id);
CREATE INDEX IF NOT EXISTS idx_bank_transfer_events_provider_ref ON bank_transfer_events(provider_transaction_id);
CREATE INDEX IF NOT EXISTS idx_bank_transfer_events_status ON bank_transfer_events(status);
CREATE INDEX IF NOT EXISTS idx_bank_transfer_events_account ON bank_transfer_events(virtual_account_id);
CREATE INDEX IF NOT EXISTS idx_bank_transfer_events_idempotency ON bank_transfer_events(idempotency_key);

-- ============================================
-- UNMATCHED TRANSFERS MODULE
-- ============================================

-- Unmatched Transfers table
CREATE TABLE IF NOT EXISTS unmatched_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(50) NOT NULL,
    provider_transaction_id VARCHAR(100) NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    account_number VARCHAR(20) NOT NULL,
    payload JSONB,
    reason VARCHAR(200),
    resolved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_unmatched_transfers_account ON unmatched_transfers(account_number);
CREATE INDEX IF NOT EXISTS idx_unmatched_transfers_resolved ON unmatched_transfers(resolved);
CREATE INDEX IF NOT EXISTS idx_unmatched_transfers_created ON unmatched_transfers(created_at);

-- ============================================
-- FRAUD CASES MODULE
-- ============================================

-- Fraud Cases table
CREATE TABLE IF NOT EXISTS fraud_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    case_type VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    evidence JSONB,
    severity VARCHAR(20) NOT NULL,
    status VARCHAR(20) DEFAULT 'detected',
    detected_at TIMESTAMP NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMP,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolution_notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT fraud_cases_case_type_check CHECK (case_type IN ('collusion', 'ghost_ride', 'gps_spoofing', 'payment_fraud', 'account_abuse', 'other')),
    CONSTRAINT fraud_cases_severity_check CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    CONSTRAINT fraud_cases_status_check CHECK (status IN ('detected', 'investigating', 'confirmed', 'dismissed', 'resolved'))
);

CREATE INDEX IF NOT EXISTS idx_fraud_status ON fraud_cases(status);
CREATE INDEX IF NOT EXISTS idx_fraud_user ON fraud_cases(user_id);

-- ============================================
-- DAILY METRICS MODULE
-- ============================================

-- Daily Metrics table
CREATE TABLE IF NOT EXISTS daily_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL UNIQUE,
    total_passengers INTEGER DEFAULT 0,
    total_drivers INTEGER DEFAULT 0,
    total_rides INTEGER DEFAULT 0,
    total_revenue NUMERIC DEFAULT 0.00,
    total_commission NUMERIC DEFAULT 0.00,
    avg_ride_time_minutes NUMERIC,
    avg_ride_distance_km NUMERIC,
    avg_fare_amount NUMERIC,
    avg_driver_rating NUMERIC,
    avg_passenger_rating NUMERIC,
    ride_completion_rate NUMERIC,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_metrics_date ON daily_metrics(date);

-- ============================================
-- PLATFORM CONFIGURATION
-- ============================================

-- Platform Configuration table
CREATE TABLE IF NOT EXISTS platform_configuration (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(100) NOT NULL UNIQUE,
    value JSONB NOT NULL,
    category VARCHAR(50) NOT NULL,
    description TEXT,
    is_editable BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_config_category ON platform_configuration(category);
CREATE INDEX IF NOT EXISTS idx_config_key ON platform_configuration(key);

-- ============================================
-- V2.0 INCENTIVE ECOSYSTEM - PROGRAMME PERIODS
-- ============================================

-- Programme Periods table
CREATE TABLE IF NOT EXISTS programme_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    year INTEGER NOT NULL,
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,
    passenger_threshold NUMERIC DEFAULT 500000.00,
    driver_threshold NUMERIC DEFAULT 15000000.00,
    winner_cap_percentage NUMERIC DEFAULT 1.00,
    individual_reward_cap NUMERIC,
    rebate_contribution_rate NUMERIC DEFAULT 1.00,
    profit_pool_percentage NUMERIC DEFAULT 1.00,
    status VARCHAR(20) DEFAULT 'draft',
    active_passenger_count INTEGER DEFAULT 0,
    active_driver_count INTEGER DEFAULT 0,
    opened_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT programme_periods_status_check CHECK (status IN ('draft', 'active', 'closed', 'archived')),
    CONSTRAINT programme_periods_year_key UNIQUE (year)
);

CREATE INDEX IF NOT EXISTS idx_programme_periods_status ON programme_periods(status);
CREATE INDEX IF NOT EXISTS idx_programme_periods_dates ON programme_periods(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_programme_periods_year ON programme_periods(year);

-- ============================================
-- V2.0 INCENTIVE ECOSYSTEM - PASSENGER QUALIFICATION
-- ============================================

-- Passenger Qualification Registry table
CREATE TABLE IF NOT EXISTS passenger_qualification_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    passenger_id UUID NOT NULL REFERENCES passenger_profiles(id) ON DELETE RESTRICT,
    programme_period_id UUID NOT NULL REFERENCES programme_periods(id) ON DELETE RESTRICT,
    eligible_annual_spend NUMERIC NOT NULL DEFAULT 0.00,
    qualification_status VARCHAR(20) DEFAULT 'not_started',
    qualification_date TIMESTAMPTZ,
    rank_position INTEGER,
    winner_selected BOOLEAN DEFAULT FALSE,
    rebate_allocated NUMERIC DEFAULT 0.00,
    rebate_credited BOOLEAN DEFAULT FALSE,
    fraud_review_status VARCHAR(20) DEFAULT 'clean',
    fraud_review_notes TEXT,
    last_progress_update TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT passenger_qualification_registry_status_check CHECK (qualification_status IN ('not_started', 'in_progress', 'qualified', 'excluded')),
    CONSTRAINT passenger_qualification_registry_fraud_status_check CHECK (fraud_review_status IN ('clean', 'under_review', 'excluded')),
    CONSTRAINT passenger_qualification_registry_passenger_period_key UNIQUE (passenger_id, programme_period_id)
);

CREATE INDEX IF NOT EXISTS idx_passenger_qual_period ON passenger_qualification_registry(programme_period_id);
CREATE INDEX IF NOT EXISTS idx_passenger_qual_status ON passenger_qualification_registry(qualification_status);
CREATE INDEX IF NOT EXISTS idx_passenger_qual_passenger ON passenger_qualification_registry(passenger_id);
CREATE INDEX IF NOT EXISTS idx_passenger_qual_fraud ON passenger_qualification_registry(fraud_review_status);

-- Passenger Qualification Progress table (PINGRIDE letters)
CREATE TABLE IF NOT EXISTS passenger_qualification_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    passenger_id UUID NOT NULL REFERENCES passenger_profiles(id) ON DELETE RESTRICT,
    programme_period_id UUID NOT NULL REFERENCES programme_periods(id) ON DELETE RESTRICT,
    letter_position INTEGER NOT NULL,
    letter_char CHAR(1) NOT NULL,
    is_completed BOOLEAN DEFAULT FALSE,
    progress_percentage NUMERIC DEFAULT 0.00,
    cumulative_spend_at_milestone NUMERIC DEFAULT 0.00,
    achieved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT passenger_qualification_progress_letter_position_check CHECK (letter_position BETWEEN 1 AND 8),
    CONSTRAINT passenger_qualification_progress_letter_char_check CHECK (letter_char IN ('P', 'I', 'N', 'G', 'R', 'D', 'E')),
    CONSTRAINT passenger_qualification_progress_passenger_period_letter_key UNIQUE (passenger_id, programme_period_id, letter_position)
);

CREATE INDEX IF NOT EXISTS idx_passenger_progress_passenger ON passenger_qualification_progress(passenger_id);
CREATE INDEX IF NOT EXISTS idx_passenger_progress_period ON passenger_qualification_progress(programme_period_id);

-- ============================================
-- V2.0 INCENTIVE ECOSYSTEM - DRIVER QUALIFICATION
-- ============================================

-- Driver Qualification Registry table
CREATE TABLE IF NOT EXISTS driver_qualification_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES driver_profiles(id) ON DELETE RESTRICT,
    programme_period_id UUID NOT NULL REFERENCES programme_periods(id) ON DELETE RESTRICT,
    qualifying_contribution NUMERIC NOT NULL DEFAULT 0.00,
    qualification_status VARCHAR(20) DEFAULT 'not_started',
    qualification_date TIMESTAMPTZ,
    rank_position INTEGER,
    winner_selected BOOLEAN DEFAULT FALSE,
    profit_share_allocated NUMERIC DEFAULT 0.00,
    profit_share_paid BOOLEAN DEFAULT FALSE,
    fraud_review_status VARCHAR(20) DEFAULT 'clean',
    fraud_review_notes TEXT,
    last_progress_update TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT driver_qualification_registry_status_check CHECK (qualification_status IN ('not_started', 'in_progress', 'qualified', 'excluded')),
    CONSTRAINT driver_qualification_registry_fraud_status_check CHECK (fraud_review_status IN ('clean', 'under_review', 'excluded')),
    CONSTRAINT driver_qualification_registry_driver_period_key UNIQUE (driver_id, programme_period_id)
);

CREATE INDEX IF NOT EXISTS idx_driver_qual_period ON driver_qualification_registry(programme_period_id);
CREATE INDEX IF NOT EXISTS idx_driver_qual_status ON driver_qualification_registry(qualification_status);
CREATE INDEX IF NOT EXISTS idx_driver_qual_driver ON driver_qualification_registry(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_qual_fraud ON driver_qualification_registry(fraud_review_status);

-- Driver Qualification Progress table (PINGRIDE letters)
CREATE TABLE IF NOT EXISTS driver_qualification_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES driver_profiles(id) ON DELETE RESTRICT,
    programme_period_id UUID NOT NULL REFERENCES programme_periods(id) ON DELETE RESTRICT,
    letter_position INTEGER NOT NULL,
    letter_char CHAR(1) NOT NULL,
    is_completed BOOLEAN DEFAULT FALSE,
    progress_percentage NUMERIC DEFAULT 0.00,
    cumulative_contribution_at_milestone NUMERIC DEFAULT 0.00,
    achieved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT driver_qualification_progress_letter_position_check CHECK (letter_position BETWEEN 1 AND 8),
    CONSTRAINT driver_qualification_progress_letter_char_check CHECK (letter_char IN ('P', 'I', 'N', 'G', 'R', 'D', 'E')),
    CONSTRAINT driver_qualification_progress_driver_period_letter_key UNIQUE (driver_id, programme_period_id, letter_position)
);

CREATE INDEX IF NOT EXISTS idx_driver_progress_driver ON driver_qualification_progress(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_progress_period ON driver_qualification_progress(programme_period_id);

-- ============================================
-- V2.0 INCENTIVE ECOSYSTEM - REBATE FUND
-- ============================================

-- Rebate Fund Balance table
CREATE TABLE IF NOT EXISTS rebate_fund_balance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    programme_period_id UUID NOT NULL REFERENCES programme_periods(id) ON DELETE RESTRICT,
    total_contributions NUMERIC DEFAULT 0.00,
    total_allocated NUMERIC DEFAULT 0.00,
    total_credited NUMERIC DEFAULT 0.00,
    total_utilised NUMERIC DEFAULT 0.00,
    total_expired NUMERIC DEFAULT 0.00,
    current_balance NUMERIC DEFAULT 0.00,
    reserved_amount NUMERIC DEFAULT 0.00,
    last_calculation_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT rebate_fund_balance_programme_period_key UNIQUE (programme_period_id)
);

CREATE INDEX IF NOT EXISTS idx_rebate_balance_period ON rebate_fund_balance(programme_period_id);

-- Rebate Fund Contributions table
CREATE TABLE IF NOT EXISTS rebate_fund_contributions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE RESTRICT,
    programme_period_id UUID NOT NULL REFERENCES programme_periods(id) ON DELETE RESTRICT,
    passenger_id UUID NOT NULL REFERENCES passenger_profiles(id) ON DELETE RESTRICT,
    contribution_amount NUMERIC NOT NULL,
    fare_amount NUMERIC NOT NULL,
    contribution_percentage NUMERIC NOT NULL,
    ride_eligible BOOLEAN DEFAULT TRUE,
    excluded_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT rebate_fund_contributions_ride_key UNIQUE (ride_id)
);

CREATE INDEX IF NOT EXISTS idx_rebate_contrib_period ON rebate_fund_contributions(programme_period_id);
CREATE INDEX IF NOT EXISTS idx_rebate_contrib_passenger ON rebate_fund_contributions(passenger_id);
CREATE INDEX IF NOT EXISTS idx_rebate_contrib_ride ON rebate_fund_contributions(ride_id);

-- Rebate Allocations table
CREATE TABLE IF NOT EXISTS rebate_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    passenger_id UUID NOT NULL REFERENCES passenger_profiles(id) ON DELETE RESTRICT,
    programme_period_id UUID NOT NULL REFERENCES programme_periods(id) ON DELETE RESTRICT,
    qualification_registry_id UUID NOT NULL REFERENCES passenger_qualification_registry(id) ON DELETE RESTRICT,
    eligible_annual_spend NUMERIC NOT NULL,
    provisional_allocation NUMERIC NOT NULL,
    individual_cap_applied NUMERIC,
    final_allocation NUMERIC NOT NULL,
    fund_sufficiency_applied BOOLEAN DEFAULT FALSE,
    allocation_status VARCHAR(20) DEFAULT 'pending',
    approved_at TIMESTAMPTZ,
    distributed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT rebate_allocations_status_check CHECK (allocation_status IN ('pending', 'approved', 'distributed', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_rebate_alloc_period ON rebate_allocations(programme_period_id);
CREATE INDEX IF NOT EXISTS idx_rebate_alloc_passenger ON rebate_allocations(passenger_id);
CREATE INDEX IF NOT EXISTS idx_rebate_alloc_status ON rebate_allocations(allocation_status);

-- Rebate Credits table
CREATE TABLE IF NOT EXISTS rebate_credits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    passenger_id UUID NOT NULL REFERENCES passenger_profiles(id) ON DELETE RESTRICT,
    allocation_id UUID NOT NULL REFERENCES rebate_allocations(id) ON DELETE RESTRICT,
    credit_amount NUMERIC NOT NULL,
    used_amount NUMERIC DEFAULT 0.00,
    remaining_amount NUMERIC NOT NULL,
    expires_at TIMESTAMPTZ,
    status VARCHAR(20) DEFAULT 'active',
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT rebate_credits_status_check CHECK (status IN ('active', 'used', 'expired', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_rebate_credit_passenger ON rebate_credits(passenger_id);
CREATE INDEX IF NOT EXISTS idx_rebate_credit_status ON rebate_credits(status);
CREATE INDEX IF NOT EXISTS idx_rebate_credit_expiry ON rebate_credits(expires_at);

-- Rebate Credit Usage table
CREATE TABLE IF NOT EXISTS rebate_credit_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    credit_id UUID NOT NULL REFERENCES rebate_credits(id) ON DELETE RESTRICT,
    ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE RESTRICT,
    passenger_id UUID NOT NULL REFERENCES passenger_profiles(id) ON DELETE RESTRICT,
    amount_used NUMERIC NOT NULL,
    fare_amount NUMERIC NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT rebate_credit_usage_credit_ride_key UNIQUE (credit_id, ride_id)
);

CREATE INDEX IF NOT EXISTS idx_rebate_usage_credit ON rebate_credit_usage(credit_id);
CREATE INDEX IF NOT EXISTS idx_rebate_usage_ride ON rebate_credit_usage(ride_id);
CREATE INDEX IF NOT EXISTS idx_rebate_usage_passenger ON rebate_credit_usage(passenger_id);

-- ============================================
-- V2.0 INCENTIVE ECOSYSTEM - WINNERS
-- ============================================

-- Winners table
CREATE TABLE IF NOT EXISTS winners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    user_type VARCHAR(20) NOT NULL,
    programme_period_id UUID NOT NULL REFERENCES programme_periods(id) ON DELETE RESTRICT,
    qualification_registry_id UUID NOT NULL,
    eligible_value NUMERIC NOT NULL,
    rank_position INTEGER NOT NULL,
    selected_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status VARCHAR(20) DEFAULT 'active',
    disqualification_reason TEXT,
    replacement_winner_id UUID REFERENCES winners(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT winners_user_type_check CHECK (user_type IN ('passenger', 'driver')),
    CONSTRAINT winners_status_check CHECK (status IN ('active', 'disqualified', 'paid'))
);

CREATE INDEX IF NOT EXISTS idx_winners_period ON winners(programme_period_id);
CREATE INDEX IF NOT EXISTS idx_winners_user ON winners(user_id);
CREATE INDEX IF NOT EXISTS idx_winners_status ON winners(status);
CREATE INDEX IF NOT EXISTS idx_winners_user_type ON winners(user_type);
CREATE INDEX IF NOT EXISTS idx_winners_period_status ON winners(programme_period_id, status);

-- ============================================
-- V2.0 INCENTIVE ECOSYSTEM - FRAUD & EXCLUSIONS
-- ============================================

-- Incentive Fraud Cases table
CREATE TABLE IF NOT EXISTS incentive_fraud_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    programme_period_id UUID NOT NULL REFERENCES programme_periods(id) ON DELETE RESTRICT,
    case_type VARCHAR(50) NOT NULL,
    passenger_id UUID REFERENCES passenger_profiles(id) ON DELETE SET NULL,
    driver_id UUID REFERENCES driver_profiles(id) ON DELETE SET NULL,
    ride_ids UUID[] DEFAULT '{}',
    suspicion_score NUMERIC NOT NULL,
    description TEXT,
    evidence JSONB,
    severity VARCHAR(20) NOT NULL,
    status VARCHAR(20) DEFAULT 'detected',
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    investigated_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    investigated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolution_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT incentive_fraud_cases_case_type_check CHECK (case_type IN ('collusion', 'ghost_ride', 'gps_spoofing', 'payment_fraud', 'account_abuse', 'qualification_velocity', 'other')),
    CONSTRAINT incentive_fraud_cases_severity_check CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    CONSTRAINT incentive_fraud_cases_status_check CHECK (status IN ('detected', 'investigating', 'confirmed', 'dismissed', 'resolved'))
);

CREATE INDEX IF NOT EXISTS idx_fraud_cases_period ON incentive_fraud_cases(programme_period_id);
CREATE INDEX IF NOT EXISTS idx_fraud_cases_status ON incentive_fraud_cases(status);
CREATE INDEX IF NOT EXISTS idx_fraud_cases_severity ON incentive_fraud_cases(severity);
CREATE INDEX IF NOT EXISTS idx_fraud_cases_type ON incentive_fraud_cases(case_type);
CREATE INDEX IF NOT EXISTS idx_fraud_cases_passenger ON incentive_fraud_cases(passenger_id);
CREATE INDEX IF NOT EXISTS idx_fraud_cases_driver ON incentive_fraud_cases(driver_id);
CREATE INDEX IF NOT EXISTS idx_fraud_cases_detected ON incentive_fraud_cases(detected_at);
CREATE INDEX IF NOT EXISTS idx_fraud_cases_suspicion ON incentive_fraud_cases(suspicion_score);

-- Qualification Exclusions table
CREATE TABLE IF NOT EXISTS qualification_exclusions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    programme_period_id UUID NOT NULL REFERENCES programme_periods(id) ON DELETE RESTRICT,
    user_type VARCHAR(20) NOT NULL,
    user_id UUID NOT NULL,
    fraud_case_id UUID REFERENCES incentive_fraud_cases(id) ON DELETE SET NULL,
    exclusion_type VARCHAR(30) NOT NULL,
    exclusion_reason TEXT NOT NULL,
    affected_amount NUMERIC,
    reversed BOOLEAN DEFAULT FALSE,
    reversed_at TIMESTAMPTZ,
    reversed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT qualification_exclusions_user_type_check CHECK (user_type IN ('passenger', 'driver')),
    CONSTRAINT qualification_exclusions_exclusion_type_check CHECK (exclusion_type IN ('qualification_reversal', 'winner_disqualification', 'programme_ban', 'temporary_suspension'))
);

CREATE INDEX IF NOT EXISTS idx_exclusions_period ON qualification_exclusions(programme_period_id);
CREATE INDEX IF NOT EXISTS idx_exclusions_user ON qualification_exclusions(user_id, user_type);
CREATE INDEX IF NOT EXISTS idx_exclusions_fraud_case ON qualification_exclusions(fraud_case_id);
CREATE INDEX IF NOT EXISTS idx_exclusions_status ON qualification_exclusions(reversed);

-- ============================================
-- POSTGIS AUTO-UPDATE TRIGGER
-- ============================================

CREATE OR REPLACE FUNCTION update_driver_location_geo()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.last_location_latitude IS NOT NULL AND NEW.last_location_longitude IS NOT NULL THEN
    NEW.location_geo = ST_SetSRID(
      ST_MakePoint(NEW.last_location_longitude, NEW.last_location_latitude), 
      4326
    )::geography;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS driver_location_geo_trigger ON driver_profiles;
CREATE TRIGGER driver_location_geo_trigger
BEFORE INSERT OR UPDATE ON driver_profiles
FOR EACH ROW
EXECUTE FUNCTION update_driver_location_geo();