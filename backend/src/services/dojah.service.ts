import axios, { AxiosInstance } from 'axios';
import { env } from '../config/env';
import logger from '../utils/logger';

/**
 * Dojah Provider Client
 *
 * Wraps all Phase 2C + 2D verification calls to Dojah.
 * - Sandbox:    https://sandbox.dojah.io    (mock data, free)
 * - Production: https://api.dojah.io        (live data, per-call billing)
 *
 * Auth: two raw headers per request.
 *   Authorization: <secret_key>   ← raw, NOT "Bearer <key>"
 *   AppId:         <app_id>
 */

interface IDojahDriverLicenseResponse {
  entity?: {
    id?: string;
    license_number?: string;
    first_name?: string;
    last_name?: string;
    date_of_birth?: string;
    state_of_issue?: string;
    expiry_date?: string;
    photo?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

interface IDojahLivenessResponse {
  entity?: {
    liveness?: boolean;
    confidence_score?: number;
    [key: string]: any;
  };
  [key: string]: any;
}

interface IDojahFaceMatchResponse {
  entity?: {
    match?: boolean;
    confidence_score?: number;
    [key: string]: any;
  };
  [key: string]: any;
}

interface IDojahPlateResponse {
  entity?: {
    plate_number?: string;
    owner_name?: string;
    vehicle_make?: string;
    vehicle_model?: string;
    vin?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

export class DojahService {
  private static client: AxiosInstance | null = null;

  private static getClient(): AxiosInstance {
    if (!this.client) {
      const baseURL = env.dojahBaseUrl || 'https://sandbox.dojah.io';

      if (!env.dojahAppId || !env.dojahPrivateKey) {
        logger.warn(
          'Dojah credentials missing — DojahService calls will fail. ' +
            'Set DOJAH_APP_ID and DOJAH_PRIVATE_KEY in .env.'
        );
      }

      this.client = axios.create({
        baseURL,
        timeout: 30000,
        headers: {
          'Authorization': env.dojahPrivateKey || '',
          'AppId': env.dojahAppId || '',
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        validateStatus: (status) => status < 500,
      });

      this.client.interceptors.response.use(
        (response) => {
          logger.debug('Dojah API response', {
            status: response.status,
            url: response.config.url,
          });
          return response;
        },
        (error) => {
          logger.error('Dojah API error:', {
            message: error.message,
            url: error.config?.url,
            status: error.response?.status,
            data: error.response?.data,
          });
          return Promise.reject(error);
        }
      );
    }
    return this.client;
  }

  /**
   * Check if Dojah is configured with credentials.
   */
  static isConfigured(): boolean {
    return Boolean(env.dojahAppId && env.dojahPrivateKey);
  }

  /**
   * Returns true if the client is pointed at the sandbox environment.
   */
  static isSandbox(): boolean {
    const url = env.dojahBaseUrl || '';
    return url.includes('sandbox');
  }

  // ============================================
  // PHASE 2C — DRIVER LICENSE VERIFICATION
  // ============================================

  /**
   * Verify a driver's license against FRSC records.
   *
   * Sandbox: any license number returns mock data.
   * Production: validated against the real FRSC database.
   */
  static async verifyDriverLicense(data: {
    licenseNumber: string;
    firstName: string;
    lastName: string;
  }): Promise<IDojahDriverLicenseResponse> {
    const client = this.getClient();

    const response = await client.get('/api/v1/kyc/driver_license', {
      params: {
        license_number: data.licenseNumber,
        first_name: data.firstName,
        last_name: data.lastName,
      },
    });

    if (response.status !== 200 || !response.data?.entity) {
      const message =
        response.data?.error ||
        response.data?.message ||
        `Driver license verification failed (status ${response.status})`;
      logger.warn('Dojah driver license verification failed', {
        license_last4: data.licenseNumber.slice(-4),
        status: response.status,
      });
      throw new Error(message);
    }

    return response.data;
  }

  // ============================================
  // PHASE 2C — LIVENESS CHECK (PASSIVE)
  // ============================================

  /**
   * Perform passive liveness detection on a selfie.
   * Dojah returns a confidence score (0–100). Threshold >95 recommended.
   */
  static async checkLiveness(
    selfieBase64: string
  ): Promise<IDojahLivenessResponse> {
    const client = this.getClient();

    const response = await client.post('/api/v1/kyc/liveness', {
      image: selfieBase64,
      type: 'selfie',
    });

    if (response.status !== 200 || !response.data?.entity) {
      const message =
        response.data?.error ||
        response.data?.message ||
        `Liveness check failed (status ${response.status})`;
      logger.warn('Dojah liveness check failed', { status: response.status });
      throw new Error(message);
    }

    return response.data;
  }

  // ============================================
  // PHASE 2C — FACE MATCH
  // ============================================

  /**
   * Compare a live selfie against a reference ID photo.
   * Reference photo is the license photo returned by verifyDriverLicense.
   */
  static async faceMatch(data: {
    selfieBase64: string;
    referenceImageBase64: string;
  }): Promise<IDojahFaceMatchResponse> {
    const client = this.getClient();

    const response = await client.post('/api/v1/kyc/photoid/verify', {
      selfie_image: data.selfieBase64,
      photoid_image: data.referenceImageBase64,
    });

    if (response.status !== 200 || !response.data?.entity) {
      const message =
        response.data?.error ||
        response.data?.message ||
        `Face match failed (status ${response.status})`;
      logger.warn('Dojah face match failed', { status: response.status });
      throw new Error(message);
    }

    return response.data;
  }

  // ============================================
  // PHASE 2D — LICENSE PLATE LOOKUP
  // ============================================

  /**
   * Look up vehicle details by plate number.
   * Returns owner name + vehicle info for compliance review.
   */
  static async verifyLicensePlate(data: {
    plateNumber: string;
  }): Promise<IDojahPlateResponse> {
    const client = this.getClient();

    const response = await client.get('/api/v1/general/plate_number', {
      params: {
        plate_number: data.plateNumber,
      },
    });

    if (response.status !== 200 || !response.data?.entity) {
      const message =
        response.data?.error ||
        response.data?.message ||
        `Plate number lookup failed (status ${response.status})`;
      logger.warn('Dojah plate lookup failed', {
        plate_last4: data.plateNumber.slice(-4),
        status: response.status,
      });
      throw new Error(message);
    }

    return response.data;
  }
}

export default DojahService;