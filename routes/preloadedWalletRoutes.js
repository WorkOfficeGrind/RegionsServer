const express = require("express");
const {
  authenticate,
  verifyPasscode,
  hasRole,
} = require("../middlewares/authMiddleware");
const { validate, schemas } = require("../middlewares/validator");
const { verifyPasscodeChallenge } = require("../utils/encryption");
const {
  searchByCurrency,
} = require("../controllers/preloadedWalletController");
const preloadedWalletController = require("../controllers/preloadedWalletController");
// const { transferBetweenAccounts } = require("../controllers/transactionController");

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticate);

// Search preloaded wallets by currency
// GET /api/preloaded-wallets/search?currency=BTC
router.get("/search", preloadedWalletController.searchByCurrency);

// Get all preloaded wallets (admin only)
// GET /api/preloaded-wallets
router.get(
  "/",
  //   auth.required,
  //   admin.required,
  preloadedWalletController.getAllPreloadedWallets
);

// Get preloaded wallet by ID
// GET /api/preloaded-wallets/:preloadedWalletId
router.get(
  "/:preloadedWalletId",
  //   auth.required,
  //   admin.required,
  preloadedWalletController.getPreloadedWalletById
);

// The following routes could be added if you decide to implement the additional
// functionality in the preloadedWalletService:

// Create a preloaded wallet (admin only)
// POST /api/preloaded-wallets
router.post(
  "/",
  // auth.required,
  // admin.required,
  hasRole("admin"),
  preloadedWalletController.createPreloadedWallet
);

// Update a preloaded wallet (admin only)
// PUT /api/preloaded-wallets/:preloadedWalletId
// router.put(
//   "/:preloadedWalletId",
//   auth.required,
//   admin.required,
//   preloadedWalletController.updatePreloadedWallet
// );

// Mark a preloaded wallet as used (possibly needs a controller method)
// POST /api/preloaded-wallets/:preloadedWalletId/mark-as-used
// router.post(
//   "/:preloadedWalletId/mark-as-used",
//   auth.required,
//   preloadedWalletController.markAsUsed
// );

// Route for assigning a wallet by currency
router.post(
  "/assign",
  verifyPasscode,
  // rateLimiter({ windowMs: 60000, max: 5 }),
  preloadedWalletController.assignWalletToSelf
);

// Route for assigning a specific wallet by ID
router.post(
  "/assign/:preloadedWalletId",
  verifyPasscode,
  // rateLimiter({ windowMs: 60000, max: 5 }),
  preloadedWalletController.assignSpecificWalletToSelf
);

module.exports = router;
