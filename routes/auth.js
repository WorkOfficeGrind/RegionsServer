
const express = require("express");
const {
  auth,
  rateLimiter,
  verifyPasscode,
  hasRole,
} = require("../middleware/auth");
const {
  logoutUser,
  getCurrentUser,
  loginUser,
  setupPasscode,
  refreshToken,
  validatePasscode,
  changePasscode,
  adminResetPasscode,
  adminSetPasscode,
  getPasscodeStatus,
  hashPasscodeForDev,
} = require("../controllers/authControllers");
const router = express.Router();

// Public routes
router.post("/login", loginUser);
router.post("/refresh-token", refreshToken);

// For production, consider using rate limiters
// router.post("/login", rateLimiter, loginUser);
// router.post("/refresh-token", rateLimiter, refreshToken);

// Protected routes - require authentication
router.post("/logout", auth, logoutUser);
router.get("/me", auth, getCurrentUser);
router.post("/setup-passcode", auth, setupPasscode);

// Passcode validation route - requires auth
router.post("/validate-passcode", auth, validatePasscode);

// Change passcode route - requires auth and passcode verification
router.post("/change-passcode", auth, verifyPasscode, changePasscode);

// Admin route to reset a user's passcode (requires admin role)
router.post(
  "/admin/reset-passcode/:userId",
  auth,
  hasRole("admin"),
  adminResetPasscode
);
router.post(
  "/admin/set-passcode/:userId",
  auth,
  hasRole("admin"),
  adminSetPasscode
);

if (process.env.NODE_ENV === "development") {
  router.get("/dev/passcode-status", auth, hasRole("admin"), getPasscodeStatus);

  router.post("/dev/hash-passcode", auth, hasRole("admin"), hashPasscodeForDev);
}

module.exports = router;
