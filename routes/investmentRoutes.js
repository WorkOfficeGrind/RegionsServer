const express = require("express");
const {
  authenticate,
  verifyPasscode,
  hasRole,
} = require("../middlewares/authMiddleware");
const { validate, schemas } = require("../middlewares/validator");
const {
  createInvestmentPlan,
  getAllInvestmentPlans,
  addUserInvestment,
} = require("../controllers/investmentController");

const router = express.Router();

// Apply authentication middleware to all routes
// router.use(authenticate);

/**
 * @route   POST /api/v1/investments
 * @desc    Create an investment plans
 * @access  Private
 */
router.post(
  "/plans",
  // validate(schemas.transaction.create),
  authenticate,
  hasRole("admin"),
  // verifyPasscode,
  createInvestmentPlan
);

/**
 * @route   GET /api/v1/investments
 * @desc    Get all investment plans
 * @access  Private
 */
router.get(
  "/plans",
  // validate(schemas.transaction.create),
  authenticate,
  // hasRole("admin"),
  // verifyPasscode,
  getAllInvestmentPlans
);

/**
 * @route   POST /api/v1/investments
 * @desc    Add an investment plan to user portfolio
 * @access  Private
 */
router.post(
  "/invest",
  // validate(schemas.transaction.create),
  authenticate,
  // hasRole("admin"),
  verifyPasscode,
  addUserInvestment
);

module.exports = router;
