import { Router } from 'express';
import RideController from '../controllers/ride.controller';
import { authenticate, requireVerified } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import Joi from 'joi';

const router = Router();
const rideController = new RideController();

// ============================================
// VALIDATION SCHEMAS
// ============================================

const createRideRequestSchema = Joi.object({
  pickup_latitude: Joi.number().min(-90).max(90).required(),
  pickup_longitude: Joi.number().min(-180).max(180).required(),
  pickup_address: Joi.string().required(),
  destination_latitude: Joi.number().min(-90).max(90).required(),
  destination_longitude: Joi.number().min(-180).max(180).required(),
  destination_address: Joi.string().required(),
  vehicle_type: Joi.string().valid('standard', 'premium', 'executive').optional(),
});

const submitBidSchema = Joi.object({
  ride_request_id: Joi.string().uuid().required(),
  bid_amount: Joi.number().min(0).required(),
  eta_minutes: Joi.number().min(1).max(120).required(),
  driver_notes: Joi.string().optional(),
});

const updateRideStatusSchema = Joi.object({
  status: Joi.string().valid(
    'confirmed',
    'driver_en_route',
    'driver_arrived',
    'ride_started',
    'ride_in_progress',
    'ride_completed',
    'cancelled',
    'failed',
    'expired',
    'requested',
    'bidding',
    'bid_selected'
  ).required(),
  latitude: Joi.number().min(-90).max(90).optional(),
  longitude: Joi.number().min(-180).max(180).optional(),
  notes: Joi.string().optional(),
});

const cancelRideSchema = Joi.object({
  reason: Joi.string().optional(),
});

// ============================================
// RIDE REQUEST ROUTES (Passenger)
// ============================================

// Create a ride request
router.post(
  '/requests',
  authenticate,
  requireVerified(),
  validate(createRideRequestSchema),
  rideController.createRideRequest.bind(rideController)
);

// Get ride request details
router.get(
  '/requests/:rideRequestId',
  authenticate,
  requireVerified(),
  rideController.getRideRequest.bind(rideController)
);

// Get bids for a ride request
router.get(
  '/requests/:rideRequestId/bids',
  authenticate,
  requireVerified(),
  rideController.getBids.bind(rideController)
);

// ============================================
// BID ROUTES (Driver)
// ============================================

// Submit a bid
router.post(
  '/bids',
  authenticate,
  requireVerified(),
  validate(submitBidSchema),
  rideController.submitBid.bind(rideController)
);

// ============================================
// BID SELECTION ROUTES (Passenger)
// ============================================

// Select a bid
router.post(
  '/requests/:rideRequestId/bids/:bidId/select',
  authenticate,
  requireVerified(),
  rideController.selectBid.bind(rideController)
);

// ============================================
// RIDE ROUTES
// ============================================

// Get ride details
router.get(
  '/:rideId',
  authenticate,
  requireVerified(),
  rideController.getRide.bind(rideController)
);

// Update ride status (Driver)
router.patch(
  '/:rideId/status',
  authenticate,
  requireVerified(),
  validate(updateRideStatusSchema),
  rideController.updateRideStatus.bind(rideController)
);

// Cancel ride
router.post(
  '/:rideId/cancel',
  authenticate,
  requireVerified(),
  validate(cancelRideSchema),
  rideController.cancelRide.bind(rideController)
);

// ============================================
// PAYMENT ROUTES
// ============================================

/**
 * Initiate payment for a completed ride
 * POST /api/v1/rides/:rideId/pay
 */
router.post(
  '/:rideId/pay',
  authenticate,
  requireVerified(),
  rideController.payForRide.bind(rideController)
);

/**
 * Check if a ride is ready for payment
 * GET /api/v1/rides/:rideId/pay/check
 */
router.get(
  '/:rideId/pay/check',
  authenticate,
  requireVerified(),
  rideController.checkPaymentEligibility.bind(rideController)
);

/**
 * Get payment status for a ride
 * GET /api/v1/rides/:rideId/payment-status
 */
router.get(
  '/:rideId/payment-status',
  authenticate,
  requireVerified(),
  rideController.getPaymentStatus.bind(rideController)
);

/**
 * Get full ride details with payment and incentive data
 * GET /api/v1/rides/:rideId/full
 */
router.get(
  '/:rideId/full',
  authenticate,
  requireVerified(),
  rideController.getFullRideDetails.bind(rideController)
);

// ============================================
// ACTIVE RIDES ROUTES
// ============================================

// Get active rides for driver
router.get(
  '/driver/active',
  authenticate,
  requireVerified(),
  rideController.getActiveRidesForDriver.bind(rideController)
);

// Get active rides for passenger
router.get(
  '/passenger/active',
  authenticate,
  requireVerified(),
  rideController.getActiveRidesForPassenger.bind(rideController)
);

// ============================================
// RIDE HISTORY ROUTES
// ============================================

// Get ride history for passenger
router.get(
  '/passenger/history',
  authenticate,
  requireVerified(),
  rideController.getRideHistory.bind(rideController)
);

export default router;