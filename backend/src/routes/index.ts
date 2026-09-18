import { Router } from 'express';
import { HealthController } from '../controllers/health.controller';
import authRoutes from './auth.routes';
import userRoutes from './user.routes';
import passengerRoutes from './passenger.routes';
import driverRoutes from './driver.routes';
import rideRoutes from './ride.routes';
import marketplaceRoutes from './marketplace.routes';

// ✅ V2.0 Incentive Routes
import qualificationRoutes from './qualification.routes';
import rebateRoutes from './rebate.routes';
import winnerRoutes from './winner.routes';
import adminIncentiveRoutes from './admin-incentive.routes';

// ✅ Phase 5 - Payment & Wallet Routes
import walletRoutes from './wallet.routes';
import paymentRoutes from './payment.routes';
import ledgerRoutes from './ledger.routes';

// ✅ Phase 9 - Webhook Routes
import webhookRoutes from './webhook.routes';

// ✅ Phase 10 - KYC Routes (passenger)
import kycRoutes from './kyc.routes';

// ✅ Phase 6 - Admin Payment Routes (Split Configuration)
import adminPaymentRoutes from './admin-payment.routes';

// ✅ Phase 2B — Onboarding Routes (driver bank/subaccount)
import onboardingRoutes from './onboarding.routes';

// ✅ Phase 2C — Driver Identity (manual review)
import onboardingIdentityRoutes from './onboarding-identity.routes';

// ✅ Phase 2D — Vehicle Compliance (manual review)
import onboardingVehicleRoutes from './onboarding-vehicle.routes';

// ✅ Admin KYC Review (manual review queue for 2C + 2D)
import adminKycReviewRoutes from './admin-kyc-review.routes';

// ✅ NDPA Consent (onboarding consent recording)
import onboardingConsentRoutes from './onboarding-consent.routes';

const router = Router();
const healthController = new HealthController();

// Health check routes
router.get('/health', healthController.health.bind(healthController));
router.get('/health/ready', healthController.ready.bind(healthController));

// API v1 routes
const v1Router = Router();

// Auth routes (public)
v1Router.use('/auth', authRoutes);

// User routes (protected)
v1Router.use('/users', userRoutes);

// Passenger routes (protected)
v1Router.use('/passenger', passengerRoutes);

// Driver routes (protected)
v1Router.use('/driver', driverRoutes);

// Ride routes (protected)
v1Router.use('/rides', rideRoutes);

// Marketplace routes (protected)
v1Router.use('/marketplace', marketplaceRoutes);

// ============================================
// V2.0 INCENTIVE ECOSYSTEM ROUTES
// ============================================

// Qualification routes (protected)
v1Router.use('/qualification', qualificationRoutes);

// Rebate routes (protected)
v1Router.use('/rebate', rebateRoutes);

// Winner routes (protected)
v1Router.use('/winner', winnerRoutes);

// Admin Incentive routes (protected - admin only)
v1Router.use('/admin/incentive', adminIncentiveRoutes);

// ============================================
// PHASE 5: PAYMENT & WALLET ROUTES
// ============================================

// Wallet routes (protected)
v1Router.use('/wallet', walletRoutes);

// Payment routes (protected)
v1Router.use('/payments', paymentRoutes);

// Ledger routes (protected)
v1Router.use('/ledger', ledgerRoutes);

// ============================================
// PHASE 6: ADMIN PAYMENT ROUTES (Split Configuration)
// ============================================

// Admin Payment routes (protected - admin only)
v1Router.use('/admin/payment', adminPaymentRoutes);

// ============================================
// PHASE 9: WEBHOOK ROUTES (Public)
// ============================================

// Webhook routes (public - no auth required)
v1Router.use('/webhooks', webhookRoutes);

// ============================================
// PHASE 10: KYC ROUTES (Protected — passenger)
// ============================================

// KYC routes (protected - user and admin)
v1Router.use('/kyc', kycRoutes);

// ============================================
// PHASE 2: ONBOARDING ROUTES (role-specific)
// ============================================

// Phase 2B — Driver bank / subaccount
v1Router.use('/onboarding', onboardingRoutes);

// NDPA Consent — record / inspect consent state
// Mounted under /onboarding/consent
v1Router.use('/onboarding/consent', onboardingConsentRoutes);

// Phase 2C — Driver identity (manual review)
// Mounted under /onboarding/driver/identity
v1Router.use('/onboarding/driver/identity', onboardingIdentityRoutes);

// Phase 2D — Vehicle compliance (manual review)
// Mounted under /onboarding/driver/vehicle
v1Router.use('/onboarding/driver/vehicle', onboardingVehicleRoutes);

// ============================================
// PHASE 2C/2D: ADMIN KYC REVIEW ROUTES
// ============================================

// Admin KYC review queue (manual review for identity + vehicle compliance)
// Mounted under /admin/kyc
v1Router.use('/admin/kyc', adminKycReviewRoutes);

// Mount v1 routes
router.use('/api/v1', v1Router);

export default router;