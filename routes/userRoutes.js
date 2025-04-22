const express = require("express");
const userController = require("../controllers/userController");
const {
  authenticate,
  authorize,
  verifyPasscode,
  hasRole,
} = require("../middlewares/authMiddleware");
const { validate, schemas } = require("../middlewares/validator");
const { uploadAndStreamToCloudinary } = require("../config/upload");

const router = express.Router();
// Apply authentication middleware to all routes
router.use(authenticate);

/**
 * @route   GET /api/v1/users/dashboard
 * @desc    Get user dashboard data
 * @access  Private
 */
router.get("/dashboard", userController.getDashboard);

/**
 * @route   POST /api/v1/users/update-passcode
 * @desc   Update Passcode
 * @access  Private
 */
router.post(
  "/push-token",
  // verifyPasscode,
  userController.updateExpoPushToken
);

/**
 * @route   PUT /api/v1/users/profile
 * @desc    Update basic user profile settings
 * @access  Private
 */
router.put(
  "/profile",
  validate(schemas.user.update),
  verifyPasscode,
  userController.updateProfile
);

/**
 * @route   PUT /api/v1/users/email
 * @desc    Update user email with verification
 * @access  Private
 */
router.put(
  "/email",
  // validate(schemas.user.updateEmail),
  verifyPasscode,
  uploadAndStreamToCloudinary("frontIdImage", "backIdImage"),
  userController.updateEmail
);

/**
 * @route   PUT /api/v1/users/name
 * @desc    Update user name with verification
 * @access  Private
 */
router.put(
  "/name",
  // validate(schemas.user.updateName),
  verifyPasscode,
  uploadAndStreamToCloudinary("frontIdImage", "backIdImage"),
  userController.updateName
);

/**
 * @route   PUT /api/v1/users/address
 * @desc    Update user address with verification
 * @access  Private
 */
router.put(
  "/address",
  // validate(schemas.user.updateAddress),
  verifyPasscode,
  uploadAndStreamToCloudinary(
    "frontIdImage",
    "backIdImage",
    "proofOfAddressImage"
  ),
  userController.updateAddress
);

/**
 * @route   PUT /api/v1/users/phone
 * @desc    Update user phone with verification
 * @access  Private
 */
router.put(
  "/phone",
  // validate(schemas.user.updatePhone),
  verifyPasscode,
  uploadAndStreamToCloudinary("frontIdImage", "backIdImage"),
  userController.updatePhone
);

/**
 * @route   POST /api/v1/users/verify-passcode
 * @desc    Verify Current Passcode for Change
 * @access  Private
 */
router.post("/verify-passcode", verifyPasscode, userController.verifyPasscode);

/**
 * @route   POST /api/v1/users/update-passcode
 * @desc   Update Passcode
 * @access  Private
 */
router.put(
  "/update-passcode",
  // verifyPasscode,
  userController.updatePasscode
);

/**
 * @route   POST /api/v1/users/update-password
 * @desc   Update Password
 * @access  Private
 */
router.put("/update-password", verifyPasscode, userController.updatePassword);

/**
 * @route   POST /api/v1/users/update-limit/accounts
 * @desc   Update Account Limits
 * @access  Private
 */
router.put(
  "/update-limit/accounts",
  verifyPasscode,
  userController.updateAccountTransferLimits
);

/**
 * @route   POST /api/v1/users/update-limit/cards
 * @desc   Update Card Limits
 * @access  Private
 */
router.put(
  "/update-limit/cards",
  verifyPasscode,
  userController.updateCardLimits
);

/**
 * @route   POST /api/v1/users/update-limit/wallets
 * @desc   Update Wallet Limits
 * @access  Private
 */
router.put(
  "/update-limit/wallets",
  verifyPasscode,
  userController.updateWalletLimits
);

/**
 * @route   POST /api/v1/users/email-change/verify
 * @desc    Verify Email Change Request
 * @access  Private
 */
router.post("/email-change/verify", userController.verifyEmailChange);

/**
 * @route   POST /api/v1/users/email-change/resend-verification
 * @desc    Resend Email Change Request Verification
 * @access  Private
 */
router.post(
  "/email-change/resend-verification",
  userController.resendEmailVerification
);

/**
 * @route   GET /api/v1/users/name-changes
 * @desc    Get all Name Change Requests
 * @access  Private, Admin only
 */
