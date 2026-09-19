PingRide Backend — Complete API Documentation
Base URL: http://localhost:4000/api/v1
All request bodies are JSON. All responses use this envelope:

json
{
  "success": true,
  "data": { ... },
  "meta": { "timestamp": "ISO8601", "message": "optional", "pagination": {...} }
}
Error responses:

json
{
  "success": false,
  "error": { "code": "ERROR_CODE", "message": "human readable", "details": {...} }
}
Auth: Authorization: Bearer <accessToken> on every protected route.

1. AUTH — /api/v1/auth
Method	Path	Auth	Body / Query	Response
POST	/register	public	{ first_name, last_name, phone_number, password, user_type }	{ user, onboarding } — no tokens yet
POST	/verify-otp	public	{ phone_number, otp, purpose? }	{ success, user, tokens, onboarding }
POST	/resend-otp	public	{ phone_number, purpose? }	{ success, message }
POST	/login	public	{ phone_number, password, device_id?, device_type? }	{ user, tokens, onboarding }
POST	/refresh	public	{ refresh_token }	{ accessToken, expiresIn }
POST	/reset-password	public	{ phone_number }	{ success, message }
POST	/reset-password-confirm	public	{ phone_number, otp, new_password }	{ success, message }
POST	/logout	verified	—	{ success }
POST	/change-password	verified	{ current_password, new_password }	{ success }
Register body constraint: phone must match ^\+234[0-9]{10}$. Password must have upper, lower, digit, and special char, min 8.

Login behaviour: accepts pending_verification and active users. Rejects suspended, deactivated, locked. A pending user gets a real token and an onboarding.next_step = "verify_otp", but every money/ride route will refuse them via requireVerified.

2. USERS — /api/v1/users
Method	Path	Auth	Body / Query	Notes
GET	/profile	any authenticated	—	own profile + passenger profile
PATCH	/profile	any authenticated	{ first_name?, last_name?, email?, preferred_language?, profile_photo_url?, date_of_birth?, gender? }	partial update
GET	/admin/users	admin	?page&limit&status&role&search	paginated
GET	/admin/users/search	admin	?q&page&limit	q min 2 chars
GET	/admin/users/:id	admin	—	by user id
PATCH	/admin/users/:id/status	admin	{ status, reason? }	status ∈ active, suspended, deactivated, locked
DELETE	/admin/users/:id	admin	—	soft delete
3. PASSENGER — /api/v1/passenger
All routes: any authenticated user.

Method	Path	Body / Query
GET	/profile	—
PATCH	/profile	{ first_name?, last_name?, profile_photo_url?, date_of_birth?, gender? }
GET	/preferences	—
PATCH	/preferences	{ preferred_vehicle_type?, music_preference?, conversation_preference?, max_wait_time?, notify_promotions?, notify_ride_updates? }
GET	/stats	—
GET	/locations	—
POST	/locations	{ label, address, latitude, longitude, is_default? }
PATCH	/locations/:id	partial location body
DELETE	/locations/:id	—
4. ONBOARDING — /api/v1/onboarding
Method	Path	Auth	Body
GET	/status	any authenticated	— (the one onboarding route NOT gated by verification)
POST	/driver/bank	verified driver	{ email, settlement_bank_name, settlement_bank_code, settlement_account_number }
GET /status returns:

json
{
  "role": "passenger" | "driver",
  "phase": "awaiting_otp" | "role_onboarding" | "completed",
  "next_step": "verify_otp" | "passenger_kyc" | "driver_bank" | "driver_identity" | "driver_vehicle" | null,
  "completed": boolean,
  "details": { ... }
}
5. ONBOARDING CONSENT — /api/v1/onboarding/consent
Verified users only.

Method	Path	Body
POST	/	{ consent_type, consent_version }
GET	/	—
consent_type ∈ terms_of_service, privacy_policy, kyc_data_sharing, liveness_capture.
consent_version 1–20 chars.

GET response:

json
{ "terms_of_service": bool, "privacy_policy": bool, "kyc_data_sharing": bool, "liveness_capture": bool }
6. DRIVER IDENTITY KYC — /api/v1/onboarding/driver/identity
Verified drivers only. Requires kyc_data_sharing consent first.

Method	Path	Body
POST	/	{ license_number, license_expiry_date, license_front_url, license_back_url, nin, nin_id_card_url, bvn, date_of_birth, selfie_url }
GET	/status	—
POST response — the identity status after submission:

json
{
  "submission_status": "pending_admin_review",
  "license_verified": false,
  "nin_verified": false,
  "bvn_verified": false,
  "identity_fully_verified": false,
  "needs_recheck": false,
  "rejection_reason": null,
  "submitted_at": "ISO8601",
  "reviewed_at": null,
  "next_step": "driver_identity"
}
7. VEHICLE COMPLIANCE — /api/v1/onboarding/driver/vehicle
Verified drivers only. Requires kyc_data_sharing consent first.

