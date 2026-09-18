// ============================================
// USER TYPES (EXISTING - UNCHANGED)
// ============================================

export interface IUser {
  id: string;
  phone_number: string;
  email?: string;
  password_hash: string;
  role: 'passenger' | 'driver' | 'admin' | 'support' | 'operations';
  status: 'active' | 'pending_verification' | 'suspended' | 'deactivated' | 'locked';
  phone_verified: boolean;
  email_verified: boolean;
  last_login_at?: Date;
  login_attempts: number;
  locked_until?: Date;
  preferred_language?: string;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date;
}

// ============================================
// AUTH TYPES
// ============================================

export interface IJWTPayload {
  sub: string;
  phone: string;
  role: string;
  userType: string;
  iat?: number;
  exp?: number;
}

export interface ITokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface ILoginRequest {
  phone_number: string;
  password: string;
  device_id?: string;
  device_type?: 'ios' | 'android' | 'web';
}

// ============================================
// PHASE 1 — GENERAL REGISTRATION
// Only: first_name, last_name, phone_number, password, user_type
// ============================================

export interface IRegisterRequest {
  first_name: string;
  last_name: string;
  phone_number: string;
  password: string;
  user_type: 'passenger' | 'driver';
}

// ============================================
// ONBOARDING STATE (Phase 1 auth responses)
// Phase 1 → awaiting_otp → (OTP verified) → role_onboarding → (Phase 2 complete) → completed
// ============================================

export type OnboardingPhase = 'awaiting_otp' | 'role_onboarding' | 'completed';

export type OnboardingNextStep =
  | 'verify_otp'
  | 'passenger_kyc'
  | 'driver_bank'
  | 'driver_identity'
  | 'driver_vehicle'
  | null;

export interface IOnboardingState {
  phase: OnboardingPhase;
  next_step: OnboardingNextStep;
  completed: boolean;
}

// ============================================
// ONBOARDING REQUEST / STATUS TYPES (Phase 2)
// ============================================

/**
 * Phase 2A — Passenger BVN + bank submission for DVA issuance.
 *
 * Sent to POST /api/v1/onboarding/passenger/kyc.
 * Paystack uses these to build the customer record, submit NIBSS
 * identification, and issue a Dedicated Virtual Account (Wema Bank).
 */
export interface IPassengerOnboardingRequest {
  email: string;
  bvn: string;
  bank_account_number: string;
  bank_code: string;
  bank_name: string;
}

/**
 * Phase 2B — Driver bank / subaccount submission.
 */
export interface IDriverOnboardingRequest {
  email: string;
  settlement_bank_name: string;
  settlement_bank_code: string;
  settlement_account_number: string;
}

/**
 * Response shape for GET /api/v1/onboarding/status
 * Derives the user's current state from existing records (no schema change).
 */
export interface IOnboardingStatusResponse {
  role: 'passenger' | 'driver';
  phase: 'role_onboarding' | 'completed';
  next_step:
    | 'passenger_kyc'
    | 'driver_bank'
    | 'driver_identity'
    | 'driver_vehicle'
    | null;
  completed: boolean;
  details?: Record<string, unknown>;
}

// ============================================
// OTP / PASSWORD / TOKEN TYPES
// ============================================

export interface IVerifyOTPRequest {
  phone_number: string;
  otp: string;
  purpose: 'registration' | 'login' | 'password_reset' | 'phone_change';
}

export interface IRefreshTokenRequest {
  refresh_token: string;
}

export interface IChangePasswordRequest {
  current_password: string;
  new_password: string;
}

export interface IResetPasswordRequest {
  phone_number: string;
}

export interface IResetPasswordConfirmRequest {
  phone_number: string;
  otp: string;
  new_password: string;
}

// ============================================
// AUTH RESPONSE
// tokens are only present after OTP verification
// onboarding is always present so the client knows what to do next
// ============================================

