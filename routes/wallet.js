const express = require("express");
const { auth, hasRole } = require("../middleware/auth");
const { createPreloadedWallet, updatePreloadedWallet, deletePreloadedWallet, getUserWallets } = require("../controllers/walletControllers");
const router = express.Router();

router.get("/", auth, getUserWallets);

router.post("/pre", auth, hasRole("admin"), createPreloadedWallet);

router.put("/pre/:id", auth, hasRole("admin"), updatePreloadedWallet);

router.delete("/pre/:id", auth, hasRole("admin"), deletePreloadedWallet);

module.exports = router;
