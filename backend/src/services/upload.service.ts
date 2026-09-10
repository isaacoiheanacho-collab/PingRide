// backend/src/services/upload.service.ts
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env';
import crypto from 'crypto';
import path from 'path';
import logger from '../utils/logger';

export class UploadService {
  private static s3Client: S3Client | null = null;

  private static getS3Client(): S3Client {
    if (!this.s3Client) {
      this.s3Client = new S3Client({
        region: env.awsRegion || 'us-east-1',
        credentials: {
          accessKeyId: env.awsAccessKeyId,
          secretAccessKey: env.awsSecretAccessKey,
        },
      });
    }
    return this.s3Client;
  }

  /**
   * Generate a unique filename
   */
  static generateFileName(originalName: string, prefix?: string): string {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    const extension = path.extname(originalName);
    const baseName = path.basename(originalName, extension);
    const sanitizedBase = baseName.replace(/[^a-zA-Z0-9]/g, '-');
    return `${prefix ? prefix + '/' : ''}${timestamp}-${random}-${sanitizedBase}${extension}`;
  }

  /**
   * Upload file to S3/R2
   */
  static async uploadFile(
    file: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    },
    prefix?: string
  ): Promise<{ url: string; key: string; bucket: string }> {
    const s3 = this.getS3Client();
    const bucket = env.awsS3Bucket;
    
    if (!bucket) {
      throw new Error('S3 bucket not configured');
    }

    const key = this.generateFileName(file.originalname, prefix);
    
    // Validate file size
    if (file.size > 10 * 1024 * 1024) { // 10MB limit
      throw new Error('File too large. Maximum size is 10MB.');
    }

    // Validate file type
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowedMimes.includes(file.mimetype)) {
      throw new Error('Invalid file type. Allowed: JPEG, PNG, WebP, PDF');
    }

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: 'public-read',
      Metadata: {
        originalName: file.originalname,
        uploadedAt: new Date().toISOString(),
      },
    });

    await s3.send(command);

    const url = `https://${bucket}.s3.${env.awsRegion}.amazonaws.com/${key}`;
    
    logger.info(`File uploaded: ${key} (${file.size} bytes)`);

    return { url, key, bucket };
  }

  /**
   * Delete file from S3/R2
   */
  static async deleteFile(key: string): Promise<void> {
    const s3 = this.getS3Client();
    const bucket = env.awsS3Bucket;
    
    if (!bucket) {
      throw new Error('S3 bucket not configured');
    }

    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    await s3.send(command);
    logger.info(`File deleted: ${key}`);
  }

  /**
   * Generate presigned URL for direct upload
   */
  static async getPresignedUploadUrl(
    fileName: string,
    contentType: string,
    prefix?: string
  ): Promise<{ url: string; key: string; fields: any }> {
    const s3 = this.getS3Client();
    const bucket = env.awsS3Bucket;
    
    if (!bucket) {
      throw new Error('S3 bucket not configured');
    }

    const key = this.generateFileName(fileName, prefix);

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });

    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

    return {
      url: signedUrl,
      key: key,
      fields: {
        'Content-Type': contentType,
        'x-amz-meta-original-name': fileName,
      },
    };
  }
}

export default UploadService;