Method	Path	Body
POST	/	{ vehicle_id, plate_number, poc_document_url, vehicle_license_url, roadworthiness_document_url, hackney_permit_url, insurance_document_url, insurance_policy_number, insurance_provider?, insurance_expiry? }
GET	/status	?vehicleId optional — falls back to primary vehicle
GET response:

json
{
  "submission_status": "pending_admin_review",
  "plate_verified": false,
  "poc_verified": false,
  "vehicle_license_verified": false,
  "roadworthiness_verified": false,
  "hackney_permit_verified": false,
  "insurance_verified": false,
  "compliance_fully_verified": false,
  "rejection_reason": null,
  "submitted_at": "ISO8601",
  "reviewed_at": null,
  "next_step": "driver_vehicle"
}
8. DRIVER — /api/v1/driver
All routes authenticated. requireVerified() is called out per route.

Profile & banks
Method	Path	Verified	Body
GET	/profile	—	—
POST	/profile	✅	{ first_name, last_name, driver_license_number, driver_license_expiry, profile_photo_url?, date_of_birth?, address?, state_of_origin?, emergency_contact_*?, has_air_conditioning?, has_working_stereo?, interior_air_freshener?, bank_code?, account_number? }
PATCH	/profile	✅	partial
GET	/banks	—	—
GET	/banks/popular	—	—
POST	/validate-bank	—	{ bank_code, account_number }
GET	/bank-details	—	—
POST	/bank-details	✅	{ bank_code, account_number }
GET	/subaccount	—	—
Vehicles
Method	Path	Verified	Body
GET	/vehicles	—	—
POST	/vehicles	✅	{ registration_number, make, model, vehicle_type, year?, colour?, is_primary?, seat_count?, registration_document_url?, insurance_document_url?, roadworthiness_document_url?, registration_expiry?, insurance_expiry?, roadworthiness_expiry? }
PATCH	/vehicles/:vehicleId	✅	partial
DELETE	/vehicles/:vehicleId	✅	—
Availability & location
Method	Path	Verified	Body
POST	/online	✅	{ latitude?, longitude? }
POST	/offline	✅	—
POST	/location	✅	{ latitude, longitude, speed_kmh?, heading?, accuracy_meters? }
POST /online gates: no active suspension → KYC approved → driver_status active → Phase 2C identity verified → Phase 2D vehicle compliance verified.

KYC documents (legacy)
Method	Path	Verified	Body
GET	/kyc	—	—
GET	/documents	—	—
POST	/documents	✅	{ document_type, document_url, document_number?, expiry_date? }
Admin (driver)
Method	Path	Body
PATCH	/admin/kyc/:driverId/approve	—
PATCH	/admin/kyc/:driverId/reject	{ reason }
GET	/admin/active	—
GET	/admin/near	?latitude&longitude&radius
GET	/admin/no-subaccount	—
POST	/admin/batch-subaccount	{ driver_ids: string[] }
POST	/admin/retry-subaccount/:driverId	—
9. ADMIN KYC REVIEW — /api/v1/admin/kyc
Requires admin or operations role. All routes verified + authorized.

Method	Path	Body
GET	/identity/pending	?page&limit
PATCH	/identity/:driverId/review	{ decision: 'approve'|'reject', notes?, license_verified?, nin_verified?, bvn_verified? }
GET	/vehicle/pending	?page&limit
PATCH	/vehicle/:vehicleId/documents/:documentType/review	{ decision: 'approve'|'reject', notes? }
documentType ∈ poc, vehicle_license, roadworthiness, hackney_permit, insurance.

decision = 'approve' on identity requires license_verified, nin_verified, bvn_verified all true.

10. RIDES — /api/v1/rides
All routes verified.

Method	Path	Body
POST	/requests	{ pickup_latitude, pickup_longitude, pickup_address, destination_latitude, destination_longitude, destination_address, vehicle_type? }
GET	/requests/:rideRequestId	—
GET	/requests/:rideRequestId/bids	—
POST	/bids	{ ride_request_id, bid_amount, eta_minutes, driver_notes? }
POST	/requests/:rideRequestId/bids/:bidId/select	—
GET	/:rideId	—
PATCH	/:rideId/status	{ status, latitude?, longitude?, notes? }
POST	/:rideId/cancel	{ reason? }
POST	/:rideId/pay	— initiates split payment
GET	/:rideId/pay/check	—
GET	/:rideId/payment-status	—
GET	/:rideId/full	—
GET	/driver/active	—
GET	/passenger/active	—
GET	/passenger/history	?page&limit
Valid status transitions for PATCH /:rideId/status:

