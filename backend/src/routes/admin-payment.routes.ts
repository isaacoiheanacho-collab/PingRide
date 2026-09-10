import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { AdminPaymentController } from '../controllers/admin-payment.controller';
import { validate } from '../middleware/validation.middleware';
import Joi from 'joi';

const router = Router();
const controller = new AdminPaymentController();

const createSubaccountSchema = Joi.object({
  business_name: Joi.string().min(1).max(100).required(),
  settlement_bank: Joi.string().required(),
  account_number: Joi.string().required(),
  percentage_charge: Joi.number().min(0).max(100).optional(),
  description: Joi.string().max(500).optional(),
  primary_contact_email: Joi.string().email().optional(),
  primary_contact_name: Joi.string().max(100).optional(),
  primary_contact_phone: Joi.string().optional(),
});

const createSplitCodeSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  type: Joi.string().valid('percentage', 'flat').required(),
  currency: Joi.string().valid('NGN', 'GHS').default('NGN'),
  subaccounts: Joi.array()
    .items(
      Joi.object({
        subaccount: Joi.string().required(),
        share: Joi.number().positive().required(),
      })
    )
    .min(1)
    .required(),
  bearer_type: Joi.string().valid('all', 'subaccount').optional(),
  bearer_subaccount: Joi.string().optional(),
});

const applySplitSchema = Joi.object({
  user_id: Joi.string().uuid().required(),
  split_code: Joi.string().optional(),
  subaccount: Joi.string().optional(),
  preferred_bank: Joi.string().optional(),
}).or('split_code', 'subaccount');

const removeSplitSchema = Joi.object({
  user_id: Joi.string().uuid().required(),
});

router.post(
  '/subaccount',
  authenticate,
  authorize('admin', 'super_admin'),
  validate(createSubaccountSchema),
  controller.createSubaccount.bind(controller)
);

router.get(
  '/subaccounts',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.listSubaccounts.bind(controller)
);

router.get(
  '/subaccount/:identifier',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.getSubaccount.bind(controller)
);

router.put(
  '/subaccount/:identifier',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.updateSubaccount.bind(controller)
);

router.post(
  '/split-code',
  authenticate,
  authorize('admin', 'super_admin'),
  validate(createSplitCodeSchema),
  controller.createSplitCode.bind(controller)
);

router.get(
  '/split-codes',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.listSplitCodes.bind(controller)
);

router.get(
  '/split-code/:identifier',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.getSplitCode.bind(controller)
);

router.put(
  '/split-code/:identifier',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.updateSplitCode.bind(controller)
);

router.post(
  '/apply-split',
  authenticate,
  authorize('admin', 'super_admin'),
  validate(applySplitSchema),
  controller.applySplitToDVA.bind(controller)
);

router.post(
  '/remove-split',
  authenticate,
  authorize('admin', 'super_admin'),
  validate(removeSplitSchema),
  controller.removeSplitFromDVA.bind(controller)
);

router.get(
  '/split-status',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.getSplitConfigStatus.bind(controller)
);

router.get(
  '/split-users',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.getSplitUsers.bind(controller)
);

router.get(
  '/available-banks',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.getAvailableBanks.bind(controller)
);

export default router;