const express = require("express");
const authController = require("../controllers/authController");
const { authenticate } = require("../middlewares/authMiddleware");
const { validate, schemas } = require("../middlewares/validator");
const { generateChallengeToken } = require("../utils/encryption");

const router = express.Router();

/**
 * @route   POST /api/v1/auth/register
 * @desc    Register a new user
 * @access  Public
 */
router.post(
  "/register",
  validate(schemas.auth.register),
  authController.register
);

if (process.env.NODE_ENV === "development") {
  router.post("/check-payload", (req, res) => {
    logger.info("Payload check requested", {
      body: req.body,
      expectedLogin: {
        identifier: "string (email or username)",
        password: "string",
      },
    });

    return res.status(200).json({
      status: "success",
      message: "Payload check completed",
      receivedPayload: req.body,
      expectedLoginPayload: {
        identifier: "string (email or username)",
        password: "string",
      },
    });
  });
}

/**
 * @route   POST /api/v1/auth/login
 * @desc    Login user
 * @access  Public
 */
router.post("/login", validate(schemas.auth.login), authController.login);

/**
 * @route   POST /api/v1/auth/refresh-token
 * @desc    Refresh access token
 * @access  Public
 */
router.post(
  "/refresh-token",
  validate(schemas.auth.refreshToken),
  authController.refreshToken
);

/**
 * @route   POST /api/v1/auth/logout
 * @desc    Logout user
 * @access  Public
 */
router.post("/logout", authController.logout);

/**
 * @route   GET /api/v1/auth/me
 * @desc    Get current user
 * @access  Private
 */
router.get("/me", authenticate, authController.getMe);

/**
 * @route   POST /api/v1/auth/set-passcode
 * @desc    Set user passcode
 * @access  Private
 */
router.post(
  "/set-passcode",
  authenticate,
  validate(schemas.auth.setPasscode),
  authController.setPasscode
);

/**
 * @route   POST /api/v1/auth/verify-passcode
 * @desc    Verify user passcode
 * @access  Private
 */
router.post(
  "/verify-passcode",
  authenticate,
  validate(schemas.auth.setPasscode),
  authController.verifyPasscode
);

/**
 * @route   POST /api/v1/auth/forgot-password
 * @desc    Forgot password - send reset email
 * @access  Public
 */
router.post(
  "/forgot-password",
  validate(schemas.auth.forgotPassword),
  authController.forgotPassword
);

/**
 * @route   POST /api/v1/auth/reset-password
 * @desc    Reset password with token
 * @access  Public
 */
router.post(
  "/reset-password",
  validate(schemas.auth.resetPassword),
  authController.resetPassword
);

/**
 * @route   PUT /api/v1/auth/update-password
 * @desc    Update current user password
 * @access  Private
 */
router.put(
  "/update-password",
  authenticate,
  validate(schemas.user.updatePassword),
  authController.updatePassword
);

router.post("/challenge-token", authenticate, generateChallengeToken);

module.exports = router;
