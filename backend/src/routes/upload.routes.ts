// src/routes/upload.routes.ts
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { UploadController } from '../controllers/upload.controller';
import { uploadSingle } from '../middleware/upload.middleware';

const router = Router();
const uploadController = new UploadController();

// All upload routes require authentication
router.use(authenticate);

// Upload KYC document
router.post(
  '/kyc-document',
  uploadSingle,
  uploadController.uploadKYCDocument.bind(uploadController)
);

// Upload profile photo
router.post(
  '/profile-photo',
  uploadSingle,
  uploadController.uploadProfilePhoto.bind(uploadController)
);

// Get presigned URL for direct upload
router.get(
  '/presigned-url',
  uploadController.getPresignedUrl.bind(uploadController)
);

// Get KYC documents for current passenger
router.get(
  '/kyc-documents',
  uploadController.getKycDocuments.bind(uploadController)
);

// Verify KYC document (admin only)
router.patch(
  '/kyc-document/:documentId/verify',
  authorize('admin', 'super_admin'),
  uploadController.verifyKycDocument.bind(uploadController)
);

// Delete KYC document
router.delete(
  '/kyc-document/:documentId',
  uploadController.deleteKycDocument.bind(uploadController)
);

// Delete file by key
router.delete(
  '/:key',
  uploadController.deleteFile.bind(uploadController)
);

export default router;