router.get(
  "/name-changes",
  hasRole("admin"),
  userController.getNameChangeRequests
);

/**
 * @route   GET /api/v1/users/name-changes/:nameChangeId
 * @desc    Get a Name Change Request by ID
 * @access  Private, Admin only
 */
router.get(
  "/name-changes/:nameChangeId",
  hasRole("admin"),
  userController.getNameChangeRequestById
);

/**
 * @route   POST /api/v1/users/name-changes/:nameChangeId/approve
 * @desc    Approve a name change request
 * @access  Private, Admin only
 */
router.post(
  "/name-changes/:nameChangeId/approve",
  hasRole("admin"),
  userController.approveNameChange
);

/**
 * @route   POST /api/v1/users/name-changes/:nameChangeId/reject
 * @desc    Reject a name change request
 * @access  Private, Admin only
 */
router.post(
  "/name-changes/:nameChangeId/reject",
  hasRole("admin"),
  userController.rejectNameChange
);

/**
 * @route   GET /api/v1/users/email-changes
 * @desc    Get all Email Change Requests
 * @access  Private, Admin only
 */
router.get(
  "/email-changes",
  hasRole("admin"),
  userController.getEmailChangeRequests
);

/**
 * @route   GET /api/v1/users/email-changes/stats
 * @desc    Get Email Change Statistics
 * @access  Private, Admin only
 */
router.get(
  "/email-changes/stats",
  hasRole("admin"),
  userController.getEmailChangeStats
);

/**
 * @route   GET /api/v1/users/email-changes/:emailChangeId
 * @desc    Get an Email Change Request by ID
 * @access  Private, Admin only
 */
router.get(
  "/email-changes/:emailChangeId",
  hasRole("admin"),
  userController.getEmailChangeById
);

/**
 * @route   POST /api/v1/users/email-changes/:emailChangeId/approve
 * @desc    Approve an email change request
 * @access  Private, Admin only
 */
router.post(
  "/email-changes/:emailChangeId/approve",
  hasRole("admin"),
  userController.approveEmailChange
);

/**
 * @route   POST /api/v1/users/email-changes/:emailChangeId/reject
 * @desc    Reject an email change request
 * @access  Private, Admin only
 */
router.post(
  "/email-changes/:emailChangeId/reject",
  hasRole("admin"),
  userController.rejectEmailChange
);

/**
 * @route   GET /api/v1/users/kyc-status
 * @desc    Get user KYC status
 * @access  Private
 */
router.get("/kyc-status", userController.getKycStatus);

/**
 * @route   PUT /api/v1/users/kyc
 * @desc    Update user KYC information
 * @access  Private
 */
router.put("/kyc", userController.updateKyc);

/**
 * @route   GET /api/v1/users/activity-log
 * @desc    Get user activity log
 * @access  Private
 */
router.get("/activity-log", userController.getActivityLog);

/**
 * @route   POST /api/v1/users/enable-mfa
 * @desc    Enable MFA
 * @access  Private
 */
router.post("/enable-mfa", userController.enableMfa);

/**
 * @route   POST /api/v1/users/verify-mfa
 * @desc    Verify MFA setup
 * @access  Private
 */
router.post("/verify-mfa", userController.verifyMfa);

/**
 * @route   POST /api/v1/users/disable-mfa
 * @desc    Disable MFA
 * @access  Private
 */
router.post("/disable-mfa", userController.disableMfa);

// Admin routes
/**
 * @route   GET /api/v1/users
 * @desc    Get all users (admin only)
 * @access  Private/Admin
 */
router.get("/", authorize(["admin"]), (req, res) => {
  // Admin controller to be implemented
  res.status(501).json({ message: "Not implemented yet" });
});

/**
 * @route   GET /api/v1/users/:id
 * @desc    Get user by ID (admin only)
 * @access  Private/Admin
 */
router.get("/:id", authorize(["admin"]), (req, res) => {
  // Admin controller to be implemented
  res.status(501).json({ message: "Not implemented yet" });
});

/**
 * @route   PUT /api/v1/users/:id
 * @desc    Update user by ID (admin only)
 * @access  Private/Admin
 */
router.put("/:id", authorize(["admin"]), (req, res) => {
  // Admin controller to be implemented
  res.status(501).json({ message: "Not implemented yet" });
});

module.exports = router;
