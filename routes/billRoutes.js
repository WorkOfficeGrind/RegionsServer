const express = require("express");
const {
  authenticate,
  verifyPasscode,
} = require("../middlewares/authMiddleware");
const { validate, schemas } = require("../middlewares/validator");
const { verifyPasscodeChallenge } = require("../utils/encryption");
const { createBill } = require("../controllers/billController");

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticate);

const logger = async (req, res) => {
  console.log("ttttt", req.body);
};

/**
 * @route   POST /api/v1/bills
 * @desc    Create a new bill
 * @access  Private
 */
router.post(
  "/",

  validate(schemas.bill.create),
  verifyPasscode,
  createBill
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
