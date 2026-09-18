import { Router } from 'express';
import MarketplaceController from '../controllers/marketplace.controller';
import { authenticate, requireVerified } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import Joi from 'joi';

const router = Router();
const marketplaceController = new MarketplaceController();

// Validation schemas
const requestRideSchema = Joi.object({
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

// ============================================
// PASSENGER ROUTES
// ============================================

router.post(
  '/request',
  authenticate,
  requireVerified(),
  validate(requestRideSchema),
  marketplaceController.requestRide.bind(marketplaceController)
);

router.get(
  '/requests/:rideRequestId',
  authenticate,
  requireVerified(),
  marketplaceController.getRideRequestWithBids.bind(marketplaceController)
);

router.post(
  '/requests/:rideRequestId/bids/:bidId/select',
  authenticate,
  requireVerified(),
  marketplaceController.selectBid.bind(marketplaceController)
);

router.get(
  '/passenger/active',
  authenticate,
  requireVerified(),
  marketplaceController.getActiveRideForPassenger.bind(marketplaceController)
);

// ============================================
// DRIVER ROUTES
// ============================================

router.post(
  '/bids',
  authenticate,
  requireVerified(),
  validate(submitBidSchema),
  marketplaceController.submitBid.bind(marketplaceController)
);

router.get(
  '/driver/active',
  authenticate,
  requireVerified(),
  marketplaceController.getActiveRideForDriver.bind(marketplaceController)
);

// ============================================
// ADMIN / UTILITY ROUTES
// ============================================

router.get(
  '/eligible-drivers',
  authenticate,
  requireVerified(),
  marketplaceController.getEligibleDrivers.bind(marketplaceController)
);

export default router;