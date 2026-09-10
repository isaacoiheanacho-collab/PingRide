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
// AUTH TYPES (UPDATED WITH DRIVER FIELDS)
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

export interface IRegisterRequest {
  phone_number: string;
  email?: string;
  password: string;
  first_name: string;
  last_name: string;
  user_type: 'passenger' | 'driver';
  // ============================================
  // KYC FIELDS
  // ============================================
  profile_photo_url?: string;      // Passport photo or profile picture
  date_of_birth?: string;          // Date of birth (YYYY-MM-DD)
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  bvn?: string;                    // Bank Verification Number (for KYC)
  nin?: string;                    // National Identification Number (for KYC)
  // ============================================
  // DRIVER-SPECIFIC FIELDS (for driver registration)
  // ============================================
  driver_license_number?: string;  // Driver's license number
  driver_license_expiry?: string;  // Driver's license expiry date
  address?: string;                // Driver's address
  state_of_origin?: string;        // Driver's state of origin
  emergency_contact_name?: string; // Emergency contact name
  emergency_contact_phone?: string;// Emergency contact phone
  has_air_conditioning?: boolean;  // Vehicle has AC
  has_working_stereo?: boolean;    // Vehicle has working stereo
  interior_air_freshener?: boolean;// Vehicle has air freshener
  // ============================================
  // BANK DETAILS (for driver subaccount creation)
  // ============================================
  bank_code?: string;              // Bank code (e.g., 058 for GTBank)
  account_number?: string;         // Driver's bank account number
}

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
  tokens: ITokens;
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
  // NEW: KYC FIELDS (V2.0)
  // ============================================
  bvn?: string;                         // BVN for KYC verification
  nin?: string;                         // NIN for KYC verification
  kyc_status: 'pending' | 'verified' | 'failed';  // KYC status
  kyc_verified_at?: Date;               // When KYC was verified
  kyc_verified_by?: string;             // Admin who verified
  kyc_failure_reason?: string;          // Why KYC failed
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
  date_of_birth?: string;
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
  // NEW: SUBACCOUNT FIELDS (Phase 5)
  // ============================================
  subaccount_code?: string;                 // Paystack subaccount code (ACCT_xxxxxxxxxx)
  bank_code?: string;                       // Bank code (e.g., 058 for GTBank)
  account_number?: string;                  // Driver's bank account number
  account_name?: string;                    // Driver's account name (verified from Paystack)
  subaccount_created_at?: Date;             // When subaccount was created
  subaccount_status?: 'pending' | 'active' | 'failed';  // Subaccount status
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

export interface ICreateDriverProfile {
  first_name: string;
  last_name: string;
  profile_photo_url?: string;
  date_of_birth?: string;
  driver_license_number: string;
  driver_license_expiry: string;
  address?: string;
  state_of_origin?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  has_air_conditioning?: boolean;
  has_working_stereo?: boolean;
  interior_air_freshener?: boolean;
  // ============================================
  // NEW: BANK DETAILS FOR SUBACCOUNT CREATION
  // ============================================
  bank_code?: string;                       // Bank code for subaccount
  account_number?: string;                  // Account number for subaccount
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
  // ============================================
  // NEW: BANK DETAILS UPDATE
  // ============================================
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

// ============================================
// 1. Programme Period Types
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

// ============================================
// 2. Passenger Qualification Types
// ============================================

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

// ============================================
// 3. PINGRIDE Progress Types
// ============================================

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

// ============================================
// 4. Rebate Fund Types
// ============================================

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

// ============================================
// 5. Winner Types
// ============================================

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

// ============================================
// 6. Driver Profit Pool Types
// ============================================

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

// ============================================
// 7. Fraud Detection Types (UPDATED)
// ============================================

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

// ============================================
// 8. Exclusion Types
// ============================================

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

// ============================================
// 9. Qualification Response Types
// ============================================

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

// ============================================
// 10. Rebate Request/Response Types
// ============================================

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

// ============================================
// 11. Winner Request/Response Types
// ============================================

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

// ============================================
// 12. Fraud Detection Request/Response Types
// ============================================

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
// PAYMENT & WALLET TYPES
// ============================================

export * from './payment.types';