text
confirmed       → driver_en_route | cancelled
driver_en_route → driver_arrived | cancelled
driver_arrived  → ride_started   | cancelled
ride_started    → ride_in_progress | cancelled
ride_in_progress → ride_completed | cancelled
11. MARKETPLACE — /api/v1/marketplace
All routes verified.

Method	Path	Body
POST	/request	same as rides request
GET	/requests/:rideRequestId	—
POST	/requests/:rideRequestId/bids/:bidId/select	—
GET	/passenger/active	—
POST	/bids	{ ride_request_id, bid_amount, eta_minutes, driver_notes? }
GET	/driver/active	—
GET	/eligible-drivers	?latitude&longitude&radius
12. PAYMENTS — /api/v1/payments
All routes verified except /config/status.

Method	Path	Body
POST	/initialize	{ ride_id, amount, payment_method: 'wallet', email? }
POST	/verify	{ reference }
POST	/process	{ payment_id, amount? }
POST	/:paymentId/refund	{ amount, reason }
GET	/passenger	?page&limit
GET	/driver	?page&limit
GET	/config/status	— (any authenticated)
GET	/:paymentId	—
GET	/:paymentId/details	—
GET	/admin/summary	admin only
GET	/admin/all	?page&limit&status&payment_method&payment_type&start_date&end_date admin only
payment_method is restricted to wallet by the Joi schema and by the service-layer guard.

13. WALLET — /api/v1/wallet
Read-only routes any authenticated user; write routes verified.

Method	Path	Verified	Body
GET	/balance	—	—
GET	/	—	—
GET	/summary	—	—
GET	/transactions	—	?page&limit
GET	/transactions/:transactionId	—	—
GET	/top-up-info	—	—
GET	/detailed	—	—
GET	/virtual-account	—	—
GET	/bank-transfers	—	?page&limit
POST	/freeze	✅	{ reason }
POST	/unfreeze	✅	—
GET	/driver/ledger	✅	—
GET	/driver/summary	✅	—
GET	/driver/transactions	✅	?page&limit
GET	/driver/withdrawals	✅	?page&limit
14. LEDGER — /api/v1/ledger
All read-only, verified.

Method	Path
GET	/driver
GET	/driver/summary
GET	/driver/transactions
GET	/driver/earnings
GET	/driver/commission
GET	/driver/withdrawals-total
GET	/admin/drivers (admin)
The driver-facing responses carry _note: "Informational only. Payments are automatic via Paystack subaccount." — the ledger is a display record, not a source of truth for money.

15. QUALIFICATION — /api/v1/qualification
Method	Path	Auth
GET	/passenger/progress	verified passenger
GET	/passenger/pingride	verified passenger
GET	/passenger/status	verified passenger
GET	/driver/progress	verified driver
GET	/driver/pingride	verified driver
GET	/driver/status	verified driver
GET	/admin/passengers	admin; ?periodId&page&limit
GET	/admin/drivers	admin; ?periodId&page&limit
GET	/admin/passengers/qualified	admin; ?periodId
GET	/admin/drivers/qualified	admin; ?periodId
GET	/admin/summary	admin; ?periodId
POST	/admin/exclude	admin; { user_id, user_type, programme_period_id, reason }
POST	/admin/reverse	admin; same as exclude
POST	/admin/passenger/mark-qualified	admin; { passenger_id, programme_period_id, spend_amount? }
POST	/admin/driver/mark-qualified	admin; { driver_id, programme_period_id, contribution_amount? }
16. REBATE — /api/v1/rebate
Method	Path	Auth
GET	/credits	any; ?status&page&limit
GET	/credits/balance	any
GET	/credits/active	any
GET	/credits/:creditId	any
GET	/admin/fund-balance	admin; ?periodId
GET	/admin/fund-summary	admin; ?periodId
GET	/admin/current-fund	admin
GET	/admin/contributions	admin; ?periodId&page&limit
GET	/admin/allocations	admin; ?periodId&page&limit
POST	/admin/allocations/approve	admin; { allocation_ids: string[] }
POST	/admin/issue-credits	admin; { programme_period_id }
17. WINNER — /api/v1/winner
Method	Path	Auth
GET	/status	any
GET	/details	any
POST	/admin/select-passengers	admin; { programme_period_id }
POST	/admin/select-drivers	admin; { programme_period_id }
POST	/admin/select-all	admin; { programme_period_id }
GET	/admin/winners	admin; ?periodId&userType&page&limit
GET	/admin/winners/active	admin; ?periodId&userType
GET	/admin/winners/:winnerId	admin
POST	/admin/disqualify	admin; { winner_id, reason }
POST	/admin/replace	admin; { winner_id }
GET	/admin/stats	admin; ?periodId
GET	/admin/summary	admin; ?periodId
GET	/admin/disqualified	admin; ?periodId&userType
POST	/admin/mark-paid	admin; { winner_id }
18. ADMIN INCENTIVE — /api/v1/admin/incentive
All routes require admin or super_admin.

