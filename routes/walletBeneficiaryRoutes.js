const express = require("express");
const router = express.Router();
const walletBeneficiaryController = require("../controllers/walletBeneficiaryController");
const { validate, schemas } = require("../middlewares/validator");
const { authenticate } = require("../middlewares/authMiddleware");

// Create a new beneficiary
router.post(
  "/",
  authenticate,
  validate(schemas.walletBeneficiary.create),
  walletBeneficiaryController.createBeneficiary
);


module.exports = router