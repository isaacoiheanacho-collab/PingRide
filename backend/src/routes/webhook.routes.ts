import { Router, Request, Response } from 'express';
import { WebhookService } from '../services/webhook.service';
import { PaystackService } from '../services/paystack.service';
import logger from '../utils/logger';

const router = Router();

/**
 * Health check endpoint for webhook status
 * GET /api/webhooks/health
 */
router.get('/health', async (_req: Request, res: Response): Promise<void> => {
    try {
        const isConfigured = PaystackService.isConfigured();
        
        res.status(200).json({
            status: 'healthy',
            service: 'webhook-handler',
            timestamp: new Date().toISOString(),
            configuration: {
                paystack: isConfigured ? 'configured' : 'missing',
                webhook_url: process.env.PAYSTACK_CALLBACK_URL || 'not set',
            }
        });
    } catch (error) {
        logger.error('Webhook health check error:', error);
        res.status(500).json({
            status: 'unhealthy',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * POST /api/webhooks/bank-transfer
 * Receive webhook from licensed partner (Providus/Wema/etc)
 */
router.post('/bank-transfer', async (req: Request, res: Response): Promise<void> => {
    const requestId = generateRequestId();
    logger.info(`Bank transfer webhook received: ${requestId}`, {
        headers: req.headers,
        body_keys: Object.keys(req.body || {}),
    });

    try {
        const result = await WebhookService.handleBankTransferWebhook(
            req.body,
            req.headers
        );
        
        if (result.received) {
            logger.info(`Bank transfer webhook processed: ${requestId}`, {
                message: result.message,
            });
            res.status(200).json({ 
                status: 'success', 
                message: result.message,
                request_id: requestId,
            });
            return;
        } else {
            logger.warn(`Bank transfer webhook failed: ${requestId}`, {
                message: result.message,
            });
            res.status(400).json({ 
                status: 'error', 
                message: result.message,
                request_id: requestId,
            });
            return;
        }
    } catch (error) {
        logger.error(`Bank transfer webhook error: ${requestId}`, error);
        res.status(500).json({ 
            status: 'error', 
            message: 'Internal server error processing webhook',
            request_id: requestId,
        });
        return;
    }
});

/**
 * POST /api/webhooks/paystack
 * Receive webhook from Paystack (for DVA transfers and card top-ups)
 * 
 * IMPORTANT: This endpoint MUST be registered in Paystack Dashboard:
 * https://dashboard.paystack.com/#/settings/developer
 * 
 * Add this URL: https://your-domain.com/api/webhooks/paystack
 * 
 * Paystack webhook events handled:
 * - charge.success (DVA transfers, card payments)
 * - charge.failed (failed payments)
 * - transfer.success (successful payouts)
 * - transfer.failed (failed payouts)
 * - transfer.reversed (reversed payouts)
 * - refund.processed (processed refunds)
 * - refund.failed (failed refunds)
 */
router.post('/paystack', async (req: Request, res: Response): Promise<void> => {
    const requestId = generateRequestId();
    const signature = req.headers['x-paystack-signature'] as string;
    
    logger.info(`Paystack webhook received: ${requestId}`, {
        event: req.body?.event,
        reference: req.body?.data?.reference,
        has_signature: !!signature,
    });

    // Always respond quickly to avoid Paystack retries
    // We'll process the webhook asynchronously
    try {
        // Verify signature first
        if (!signature) {
            logger.warn(`Paystack webhook missing signature: ${requestId}`);
            res.status(400).json({ 
                status: 'error', 
                message: 'Missing signature header',
                request_id: requestId,
            });
            return;
        }

        // Process webhook
        const result = await WebhookService.handlePaystackWebhook(
            req.body,
            req.headers
        );
        
        if (result.received) {
            logger.info(`Paystack webhook processed: ${requestId}`, {
                event: result.event,
                reference: result.reference,
                message: result.message,
            });
            res.status(200).json({ 
                status: 'success', 
                message: result.message,
                event: result.event,
                reference: result.reference,
                request_id: requestId,
            });
            return;
        } else {
            logger.warn(`Paystack webhook failed: ${requestId}`, {
                message: result.message,
            });
            res.status(400).json({ 
                status: 'error', 
                message: result.message,
                request_id: requestId,
            });
            return;
        }
    } catch (error) {
        // Even on error, return 200 to prevent Paystack retries
        // The error is logged and will be investigated manually
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Paystack webhook error: ${requestId}`, { 
            error: errorMessage,
            event: req.body?.event,
            reference: req.body?.data?.reference,
        });
        
        // Still return 200 to acknowledge receipt
        res.status(200).json({ 
            status: 'error', 
            message: 'Webhook received but processing failed. Check logs.',
            request_id: requestId,
        });
        return;
    }
});

/**
 * POST /api/webhooks/payout
 * Receive webhook from licensed partner for payout status
 */
router.post('/payout', async (req: Request, res: Response): Promise<void> => {
    const requestId = generateRequestId();
    logger.info(`Payout webhook received: ${requestId}`, {
        reference: req.body?.reference || req.body?.data?.reference,
    });

    try {
        const result = await WebhookService.handlePayoutWebhook(
            req.body,
            req.headers
        );
        
        if (result.received) {
            logger.info(`Payout webhook processed: ${requestId}`, {
                message: result.message,
            });
            res.status(200).json({ 
                status: 'success', 
                message: result.message,
                request_id: requestId,
            });
            return;
        } else {
            logger.warn(`Payout webhook failed: ${requestId}`, {
                message: result.message,
            });
            res.status(400).json({ 
                status: 'error', 
                message: result.message,
                request_id: requestId,
            });
            return;
        }
    } catch (error) {
        logger.error(`Payout webhook error: ${requestId}`, error);
        res.status(500).json({ 
            status: 'error', 
            message: 'Internal server error processing webhook',
            request_id: requestId,
        });
        return;
    }
});

/**
 * POST /api/webhooks/refund
 * Receive webhook from licensed partner for refund status
 */
router.post('/refund', async (req: Request, res: Response): Promise<void> => {
    const requestId = generateRequestId();
    logger.info(`Refund webhook received: ${requestId}`, {
        reference: req.body?.reference || req.body?.data?.reference,
    });

    try {
        const result = await WebhookService.handleRefundWebhook(
            req.body,
            req.headers
        );
        
        if (result.received) {
            logger.info(`Refund webhook processed: ${requestId}`, {
                message: result.message,
            });
            res.status(200).json({ 
                status: 'success', 
                message: result.message,
                request_id: requestId,
            });
            return;
        } else {
            logger.warn(`Refund webhook failed: ${requestId}`, {
                message: result.message,
            });
            res.status(400).json({ 
                status: 'error', 
                message: result.message,
                request_id: requestId,
            });
            return;
        }
    } catch (error) {
        logger.error(`Refund webhook error: ${requestId}`, error);
        res.status(500).json({ 
            status: 'error', 
            message: 'Internal server error processing webhook',
            request_id: requestId,
        });
        return;
    }
});

/**
 * POST /api/webhooks/unified
 * Unified webhook endpoint for multiple providers
 */
router.post('/unified', async (req: Request, res: Response): Promise<void> => {
    const requestId = generateRequestId();
    const provider = req.headers['x-provider'] as string || 'unknown';
    const eventType = req.headers['x-event-type'] as string || 'unknown';
    
    logger.info(`Unified webhook received: ${requestId}`, {
        provider,
        eventType,
    });

    try {
        const result = await WebhookService.handleWebhook(
            provider,
            eventType,
            req.body,
            req.headers
        );
        
        if (result.received) {
            logger.info(`Unified webhook processed: ${requestId}`, {
                provider,
                eventType,
                message: result.message,
            });
            res.status(200).json({ 
                status: 'success', 
                message: result.message,
                provider,
                event: eventType,
                request_id: requestId,
            });
            return;
        } else {
            logger.warn(`Unified webhook failed: ${requestId}`, {
                provider,
                eventType,
                message: result.message,
            });
            res.status(400).json({ 
                status: 'error', 
                message: result.message,
                provider,
                event: eventType,
                request_id: requestId,
            });
            return;
        }
    } catch (error) {
        logger.error(`Unified webhook error: ${requestId}`, error);
        res.status(500).json({ 
            status: 'error', 
            message: 'Internal server error processing webhook',
            request_id: requestId,
        });
        return;
    }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Generate a unique request ID for tracking
 */
function generateRequestId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `wh-${timestamp}-${random}`;
}

export default router;