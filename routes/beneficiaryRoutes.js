const express = require("express");
const router = express.Router();
const beneficiaryController = require("../controllers/beneficiaryController");
const { validate, schemas } = require("../middlewares/validator");
const { authenticate } = require("../middlewares/authMiddleware");

// Create a new beneficiary
router.post(
  "/",
  authenticate,
  validate(schemas.beneficiary.create),
  beneficiaryController.createBeneficiary
);

// Get all beneficiaries
router.get("/", authenticate, beneficiaryController.getAllBeneficiaries);

// Get a single beneficiary by ID
router.get("/:id", authenticate, beneficiaryController.getBeneficiaryById);

// Update a beneficiary
router.put("/:id", beneficiaryController.updateBeneficiary);

// Delete a beneficiary
router.delete("/:id", beneficiaryController.deleteBeneficiary);

module.exports = router;
