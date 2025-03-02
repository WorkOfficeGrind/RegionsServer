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
const router = express.Router();

router.get("/", auth, getUserWallets);

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
