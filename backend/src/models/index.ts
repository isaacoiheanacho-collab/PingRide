// ============================================
// EXISTING MODEL IMPORTS
// ============================================
import UserModel from './user.model';
import PassengerModel from './passenger.model';
import SavedLocationModel from './saved-location.model';
import PassengerPreferenceModel from './passenger-preference.model';
import DriverModel from './driver.model';
import VehicleModel from './vehicle.model';
import DriverDocumentModel from './driver-document.model';
import KYCModel from './kyc.model';
import RideRequestModel from './ride-request.model';
import RideBidModel from './ride-bid.model';
import RideModel from './ride.model';

// ============================================
// PAYMENT & WALLET MODELS
// ============================================
import PaymentModel from './payment.model';
import WalletModel from './wallet.model';
import WalletTransactionModel from './wallet-transaction.model';
import DriverLedgerModel from './driver-ledger.model';

// ============================================
// V2.0 INCENTIVE ECOSYSTEM MODELS
// ============================================
import ProgrammePeriodModel from './programme-period.model';
import PassengerQualificationModel from './passenger-qualification.model';
import DriverQualificationModel from './driver-qualification.model';
import PINGRIDEProgressModel from './pingride-progress.model';
import RebateFundModel from './rebate-fund.model';
import WinnerModel from './winner.model';
import FraudCaseModel from './fraud-case.model';

// ============================================
// VIRTUAL ACCOUNT MODELS
// ============================================
import VirtualAccountModel from './virtual-account.model';
import BankTransferEventModel from './bank-transfer-event.model';

// ============================================
// EXPORT ALL MODELS
// ============================================
export {
    // Core Models
    UserModel,
    PassengerModel,
    SavedLocationModel,
    PassengerPreferenceModel,
    DriverModel,
    VehicleModel,
    DriverDocumentModel,
    KYCModel,
    RideRequestModel,
    RideBidModel,
    RideModel,

    // Payment & Wallet
    PaymentModel,
    WalletModel,
    WalletTransactionModel,
    DriverLedgerModel,

    // V2.0 Incentive Ecosystem
    ProgrammePeriodModel,
    PassengerQualificationModel,
    DriverQualificationModel,
    PINGRIDEProgressModel,
    RebateFundModel,
    WinnerModel,
    FraudCaseModel,

    // Virtual Account Models
    VirtualAccountModel,
    BankTransferEventModel,
};

// ============================================
// DEFAULT EXPORT (for convenience)
// ============================================
export default {
    UserModel,
    PassengerModel,
    SavedLocationModel,
    PassengerPreferenceModel,
    DriverModel,
    VehicleModel,
    DriverDocumentModel,
    KYCModel,
    RideRequestModel,
    RideBidModel,
    RideModel,
    PaymentModel,
    WalletModel,
    WalletTransactionModel,
    DriverLedgerModel,
    ProgrammePeriodModel,
    PassengerQualificationModel,
    DriverQualificationModel,
    PINGRIDEProgressModel,
    RebateFundModel,
    WinnerModel,
    FraudCaseModel,
    VirtualAccountModel,
    BankTransferEventModel,
};