Method	Path	Body / Query
POST	/programme/create	{ year, start_date, end_date, passenger_threshold?, driver_threshold?, winner_cap_percentage?, individual_reward_cap?, rebate_contribution_rate?, profit_pool_percentage?, status? }
GET	/programme/list	?status&page&limit
GET	/programme/active	—
GET	/programme/:id	—
PATCH	/programme/:id/status	{ status: 'draft'|'active'|'closed'|'archived' }
PATCH	/programme/:id/config	partial programme body
POST	/programme/:id/complete	— (runs the full close workflow)
POST	/fraud/run-batch	{ programme_period_id }
GET	/fraud/summary	?periodId
GET	/fraud/pending	?page&limit
GET	/exclusions/summary	?periodId
GET	/dashboard	?periodId optional
19. ADMIN PAYMENT (Split config) — /api/v1/admin/payment
Method	Path	Body
POST	/subaccount	{ business_name, settlement_bank, account_number, percentage_charge?, description?, primary_contact_*? }
GET	/subaccounts	?page&perPage
GET	/subaccount/:identifier	—
PUT	/subaccount/:identifier	partial subaccount
POST	/split-code	{ name, type, currency?, subaccounts: [{ subaccount, share }], bearer_type?, bearer_subaccount? }
GET	/split-codes	?page&perPage
GET	/split-code/:identifier	—
PUT	/split-code/:identifier	partial split
POST	/apply-split	{ user_id, split_code?, subaccount?, preferred_bank? }
POST	/remove-split	{ user_id }
GET	/split-status	?userId
GET	/split-users	?page&limit
GET	/available-banks	—
20. KYC (passenger) — /api/v1/kyc
Method	Path	Body
GET	/passenger/status	—
POST	/passenger/bvn	{ bvn } (11 digits)
POST	/passenger/nin	{ nin } (11 digits)
GET	/passenger/details	—
PUT	/passenger/status	admin; { userId, status, failureReason? }
GET	/passenger/pending	admin; ?page&limit
GET	/passenger/all	admin; ?page&limit&status
GET	/passenger/:userId	admin
GET	/stats	admin
21. UPLOAD — /api/v1/upload
All verified. Uses multipart/form-data with field file.

Method	Path	Notes
POST	/kyc-document	form field document_type + file
POST	/profile-photo	single image
GET	/presigned-url	?file_name&content_type&prefix
GET	/kyc-documents	—
PATCH	/kyc-document/:documentId/verify	admin; { status, notes? }
DELETE	/kyc-document/:documentId	—
DELETE	/:key	—
Allowed MIME types: image/jpeg, image/png, image/webp, application/pdf. Max 10 MB.

22. HEALTH & WEBHOOKS
Method	Path	Notes
GET	/health	liveness probe
GET	/health/ready	readiness — checks DB and Redis
POST	/api/v1/webhooks/paystack	Paystack callback
POST	/api/v1/webhooks/bank-transfer	Licensed partner callback
POST	/api/v1/webhooks/payout	Partner payout status
POST	/api/v1/webhooks/refund	Partner refund status
POST	/api/v1/webhooks/unified	Generic dispatcher (?provider&event)
GET	/api/v1/webhooks/health	webhook handler health
Common error codes
HTTP	Code	Meaning
400	BAD_REQUEST	malformed body
401	UNAUTHORIZED	missing or invalid token
401	DB_CONNECTION_ERROR	transient DB blip (503 in some paths)
403	FORBIDDEN	role not allowed
403	PHONE_NOT_VERIFIED	user is pending_verification and hit a requireVerified route
404	NOT_FOUND	resource missing
409	CONFLICT	duplicate (phone, ride already paid, etc.)
422	VALIDATION_ERROR	Joi rejection
500	SERVER_ERROR	unhandled
Lifecycle in one picture
text
register → verify-otp → [tokens issued]
   ↓
onboarding/status → next_step tells the client what to do
   ↓
[passenger]  kyc/passenger/bvn + kyc/passenger/nin → onboarding completed
[driver]     onboarding/driver/bank → onboarding/driver/identity → onboarding/driver/vehicle → completed
   ↓
ride marketplace → bid → select → status transitions → complete
   ↓
rides/:id/pay → split (84/15/1) → informational ledger row
   ↓
qualification tracking, rebate contributions, winner selection (seasonal)