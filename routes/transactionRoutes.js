const express = require("express");
const {
  authenticate,
  verifyPasscode,
} = require("../middlewares/authMiddleware");
const { validate, schemas } = require("../middlewares/validator");
const { verifyPasscodeChallenge } = require("../utils/encryption");
const {
  transferBetweenAccounts,
  transferWalletToAccount,
  transferWalletToCard,
  transferAccountToWallet,
  transferWalletToWallet,
} = require("../controllers/transactionController");

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticate);

/**
 * @route   POST /api/v1/transactions
 * @desc    Create a new transaction
 * @access  Private
 */
router.post(
  "/",
  validate(schemas.transaction.create),
  verifyPasscode,
  transferBetweenAccounts
);

/**
 * @route   POST /api/v1/transactions
 * @desc    Create a Wallet to Account new transaction
 * @access  Private
 */
router.post(
  "/wallets/transfer/account",
  validate(schemas.transaction.wallets.transfer.account),
  verifyPasscode,
  transferWalletToAccount
);

/**
 * @route   POST /api/v1/transactions
 * @desc    Create a Wallet to Account new transaction
 * @access  Private
 */
router.post(
  "/wallets/transfer/card",
  validate(schemas.transaction.wallets.transfer.card),
  verifyPasscode,
  transferWalletToCard
);

/**
 * @route   POST /api/v1/transactions
 * @desc    Create an Account to Wallet new transaction
 * @access  Private
 */
router.post(
  "/accounts/transfer/wallet",
  validate(schemas.transaction.accountToWallet.create),
  verifyPasscode,
  transferAccountToWallet
);


/**
 * @route   POST /api/v1/transactions
 * @desc    Create an Account to Wallet new transaction
 * @access  Private
 */
router.post(
  "/wallets/transfer/wallet",
  validate(schemas.transaction.walletToWallet.create),
  verifyPasscode,
  transferWalletToWallet
);

/**
 * @route   GET /api/v1/transactions
 * @desc    Get all transactions for the authenticated user
 * @access  Private
 */
// router.get(
//   "/",
//   validate(schemas.transaction.query, "query"),
//   transactionController.getTransactions
// );

/**
 * @route   GET /api/v1/transactions/summary
 * @desc    Get transaction summary/statistics
 * @access  Private
 */
// router.get("/summary", transactionController.getTransactionSummary);

/**
 * @route   GET /api/v1/transactions/:id
 * @desc    Get a single transaction by ID
 * @access  Private
 */
// router.get("/:id", transactionController.getTransaction);

/**
 * @route   GET /api/v1/transactions/:id/receipt
 * @desc    Download transaction receipt
 * @access  Private
 */
// router.get("/:id/receipt", transactionController.getTransactionReceipt);

module.exports = router;