export interface IAuthResponse {
  user: {
    id: string;
    phone_number: string;
    email?: string;
    first_name: string;
    last_name: string;
    role: string;
    status: string;
  };
  tokens?: ITokens;
  onboarding: IOnboardingState;
}

// ============================================
// PASSENGER TYPES (UPDATED WITH KYC)
// ============================================

export interface IPassengerProfile {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  profile_photo_url?: string;
  date_of_birth?: string;
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  trust_score: number;
  total_rides: number;
  lifetime_spend: number;
  rating_as_passenger?: number;
  created_at: Date;
  updated_at: Date;
  virtual_account_id?: string;
  // ============================================
  // KYC FIELDS (V2.0)
  // ============================================
  bvn?: string;
  nin?: string;
  kyc_status: 'pending' | 'verified' | 'failed';
  kyc_verified_at?: Date;
  kyc_verified_by?: string;
  kyc_failure_reason?: string;
}

export interface ISavedLocation {
  id: string;
  passenger_id: string;
  label: string;
  address: string;
  latitude: number;
  longitude: number;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface IPassengerPreference {
  id: string;
  passenger_id: string;
  preferred_vehicle_type: 'standard' | 'premium' | 'executive';
  music_preference: 'quiet' | 'radio' | 'podcast' | 'any';
  conversation_preference: 'quiet' | 'friendly' | 'business' | 'any';
  max_wait_time: number;
  notify_promotions: boolean;
  notify_ride_updates: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ICreateSavedLocation {
  label: string;
  address: string;
  latitude: number;
  longitude: number;
  is_default?: boolean;
}

export interface IUpdatePassengerProfile {
  first_name?: string;
  last_name?: string;
  profile_photo_url?: string;
  date_of_birth?: string;
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
}

export interface IUpdatePassengerPreference {
  preferred_vehicle_type?: 'standard' | 'premium' | 'executive';
  music_preference?: 'quiet' | 'radio' | 'podcast' | 'any';
  conversation_preference?: 'quiet' | 'friendly' | 'business' | 'any';
  max_wait_time?: number;
  notify_promotions?: boolean;
  notify_ride_updates?: boolean;
}

// ============================================
// DRIVER TYPES (UPDATED WITH SUBACCOUNT FIELDS)
// ============================================

export interface IDriverProfile {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  profile_photo_url?: string;
  date_of_birth?: string | Date;
  driver_license_number?: string;
  driver_license_expiry?: string;
  driver_status: 'pending' | 'under_review' | 'approved' | 'active' | 'suspended' | 'rejected' | 'deactivated';
  availability_status: 'online' | 'offline' | 'on_trip' | 'unavailable';
  rating_average?: number;
  total_rides: number;
  total_earnings: number;
  acceptance_rate: number;
  completion_rate: number;
  kyc_status: 'pending' | 'under_review' | 'approved' | 'rejected' | 'suspended';
  address?: string;
  state_of_origin?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  hygiene_score?: number;
  vehicle_cleanliness_score?: number;
  drive_quality_score?: number;
  overall_quality_badge?: string;
  insurance_status?: string;
  insurance_expiry?: string;
  has_air_conditioning?: boolean;
  has_working_stereo?: boolean;
  interior_air_freshener?: boolean;
  kyc_approved_at?: string;
  kyc_rejected_reason?: string;
  is_online: boolean;
  last_online_at?: string;
  last_location_latitude?: number;
  last_location_longitude?: number;
  last_location_update?: string;
  max_trips_per_day?: number;
  max_distance_per_day?: number;
  vehicle_id?: string;
  created_at: Date;
  updated_at: Date;
  // ============================================
  // SUBACCOUNT FIELDS (Phase 2B)
  // ============================================
  subaccount_code?: string;
  bank_code?: string;
  account_number?: string;
  account_name?: string;
  subaccount_created_at?: Date;
  subaccount_status?: 'pending' | 'active' | 'failed';

  // ============================================
  // IDENTITY KYC FIELDS (Phase 2C — manual review)
  // ============================================
  license_verified?: boolean;
  license_verification_provider?: string | null;
  license_verified_at?: Date | null;
  license_expiry_date?: string | null;
  license_photo_url?: string | null;
  license_back_url?: string | null;
  license_state_of_issue?: string | null;

  nin?: string | null;
  nin_id_card_url?: string | null;
  nin_verified?: boolean;

  bvn?: string | null;
  bvn_verified?: boolean;

  selfie_url?: string | null;

  liveness_check_required?: boolean;
  last_liveness_check_at?: Date | null;
  liveness_check_failures?: number;

  identity_fully_verified?: boolean;
  identity_verified_at?: Date | null;
  identity_submitted_at?: Date | null;
  identity_reviewed_at?: Date | null;
  identity_reviewed_by?: string | null;
  identity_review_notes?: string | null;
}

export interface IVehicle {
  id: string;
  driver_id: string;
  registration_number: string;
  make: string;
  model: string;
  year?: number;
  colour?: string;
  vehicle_type: 'standard' | 'premium' | 'executive' | 'luxury';
  status: 'active' | 'pending_approval' | 'suspended' | 'deactivated' | 'rejected';
  is_primary: boolean;
  seat_count: number;
  registration_document_url?: string;
  insurance_document_url?: string;
  roadworthiness_document_url?: string;
  registration_expiry?: string;
  insurance_expiry?: string;
  roadworthiness_expiry?: string;
  created_at: Date;
  updated_at: Date;

  // ============================================
  // VEHICLE COMPLIANCE KYC FIELDS (Phase 2D — manual review)
  // ============================================
  plate_verified?: boolean;
  plate_verification_provider?: string | null;
  plate_verified_at?: Date | null;
  plate_owner_name?: string | null;
  plate_owner_match?: boolean | null;
  plate_vehicle_make?: string | null;
  plate_vehicle_model?: string | null;
  plate_vehicle_vin?: string | null;

  poc_document_url?: string | null;
  poc_verified?: boolean;

  vehicle_license_url?: string | null;
  vehicle_license_verified?: boolean;

  roadworthiness_verified?: boolean;
  roadworthiness_verified_at?: Date | null;
  roadworthiness_verified_by?: string | null;

  hackney_permit_url?: string | null;
  hackney_permit_verified?: boolean;
  hackney_permit_expiry?: string | null;
  hackney_permit_verified_at?: Date | null;
  hackney_permit_verified_by?: string | null;

  insurance_verified?: boolean;
  insurance_policy_number?: string | null;
  insurance_provider?: string | null;
  insurance_verification_method?: 'api' | 'manual' | null;
  insurance_verified_at?: Date | null;
  insurance_verified_by?: string | null;

  compliance_fully_verified?: boolean;
  compliance_verified_at?: Date | null;
  compliance_submitted_at?: Date | null;
  compliance_reviewed_at?: Date | null;
  compliance_reviewed_by?: string | null;
  compliance_notes?: string | null;
}

export interface IDriverDocument {
  id: string;
  driver_id: string;
  document_type: 'national_id' | 'passport' | 'driver_license' | 'utility_bill' | 'profile_photo' | 'insurance' | 'vehicle_registration' | 'roadworthiness';
  document_number?: string;
  document_url: string;
  expiry_date?: string;
  verification_status: 'pending' | 'verified' | 'rejected' | 'expired';
  verification_notes?: string;
  verified_at?: string;
  verified_by?: string;
  created_at: Date;
  updated_at: Date;
}

export interface IKYCVerification {
  id: string;
  driver_id: string;
  verification_status: 'pending' | 'under_review' | 'approved' | 'rejected' | 'expired';
  verification_provider?: string;
  verified_at?: string;
  rejection_reason?: string;
  created_at: Date;
  updated_at: Date;
}

// ============================================
// PHASE 1 DRIVER PROFILE CREATION
// ============================================

export interface ICreateDriverProfile {
  first_name: string;
  last_name: string;
  profile_photo_url?: string;
  date_of_birth?: string;
  driver_license_number?: string;
  driver_license_expiry?: string;
  address?: string;
  state_of_origin?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  has_air_conditioning?: boolean;
  has_working_stereo?: boolean;
  interior_air_freshener?: boolean;
  bank_code?: string;
  account_number?: string;
}

export interface ICreateVehicle {
  registration_number: string;
  make: string;
  model: string;
  year?: number;
  colour?: string;
  vehicle_type: 'standard' | 'premium' | 'executive' | 'luxury';
  is_primary?: boolean;
  seat_count?: number;
  registration_document_url?: string;
  insurance_document_url?: string;
  roadworthiness_document_url?: string;
  registration_expiry?: string;
  insurance_expiry?: string;
  roadworthiness_expiry?: string;
}

export interface IUpdateDriverProfile {
  first_name?: string;
  last_name?: string;
  profile_photo_url?: string;
  date_of_birth?: string;
  driver_license_number?: string;
  driver_license_expiry?: string;
  address?: string;
  state_of_origin?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  has_air_conditioning?: boolean;
  has_working_stereo?: boolean;
  interior_air_freshener?: boolean;
  bank_code?: string;
  account_number?: string;
  account_name?: string;
}

export interface IDriverLocation {
  driver_id: string;
  latitude: number;
  longitude: number;
  speed_kmh?: number;
  heading?: number;
  accuracy_meters?: number;
}

// ============================================
// RIDE TYPES (EXISTING - UNCHANGED)
// ============================================

export interface IRideRequest {
  id: string;
  passenger_id: string;
  pickup_latitude: number;
  pickup_longitude: number;
  pickup_address: string;
  destination_latitude: number;
  destination_longitude: number;
  destination_address: string;
  vehicle_type: 'standard' | 'premium' | 'executive';
  estimated_distance_km: number;
  estimated_duration_min: number;
  estimated_fare?: number;
  status: 'pending' | 'bidding' | 'assigned' | 'expired' | 'cancelled';
  bidding_started_at?: Date;
  bidding_ends_at?: Date;
  bidding_duration_seconds: number;
  selected_driver_id?: string;
  selected_bid_id?: string;
  cancelled_by?: 'passenger' | 'driver' | 'system';
  cancelled_at?: Date;
  cancellation_reason?: string;
  timezone_id?: string;
  created_at: Date;
  updated_at: Date;
}

export interface IRideBid {
  id: string;
  ride_id: string;
  driver_id: string;
  bid_amount: number;
  eta_minutes: number;
  driver_notes?: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired' | 'cancelled';
  rank?: number;
  selected_at?: Date;
  expired_at?: Date;
  created_at: Date;
  updated_at: Date;
  driver_first_name?: string;
  driver_last_name?: string;
  driver_rating?: number;
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_colour?: string;
  vehicle_registration?: string;
  score?: number;
}

export interface IRide {
  id: string;
  ride_request_id: string;
  driver_id: string;
  passenger_id: string;
  bid_id: string;
  bid_amount: number;
  status: 'confirmed' | 'driver_en_route' | 'driver_arrived' | 'ride_started' | 'ride_in_progress' | 'ride_completed' | 'cancelled' | 'disputed' | 'requested' | 'bidding' | 'bid_selected' | 'expired' | 'failed';
  pickup_latitude: number;
  pickup_longitude: number;
  pickup_address: string;
  destination_latitude: number;
  destination_longitude: number;
  destination_address: string;
  timezone_id?: string;
  final_distance_km?: number;
  duration_minutes?: number;
  driver_arrived_at?: Date;
  started_at?: Date;
  completed_at?: Date;
  cancelled_at?: Date;
  cancelled_by?: 'passenger' | 'driver' | 'system';
  cancellation_reason?: string;
  dispute_initiated_at?: Date;
  dispute_resolved_at?: Date;
  dispute_outcome?: string;
  programme_period_id?: string;
  ride_eligible_for_qualification?: boolean;
  qualification_exclusion_reason?: string;
  fraud_review_status?: string;
  rebate_contribution_amount?: number;
  rebate_credit_used_amount?: number;
  created_at: Date;
  updated_at: Date;
}

export interface ICreateRideRequest {
  pickup_latitude: number;
  pickup_longitude: number;
  pickup_address: string;
  destination_latitude: number;
  destination_longitude: number;
  destination_address: string;
  vehicle_type?: 'standard' | 'premium' | 'executive';
}

export interface ICreateBid {
  ride_request_id: string;
  driver_id: string;
  bid_amount: number;
  eta_minutes: number;
  driver_notes?: string;
}

export interface IRideStatusUpdate {
  ride_id: string;
  status: 'confirmed' | 'driver_en_route' | 'driver_arrived' | 'ride_started' | 'ride_in_progress' | 'ride_completed' | 'cancelled' | 'failed' | 'expired' | 'requested' | 'bidding' | 'bid_selected';
  latitude?: number;
  longitude?: number;
  notes?: string;
}

export interface IBidRankingResult {
  bid_id: string;
  driver_id: string;
  bid_amount: number;
  eta_minutes: number;
  driver_rating: number;
  vehicle_type: string;
  acceptance_rate: number;
  score: number;
  rank: number;
}

// ============================================
// V2.0 INCENTIVE ECOSYSTEM TYPES
// ============================================

export interface IProgrammePeriod {
  id: string;
  year: number;
  start_date: Date;
  end_date: Date;
  passenger_threshold: number;
  driver_threshold: number;
  winner_cap_percentage: number;
  individual_reward_cap: number | null;
  rebate_contribution_rate: number;
  profit_pool_percentage: number;
  status: 'draft' | 'active' | 'closed' | 'archived';
  active_passenger_count: number;
  active_driver_count: number;
  opened_at?: Date;
  closed_at?: Date;
  archived_at?: Date;
  created_at: Date;
  updated_at: Date;
  created_by?: string;
  updated_by?: string;
}

export interface ICreateProgrammePeriod {
  year: number;
  start_date: Date | string;
  end_date: Date | string;
  passenger_threshold?: number;
  driver_threshold?: number;
  winner_cap_percentage?: number;
  individual_reward_cap?: number | null;
  rebate_contribution_rate?: number;
  profit_pool_percentage?: number;
  status?: 'draft' | 'active' | 'closed' | 'archived';
  created_by?: string;
}

export type QualificationStatus = 'not_started' | 'in_progress' | 'qualified' | 'excluded';
export type FraudReviewStatus = 'clean' | 'under_review' | 'excluded';

export interface IPassengerQualification {
  id: string;
  passenger_id: string;
  programme_period_id: string;
  eligible_annual_spend: number;
  qualification_date?: Date;
  qualification_status: QualificationStatus;
  rank_position?: number;
  winner_selected: boolean;
  rebate_allocated: number;
  rebate_credited: boolean;
  fraud_review_status: FraudReviewStatus;
  fraud_review_notes?: string;
  last_progress_update?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface IDriverQualification {
  id: string;
  driver_id: string;
  programme_period_id: string;
  qualifying_contribution: number;
  qualification_date?: Date;
  qualification_status: QualificationStatus;
  rank_position?: number;
  winner_selected: boolean;
  profit_share_allocated: number;
  profit_share_paid: boolean;
  fraud_review_status: FraudReviewStatus;
  fraud_review_notes?: string;
  last_progress_update?: Date;
  created_at: Date;
  updated_at: Date;
}

export type PINGRIDELetterChar = 'P' | 'I' | 'N' | 'G' | 'R' | 'I' | 'D' | 'E';

export interface IPINGRIDELetter {
  position: number;
  char: PINGRIDELetterChar;
  thresholdMin: number;
  thresholdMax: number;
  isCompleted: boolean;
  achievedAt?: Date;
}

export interface IPINGRIDEProgress {
  userId: string;
  userType: 'passenger' | 'driver';
  programmePeriodId: string;
  letters: IPINGRIDELetter[];
  overallProgress: number;
  threshold: number;
  currentValue: number;
  isComplete: boolean;
  completedAt?: Date;
  nextMilestone?: IPINGRIDELetter | null;
}

export interface IPassengerPINGRIDEProgress {
  passenger_id: string;
  programme_period_id: string;
  letter_position: number;
  letter_char: PINGRIDELetterChar;
  is_completed: boolean;
  progress_percentage: number;
  cumulative_spend_at_milestone?: number;
  achieved_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface IDriverPINGRIDEProgress {
  driver_id: string;
  programme_period_id: string;
  letter_position: number;
  letter_char: PINGRIDELetterChar;
  is_completed: boolean;
  progress_percentage: number;
  cumulative_contribution_at_milestone?: number;
  achieved_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface IRebateFundBalance {
  id: string;
  programme_period_id: string;
  total_contributions: number;
  total_allocated: number;
  total_credited: number;
  total_utilised: number;
  total_expired: number;
  current_balance: number;
  reserved_amount: number;
  last_calculation_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface IRebateFundContribution {
  id: string;
  ride_id: string;
  programme_period_id: string;
  passenger_id: string;
  contribution_amount: number;
  fare_amount: number;
  contribution_percentage: number;
  ride_eligible: boolean;
  excluded_reason?: string;
  created_at: Date;
}

export interface IRebateAllocation {
  id: string;
  passenger_id: string;
  programme_period_id: string;
  qualification_registry_id: string;
  eligible_annual_spend: number;
  provisional_allocation: number;
  individual_cap_applied?: number;
  final_allocation: number;
  fund_sufficiency_applied: boolean;
  allocation_status: 'pending' | 'approved' | 'distributed' | 'expired';
  approved_at?: Date;
  distributed_at?: Date;
  expires_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface IRebateCredit {
  id: string;
  passenger_id: string;
  allocation_id: string;
  credit_amount: number;
  used_amount: number;
  remaining_amount: number;
  expires_at?: Date;
  status: 'active' | 'used' | 'expired' | 'cancelled';
  issued_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface IRebateCreditUsage {
  id: string;
  credit_id: string;
  ride_id: string;
  passenger_id: string;
  amount_used: number;
  fare_amount: number;
  created_at: Date;
}

export interface IWinner {
  id: string;
  user_id: string;
  user_type: 'passenger' | 'driver';
  programme_period_id: string;
  qualification_registry_id: string;
  eligible_value: number;
  rank_position: number;
  selected_date: Date;
  status: 'active' | 'disqualified' | 'paid';
  disqualification_reason?: string;
  replacement_winner_id?: string;
  created_at: Date;
  updated_at: Date;
}

export interface IWinnerSelectionResult {
  userType: 'passenger' | 'driver';
  programmePeriodId: string;
  totalActiveUsers: number;
  winnerCapacity: number;
  totalQualified: number;
  oversubscribed: boolean;
  winners: IWinner[];
  status: 'no_qualified' | 'all_selected' | 'selected_by_ranking';
}

export interface IDriverProfitPool {
  id: string;
  programme_period_id: string;
  eligible_net_profit: number;
  pool_percentage: number;
  total_pool_amount: number;
  number_of_winners: number;
  individual_allocation?: number;
  approved_at?: Date;
  distributed_at?: Date;
  status: 'pending' | 'approved' | 'distributed' | 'closed';
  created_at: Date;
  updated_at: Date;
}

export interface IDriverProfitAllocation {
  id: string;
  driver_id: string;
  programme_period_id: string;
  pool_id: string;
  qualification_registry_id: string;
  qualifying_contribution: number;
  provisional_allocation: number;
  deductions_applied: number;
  final_payout: number;
  paid: boolean;
  paid_at?: Date;
  payment_reference?: string;
  created_at: Date;
  updated_at: Date;
}

export type FraudCaseType =
  | 'collusion'
  | 'ghost_ride'
  | 'gps_spoofing'
  | 'payment_fraud'
  | 'account_abuse'
  | 'qualification_velocity'
  | 'other';

export type FraudSeverity = 'low' | 'medium' | 'high' | 'critical';
export type FraudCaseStatus = 'detected' | 'investigating' | 'confirmed' | 'dismissed' | 'resolved';

export interface IFraudSignal {
  type: FraudCaseType;
  description: string;
  confidence: number;
  evidence: any;
  timestamp: Date;
}

export interface IFraudDetectionResult {
  userId: string;
  userType: 'passenger' | 'driver';
  rideId?: string;
  signals: IFraudSignal[];
  suspicionScore: number;
  severity: FraudSeverity;
  recommendedAction: 'monitor' | 'investigate' | 'exclude' | 'immediate_action';
  isFraudulent: boolean;
}

export interface IFraudCase {
  id: string;
  programme_period_id: string;
  case_type: FraudCaseType;
  passenger_id?: string;
  driver_id?: string;
  ride_ids?: string[];
  suspicion_score: number;
  description?: string;
  evidence?: any;
  severity: FraudSeverity;
  status: FraudCaseStatus;
  detected_at: Date;
  investigated_at?: Date;
  resolved_at?: Date;
  investigated_by?: string;
  resolved_by?: string;
  resolution_notes?: string;
  created_at: Date;
  updated_at: Date;
}

export type ExclusionType = 'qualification_reversal' | 'winner_disqualification' | 'programme_ban' | 'temporary_suspension';

export interface IQualificationExclusion {
  id: string;
  programme_period_id: string;
  user_type: 'passenger' | 'driver';
  user_id: string;
  fraud_case_id?: string;
  exclusion_type: ExclusionType;
  exclusion_reason: string;
  affected_amount?: number;
  reversed: boolean;
  reversed_at?: Date;
  reversed_by?: string;
  created_at: Date;
  updated_at: Date;
}

export interface IPassengerQualificationResponse {
  period: IProgrammePeriod | null;
  qualification: IPassengerQualification | null;
  progress: IPINGRIDEProgress | null;
  threshold: number;
  isQualified: boolean;
  eligibleSpend: number;
  remaining: number;
}

export interface IDriverQualificationResponse {
  period: IProgrammePeriod | null;
  qualification: IDriverQualification | null;
  progress: IPINGRIDEProgress | null;
  threshold: number;
  isQualified: boolean;
  qualifyingContribution: number;
  remaining: number;
}

export interface IRecordContributionRequest {
  rideId: string;
  passengerId: string;
  fareAmount: number;
}

export interface IRecordContributionResponse {
  recorded: boolean;
  contributionAmount: number;
  fareAmount: number;
  rate: number;
  reason?: string;
}

export interface IAllocateRebatesRequest {
  programmePeriodId: string;
  winnerIds: string[];
}

export interface IRebateAllocationResponse {
  passengerId: string;
  provisionalAllocation: number;
  individualCapApplied: number;
  finalAllocation: number;
  fundSufficiencyApplied: boolean;
}

export interface ISelectWinnersRequest {
  programmePeriodId: string;
  userType: 'passenger' | 'driver';
  manualOverride?: boolean;
  overrideWinnerIds?: string[];
}

export interface IWinnerSelectionResponse {
  period: IProgrammePeriod | null;
  activeCount: number;
  capacity: number;
  qualifiedCount: number;
  oversubscribed: boolean;
  winners: IWinner[];
  status: 'no_qualified' | 'all_selected' | 'selected_by_ranking';
}

export interface IDetectFraudRequest {
  userId: string;
  userType: 'passenger' | 'driver';
  rideHistory?: IRide[];
}

export interface ICreateFraudCaseRequest {
  programmePeriodId: string;
  caseType: FraudCaseType;
  userId: string;
  userType: 'passenger' | 'driver';
  suspicionScore: number;
  description?: string;
  evidence?: any;
  rideIds?: string[];
}

export interface IResolveFraudCaseRequest {
  caseId: string;
  status: 'confirmed' | 'dismissed' | 'resolved';
  resolutionNotes?: string;
  action?: 'exclude' | 'reverse_qualification' | 'disqualify_winner' | 'none';
}

// ============================================
// PHASE 2C — DRIVER IDENTITY KYC TYPES (MANUAL REVIEW)
// ============================================

export interface IDriverIdentitySubmission {
  license_number: string;
  license_expiry_date: string;
  license_front_url: string;
  license_back_url: string;

  nin: string;
  nin_id_card_url: string;

  bvn: string;

  date_of_birth: string;

  selfie_url: string;
}

export interface IDriverIdentityStatusResponse {
  submission_status: 'not_submitted' | 'pending_admin_review' | 'approved' | 'rejected';
  license_verified: boolean;
  nin_verified: boolean;
  bvn_verified: boolean;
  identity_fully_verified: boolean;
  needs_recheck: boolean;
  rejection_reason?: string | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  next_step: 'driver_identity' | 'driver_vehicle' | 'completed' | null;
}

// ============================================
// PHASE 2D — VEHICLE COMPLIANCE KYC TYPES (MANUAL REVIEW)
// ============================================

export interface IVehicleComplianceSubmission {
  vehicle_id: string;
  plate_number: string;

  poc_document_url: string;
  vehicle_license_url: string;
  roadworthiness_document_url: string;
  hackney_permit_url: string;
  insurance_document_url: string;

  insurance_policy_number: string;
  insurance_provider?: string;
  insurance_expiry?: string;
}

export interface IVehicleComplianceStatusResponse {
  submission_status: 'not_submitted' | 'pending_admin_review' | 'approved' | 'rejected';
  plate_verified: boolean;
  poc_verified: boolean;
  vehicle_license_verified: boolean;
  roadworthiness_verified: boolean;
  hackney_permit_verified: boolean;
  insurance_verified: boolean;
  compliance_fully_verified: boolean;
  rejection_reason?: string | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  next_step: 'driver_identity' | 'driver_vehicle' | 'completed' | null;
}

export interface IIdentityReviewRequest {
  decision: 'approve' | 'reject';
  notes?: string;
  license_verified?: boolean;
  nin_verified?: boolean;
  bvn_verified?: boolean;
}

export interface IVehicleDocumentReviewRequest {
  document_type:
    | 'poc'
    | 'vehicle_license'
    | 'roadworthiness'
    | 'hackney_permit'
    | 'insurance';
  decision: 'approve' | 'reject';
  notes?: string;
}

export interface IAdminReviewQueueItem {
  driver_id: string;
  driver_user_id: string;
  first_name: string;
  last_name: string;
  phone_number: string;
  email?: string;
  submission_type: 'identity' | 'vehicle';
  submitted_at: Date;
  status: 'pending_admin_review' | 'approved' | 'rejected';
  payload: Record<string, unknown>;
}

export interface IAdminReviewQueueResponse {
  items: IAdminReviewQueueItem[];
  total: number;
  page: number;
  limit: number;
}

// ============================================
// CONSENT TYPES (NDPA)
// ============================================

export type ConsentType =
  | 'terms_of_service'
  | 'privacy_policy'
  | 'kyc_data_sharing'
  | 'liveness_capture';

export interface IUserConsent {
  id: string;
  user_id: string;
  consent_type: ConsentType;
  consent_version: string;
  granted: boolean;
  ip_address?: string;
  user_agent?: string;
  metadata?: Record<string, unknown>;
  created_at: Date;
  revoked_at?: Date;
}

export interface IRecordConsentRequest {
  consent_type: ConsentType;
  consent_version: string;
}

// ============================================
// PAYMENT & WALLET TYPES
// ============================================

export * from './payment.types';