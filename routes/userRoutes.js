const express = require("express");
const userController = require("../controllers/userController");
const { authenticate, authorize } = require("../middlewares/authMiddleware");
const { validate, schemas } = require("../middlewares/validator");

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
 * @route   PUT /api/v1/users/profile
 * @desc    Update user profile
 * @access  Private
 */
router.put(
  "/profile",
  validate(schemas.user.update),
  userController.updateProfile
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
