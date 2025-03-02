const express = require("express");
const { auth, hasRole, verifyPasscodeAndAuth, verifyPasscode } = require("../middleware/auth");
const { applyForWallet, approveWalletApplication, rejectWalletApplication, getUserPendingApplications } = require("../controllers/waitlistControllers");
const router = express.Router();

router.get("/pending", auth, getUserPendingApplications);

router.post("/apply", auth, verifyPasscode, applyForWallet);

router.post("/approve", auth, hasRole("admin"), approveWalletApplication);

router.post("/reject", auth, hasRole("admin"), rejectWalletApplication);

module.exports = router;
