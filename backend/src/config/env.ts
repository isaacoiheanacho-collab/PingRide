import dotenv from 'dotenv';
import path from 'path';

// Load .env from the root directory
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export const env = {
  // Application
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  apiUrl: process.env.API_URL || 'http://localhost:4000',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3001',
  mobileApiUrl: process.env.MOBILE_API_URL || 'http://localhost:4000/api/v1',

  // ============================================
  // MOCK / LIVE MODE CONTROL
  // ============================================
  // Controls whether external services (Paystack, etc.) use mock or real APIs.
  // IMPORTANT: This is independent of NODE_ENV. You can run in development
  // mode while hitting real Paystack APIs (useful for testing with live keys).
  //
  //   MOCK_PAYSTACK=true   → Use mock responses (no external API calls)
  //   MOCK_PAYSTACK=false  → Use real Paystack API
  //   MOCK_PAYSTACK unset  → Auto: mock if Paystack keys are missing
  mockPaystack: (() => {
    const value = process.env.MOCK_PAYSTACK;
    if (value === 'true') return true;
    if (value === 'false') return false;
    // Auto-fallback: mock if Paystack secret key is missing or invalid
    const key = process.env.PAYSTACK_SECRET_KEY || '';
    return !key || !key.startsWith('sk_');
  })(),

  // Database
  dbHost: process.env.DB_HOST || 'localhost',
  dbPort: parseInt(process.env.DB_PORT || '5432', 10),
  dbUsername: process.env.DB_USERNAME || 'pingride_user',
  dbPassword: process.env.DB_PASSWORD || 'password',
  dbDatabase: process.env.DB_DATABASE || 'pingride_dev',
  databaseUrl: process.env.DATABASE_URL || '',
  dbPoolMax: parseInt(process.env.DB_POOL_MAX || '20', 10),
  dbPoolIdleTimeout: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000', 10),
  dbPoolConnectionTimeout: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT || '5000', 10),

  // Redis
  redisHost: process.env.REDIS_HOST || 'localhost',
  redisPort: parseInt(process.env.REDIS_PORT || '6379', 10),
  redisPassword: process.env.REDIS_PASSWORD || '',
  redisSsl: process.env.REDIS_SSL === 'true',
  redisUrl: process.env.REDIS_URL || '',

  // JWT
  jwtSecret: process.env.JWT_SECRET || 'your-jwt-secret',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'your-refresh-secret',
  jwtAccessExpiry: process.env.JWT_ACCESS_EXPIRY || '24h',
  jwtRefreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
  logFormat: process.env.LOG_FORMAT || 'json',

  // Cache TTLs
  cacheSessionTtl: parseInt(process.env.CACHE_SESSION_TTL || '86400', 10),
  cacheOtpTtl: parseInt(process.env.CACHE_OTP_TTL || '300', 10),
  cacheDriverLocationTtl: parseInt(process.env.CACHE_DRIVER_LOCATION_TTL || '30', 10),
  cacheRideRequestTtl: parseInt(process.env.CACHE_RIDE_REQUEST_TTL || '300', 10),
  cacheConfigTtl: parseInt(process.env.CACHE_CONFIG_TTL || '300', 10),

  // Business Rules
  biddingWindowSeconds: parseInt(process.env.BIDDING_WINDOW_SECONDS || '30', 10),
  driverConfirmationSeconds: parseInt(process.env.DRIVER_CONFIRMATION_SECONDS || '15', 10),
  cancellationFeePercentage: parseFloat(process.env.CANCELLATION_FEE_PERCENTAGE || '0.10'),
  minBidAmount: parseFloat(process.env.MIN_BID_AMOUNT || '0'),
  maxBidAmount: parseFloat(process.env.MAX_BID_AMOUNT || '1000'),
  driverSearchRadiusKm: parseFloat(process.env.DRIVER_SEARCH_RADIUS_KM || '5'),
  minDriverRating: parseFloat(process.env.MIN_DRIVER_RATING || '4.0'),

  // Feature Flags
  enableDailyReservations: process.env.ENABLE_DAILY_RESERVATIONS === 'true',
  enableAiMatching: process.env.ENABLE_AI_MATCHING === 'true',
  enableDynamicPricing: process.env.ENABLE_DYNAMIC_PRICING === 'true',
  enablePromotions: process.env.ENABLE_PROMOTIONS === 'true',

  // Integrations
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY || '',
  paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY || '',
  paystackCallbackUrl: process.env.PAYSTACK_CALLBACK_URL || '',

  // ============================================
  // DOJAH (Phase 2C + 2D — Driver KYC & Vehicle Compliance)
  // ============================================
  // Sandbox base URL:    https://sandbox.dojah.io    (mock data, free)
  // Production base URL: https://api.dojah.io        (live data, per-call billing)
  // Auth uses two raw headers: Authorization: <secret_key> and AppId: <app_id>.
  dojahAppId: process.env.DOJAH_APP_ID || '',
  dojahPrivateKey: process.env.DOJAH_PRIVATE_KEY || '',
  dojahBaseUrl: process.env.DOJAH_BASE_URL || 'https://sandbox.dojah.io',

  // Firebase
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || '',
  firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
  firebasePrivateKey: process.env.FIREBASE_PRIVATE_KEY || '',
  firebaseServiceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '',

  // SMS
  smsProvider: process.env.SMS_PROVIDER || '',
  smsApiKey: process.env.SMS_API_KEY || '',
  smsUsername: process.env.SMS_USERNAME || '',
  smsSenderId: process.env.SMS_SENDER_ID || '',

  // Email
  emailProvider: process.env.EMAIL_PROVIDER || '',
  emailApiKey: process.env.EMAIL_API_KEY || '',
  emailSender: process.env.EMAIL_SENDER || '',

  // AWS
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  awsRegion: process.env.AWS_REGION || 'us-east-1',
  awsS3Bucket: process.env.AWS_S3_BUCKET || '',

  // Monitoring
  sentryDsn: process.env.SENTRY_DSN || '',
  ddApiKey: process.env.DD_API_KEY || '',
  ddAppKey: process.env.DD_APP_KEY || '',

  // ============================================
  // LICENSED PARTNER (Fintech/BaaS)
  // ============================================
  licensedPartner: process.env.LICENSED_PARTNER || 'paystack',
  licensedPartnerApiKey: process.env.LICENSED_PARTNER_API_KEY || '',
  licensedPartnerBaseUrl: process.env.LICENSED_PARTNER_BASE_URL || '',
  licensedPartnerWebhookSecret: process.env.LICENSED_PARTNER_WEBHOOK_SECRET || '',

  // ============================================
  // WALLET & REBATE CONFIGURATION
  // ============================================
  defaultCommissionRate: parseFloat(process.env.DEFAULT_COMMISSION_RATE || '15') / 100,
  defaultRebateContributionRate: parseFloat(process.env.DEFAULT_REBATE_CONTRIBUTION_RATE || '1'),
  creditExpiryDays: parseInt(process.env.CREDIT_EXPIRY_DAYS || '90', 10),
} as const;

export default env;