const express = require("express");
const { auth, hasRole, verifyPasscode } = require("../middleware/auth");
const {
  validateWithdraw,
  validateDeposit,
  validateSwap,
} = require("../middleware/validateWallet");
const {
  createPreloadedWallet,
  updatePreloadedWallet,
  deletePreloadedWallet,
  getUserWallets,
  withdrawFromWallet,
  depositToWallet,
  swapBetweenWallets,
  getWalletTransactions,
} = require("../controllers/walletControllers");
const { getRates } = require("../services/currencyExchange");
const router = express.Router();

router.get("/", auth, getUserWallets);

// // routes/currencyRoutes.js
// const express = require("express");
// const router = express.Router();
// const { protect } = require("../middleware/auth");
// const currencyController = require("../controllers/currencyController");


// Get exchange rate between two currencies
router.get("/rates", auth, getRates);

// // Convert an amount from one currency to another
// router.get("/transact/convert", convertAmount);

// // Get all supported currencies
// router.get("/transact/currencies", getSupportedCurrencies);

router.post("/pre", auth, hasRole("admin"), createPreloadedWallet);

router.put("/pre/:id", auth, hasRole("admin"), updatePreloadedWallet);

router.delete("/pre/:id", auth, hasRole("admin"), deletePreloadedWallet);

router.post("/transact/withdraw", auth, verifyPasscode, validateWithdraw, withdrawFromWallet);
router.post(
  "/transact/deposit",
  auth,
  verifyPasscode,
  validateDeposit,
  depositToWallet
);
router.post(
  "/transact/swap",
  auth,
  verifyPasscode,
  validateSwap,
  swapBetweenWallets
);
router.get(
  "/:walletId/transactions",
  auth,
  verifyPasscode,
  getWalletTransactions
);



module.exports = router;
