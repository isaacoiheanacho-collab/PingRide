import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ApiResponseHandler } from '../utils/response';
import UploadService from '../services/upload.service';
import { PassengerModel } from '../models/passenger.model';
import logger from '../utils/logger';

export class UploadController {
  /**
   * Upload KYC document
   * POST /api/v1/upload/kyc-document
   */
  async uploadKYCDocument(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const file = req.file;
    if (!file) {
      return ApiResponseHandler.badRequest(res, 'No file uploaded');
    }

    const { document_type } = req.body;
    if (!document_type) {
      return ApiResponseHandler.badRequest(res, 'document_type is required');
    }

    try {
      const result = await UploadService.uploadFile(
        file,
        `kyc/${userId}`
      );

      // Store document reference in database
      await PassengerModel.addKycDocument(
        userId,
        document_type,
        result.url,
        file.mimetype,
        file.size
      );

      return ApiResponseHandler.success(res, {
        url: result.url,
        key: result.key,
        document_type,
        uploaded_at: new Date().toISOString(),
      }, {
        message: 'Document uploaded successfully',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      logger.error('KYC document upload error:', error);
      return ApiResponseHandler.error(res, 'UPLOAD_ERROR', message, 400);
    }
  }

  /**
   * Upload profile photo
   * POST /api/v1/upload/profile-photo
   */
  async uploadProfilePhoto(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const file = req.file;
    if (!file) {
      return ApiResponseHandler.badRequest(res, 'No file uploaded');
    }

    try {
      const result = await UploadService.uploadFile(
        file,
        `profiles/${userId}`
      );

      // Update passenger profile with photo URL
      await PassengerModel.updateProfile(userId, {
        profile_photo_url: result.url,
      });

      return ApiResponseHandler.success(res, {
        profile_photo_url: result.url,
        key: result.key,
      }, {
        message: 'Profile photo updated successfully',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      logger.error('Profile photo upload error:', error);
      return ApiResponseHandler.error(res, 'UPLOAD_ERROR', message, 400);
    }
  }

  /**
   * Get presigned URL for direct upload
   * GET /api/v1/upload/presigned-url
   */
  async getPresignedUrl(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { file_name, content_type } = req.query;
    const prefix = (req.query.prefix as string) || `uploads/${userId}`;

    if (!file_name || !content_type) {
      return ApiResponseHandler.badRequest(res, 'file_name and content_type are required');
    }

    try {
      const result = await UploadService.getPresignedUploadUrl(
        file_name as string,
        content_type as string,
        prefix
      );

      return ApiResponseHandler.success(res, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate presigned URL';
      logger.error('Presigned URL generation error:', error);
      return ApiResponseHandler.error(res, 'UPLOAD_ERROR', message, 400);
    }
  }

  /**
   * Delete uploaded file
   * DELETE /api/v1/upload/:key
   */
  async deleteFile(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    // ✅ FIXED: Extract key properly from params
    const { key } = req.params;
    const keyStr = Array.isArray(key) ? key[0] : key;

    if (!keyStr) {
      return ApiResponseHandler.badRequest(res, 'File key is required');
    }

    try {
      await UploadService.deleteFile(keyStr);
      return ApiResponseHandler.success(res, null, {
        message: 'File deleted successfully',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Delete failed';
      logger.error('File delete error:', error);
      return ApiResponseHandler.error(res, 'DELETE_ERROR', message, 400);
    }
  }

  /**
   * Get KYC documents for current passenger
   * GET /api/v1/upload/kyc-documents
   */
  async getKycDocuments(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    try {
      const documents = await PassengerModel.getKycDocuments(userId);
      return ApiResponseHandler.success(res, documents);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch documents';
      logger.error('Get KYC documents error:', error);
      return ApiResponseHandler.error(res, 'KYC_DOCS_ERROR', message, 400);
    }
  }

  /**
   * Update KYC document verification status (admin)
   * PATCH /api/v1/upload/kyc-document/:documentId/verify
   */
  async verifyKycDocument(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { documentId } = req.params;
    const documentIdStr = Array.isArray(documentId) ? documentId[0] : documentId;

    const { status, notes } = req.body;

    if (!status || !['pending', 'verified', 'rejected'].includes(status)) {
      return ApiResponseHandler.badRequest(res, 'Valid status (pending, verified, rejected) is required');
    }

    try {
      const result = await PassengerModel.updateKycDocumentVerification(
        documentIdStr,
        status,
        notes,
        adminId
      );

      if (!result) {
        return ApiResponseHandler.notFound(res, 'KYC document not found');
      }

      return ApiResponseHandler.success(res, result, {
        message: `Document verification status updated to ${status}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to verify document';
      logger.error('Verify KYC document error:', error);
      return ApiResponseHandler.error(res, 'KYC_DOCS_ERROR', message, 400);
    }
  }

  /**
   * Delete KYC document
   * DELETE /api/v1/upload/kyc-document/:documentId
   */
  async deleteKycDocument(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { documentId } = req.params;
    const documentIdStr = Array.isArray(documentId) ? documentId[0] : documentId;

    try {
      const deleted = await PassengerModel.deleteKycDocument(documentIdStr, userId);
      
      if (!deleted) {
        return ApiResponseHandler.notFound(res, 'KYC document not found or does not belong to you');
      }

      return ApiResponseHandler.success(res, null, {
        message: 'KYC document deleted successfully',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete document';
      logger.error('Delete KYC document error:', error);
      return ApiResponseHandler.error(res, 'KYC_DOCS_ERROR', message, 400);
    }
  }
}

export default UploadController;