const express = require("express");
const router = express.Router();
const {
  authenticate,
  verifyPasscode,
  hasRole,
} = require("../middlewares/authMiddleware");
const investmentController = require("../controllers/investmentController");

// Routes for investment plans
router.get("/plans", authenticate, investmentController.getInvestmentPlans);
router.get("/plans/:id", authenticate, investmentController.getInvestmentPlan);

// Routes for user investments
router.post(
  "/invest",
  authenticate,
  verifyPasscode,
  investmentController.createInvestment
);

router.post(
  "/:id/add-liquidity",
  authenticate,
  verifyPasscode,
  investmentController.addLiquidityToInvestment
);

router.post(
  "/:id/trade",
  authenticate,
  verifyPasscode,
  investmentController.withdrawInvestment
);

router.get("/", authenticate, investmentController.getUserInvestments);
router.get(
  "/performance",
  authenticate,
  investmentController.getInvestmentPerformance
);
router.get(
  "/transactions",
  authenticate,
  investmentController.getInvestmentTransactions
);
router.get("/:id", authenticate, investmentController.getInvestmentDetails);

// Routes for investment actions
router.post(
  "/:id/withdraw",
  authenticate,
  investmentController.withdrawInvestment
);
router.post("/:id/cancel", authenticate, investmentController.cancelInvestment);

// Admin routes for investment management
router.post(
  "/process-growth",
  authenticate,
  hasRole("admin"),
  investmentController.processInvestmentGrowth
);

router.post(
  "/:id/simulate-growth",
  authenticate,
  hasRole("admin"),

  investmentController.simulateInvestmentGrowth
);

module.exports = router;
