const express = require("express");
const router = express.Router();
// const { authorize } = require('../middlewares/authMiddleware');
// const verifyPasscode = require('../middlewares/verifyPasscode');
// const { hasRole } = require('../middlewares/roleMiddleware');
const walletController = require("../controllers/walletController");
const Joi = require("joi");
const {
  verifyPasscode,
  hasRole,
  authorize,
  authenticate,
} = require("../middlewares/authMiddleware");
const { validate } = require("../middlewares/validator");

// Validation schemas
const createWalletSchema = Joi.object({
  currency: Joi.string().required(),
  // address: Joi.string().optional(),
  // name: Joi.string().optional(),
});

const updateWalletSchema = Joi.object({
  name: Joi.string().optional(),
  securitySettings: Joi.object({
    transferLimit: Joi.object({
      daily: Joi.number().positive().optional(),
      singleTransaction: Joi.number().positive().optional(),
    }).optional(),
    requireConfirmation: Joi.boolean().optional(),
    twoFactorEnabled: Joi.boolean().optional(),
  }).optional(),
});

// Get all user wallets
router.get("/", authorize(), walletController.getUserWallets);

// // Get wallet by ID
router.get("/:walletId", authorize(), walletController.getWalletById);

router.get("/search/wallet", authenticate, walletController.searchByCurrency);


// // Create new wallet
router.post(
  "/",
  authenticate,
  // authorize(),
  verifyPasscode,
  validate(createWalletSchema),
  walletController.createWallet
);

// // Update wallet (limited fields for regular users)
router.patch(
  "/:walletId",
  authorize(),
  validate(updateWalletSchema),
  walletController.updateWallet
);

// // Set default wallet
router.post(
  "/:walletId/set-default",
  authorize(),
  walletController.setDefaultWallet
);

// // Admin update wallet (all fields)
router.patch(
  "/:walletId/admin",
  authorize(),
  hasRole(["admin", "manager"]),
  walletController.adminUpdateWallet
);

// // High-security operations requiring passcode

// // Withdraw funds
router.post(
  "/:walletId/withdraw",
  authorize(),
  verifyPasscode,
  walletController.withdrawFunds
);

// // Transfer between wallets
router.post(
  "/transfer",
  authorize(),
  verifyPasscode,
  walletController.transferBetweenWallets
);

// // Get wallet transaction history
router.get(
  "/:walletId/transactions",
  authorize(),
  walletController.getWalletTransactions
);

module.exports = router;
