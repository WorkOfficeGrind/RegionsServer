const { body } = require("express-validator");
const middlewareRunner = require("./validationMiddleware");
const mongoose = require("mongoose");

/**
 * Validation rules for wallet withdrawal
 */

// Custom validator that allows a valid ObjectId or null/undefined
const isValidOrNull = (value) => {
  if (value === null || value === undefined) {
    return true;
  }
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new Error("Invalid ID format");
  }
  return true;
};

exports.validateWithdraw = middlewareRunner([
  body("walletId")
    .notEmpty()
    .withMessage("Wallet ID is required")
    .isMongoId()
    .withMessage("Invalid wallet ID format"),

  body("amount")
    .notEmpty()
    .withMessage("Amount is required")
    .isNumeric()
    .withMessage("Amount must be a number")
    .custom((value) => {
      if (parseFloat(value) <= 0) {
        throw new Error("Amount must be greater than zero");
      }
      return true;
    }),

  // Validate toAccount field (allowing null)
  body("toAccount")
    .custom(isValidOrNull)
    .withMessage("Invalid account ID format"),

  // Validate toCard field (allowing null)
  body("toCard").custom(isValidOrNull).withMessage("Invalid card ID format"),

  body("description")
    .optional()
    .isString()
    .withMessage("Description must be a string")
    .isLength({ max: 500 })
    .withMessage("Description cannot exceed 500 characters"),

  // Cross-field validation: exactly one of toAccount or toCard must be provided
  body().custom((_, { req }) => {
    const { toAccount, toCard } = req.body;
    // Both are null/undefined or both are provided
    if ((toAccount && toCard) || (!toAccount && !toCard)) {
      throw new Error(
        "Please provide either an account OR a card as the destination, not both or neither"
      );
    }
    return true;
  }),
]);

/**
 * Validation rules for wallet deposit
 */
exports.validateDeposit = middlewareRunner([
  body("walletId")
    .notEmpty()
    .withMessage("Wallet ID is required")
    .isMongoId()
    .withMessage("Invalid wallet ID format"),

  body("amount")
    .notEmpty()
    .withMessage("Amount is required")
    .isNumeric()
    .withMessage("Amount must be a number")
    .custom((value) => {
      if (parseFloat(value) <= 0) {
        throw new Error("Amount must be greater than zero");
      }
      return true;
    }),

  // Validate fromAccount field, allowing null/undefined
  body("fromAccount")
    .custom(isValidOrNull)
    .withMessage("Invalid account ID format"),

  // Validate fromCard field, allowing null/undefined
  body("fromCard").custom(isValidOrNull).withMessage("Invalid card ID format"),

  body("description")
    .optional()
    .isString()
    .withMessage("Description must be a string")
    .isLength({ max: 500 })
    .withMessage("Description cannot exceed 500 characters"),

  // Cross-field validation: exactly one of fromAccount or fromCard must be provided
  body().custom((body) => {
    const { fromAccount, fromCard } = body;
    if ((fromAccount && fromCard) || (!fromAccount && !fromCard)) {
      throw new Error(
        "Please provide either fromAccount OR fromCard, not both or neither"
      );
    }
    return true;
  }),
]);


/**
 * Validation rules for wallet to wallet swap
 */
exports.validateSwap = middlewareRunner([
  body("fromWalletId")
    .notEmpty()
    .withMessage("Source wallet ID is required")
    .isMongoId()
    .withMessage("Invalid source wallet ID format"),

  body("toWalletId")
    .notEmpty()
    .withMessage("Destination wallet ID is required")
    .isMongoId()
    .withMessage("Invalid destination wallet ID format")
    .custom((value, { req }) => {
      if (value === req.body.fromWalletId) {
        throw new Error("Source and destination wallets cannot be the same");
      }
      return true;
    }),

  body("amount")
    .notEmpty()
    .withMessage("Amount is required")
    .isNumeric()
    .withMessage("Amount must be a number")
    .custom((value) => {
      if (parseFloat(value) <= 0) {
        throw new Error("Amount must be greater than zero");
      }
      return true;
    }),

  body("description")
    .optional()
    .isString()
    .withMessage("Description must be a string")
    .isLength({ max: 500 })
    .withMessage("Description cannot exceed 500 characters"),
]);

module.exports = exports;
