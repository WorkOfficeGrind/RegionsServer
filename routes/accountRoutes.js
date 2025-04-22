const express = require("express");
const {
  authenticate,
  verifyPasscode,
} = require("../middlewares/authMiddleware");
const { validate, schemas } = require("../middlewares/validator");
// const { getAllTransactions } = require("../controllers/accountController");
const accountController = require("../controllers/accountController");

const router = express.Router();

router.use(authenticate);

/**
 * @route   POST /api/v1/transactions
 * @desc    Create a new transaction
 * @access  Private
 */
router.get(
  "/transactions",
  //   validate(schemas.transaction.create),
  //   verifyPasscode,
  accountController.getAllTransactions
);

/**
 * @route   POST /api/v1/transactions
 * @desc    Create a new transaction
 * @access  Private
 */
router.get(
  "/:accountId/transactions",
  //   validate(schemas.transaction.create),
  //   verifyPasscode,
  accountController.getTransactionsByAccountId
);

/**
 * @route   POST /api/v1/transactions
 * @desc    Create a new transaction
 * @access  Private
 */
router.put(
  "/transactions/source",
  //   validate(schemas.transaction.create),
  //   verifyPasscode,
  accountController.updateTransactionsBySource
);

module.exports = router;
