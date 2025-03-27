// const express = require("express");
// const router = express.Router();
// const beneficiaryController = require("../controllers/beneficiaryController");
// const { validate, schemas } = require("../middlewares/validator");
// const { authenticate } = require("../middlewares/authMiddleware");

// // Create a new beneficiary
// router.post(
//   "/",
//   authenticate,
//   validate(schemas.beneficiary.create),
//   beneficiaryController.createBeneficiary
// );

// // Get all beneficiaries
// router.get("/", authenticate, beneficiaryController.getAllBeneficiaries);

// // Get a single beneficiary by ID
// router.get("/:id", authenticate, beneficiaryController.getBeneficiaryById);

// // Update a beneficiary
// router.put("/:id", beneficiaryController.updateBeneficiary);

// // Delete a beneficiary
// router.delete("/:id", beneficiaryController.deleteBeneficiary);

// module.exports = router;

const express = require("express");
const beneficiaryController = require("../controllers/beneficiaryController");
const authController = require("../controllers/authController");
const { authenticate } = require("../middlewares/authMiddleware");

const router = express.Router();

// // Protect all routes after this middleware
// router.use(authController.protect);

// Recent beneficiaries route (must come before /:id routes)
router.get("/recent", beneficiaryController.getRecentBeneficiaries);

// Create from entity route
router.post("/from-entity", beneficiaryController.createFromEntity);

router.post("/", authenticate, beneficiaryController.createBeneficiary);

// Standard CRUD routes
router.route("/").get(beneficiaryController.getAllBeneficiaries);

router
  .route("/:id")
  .get(beneficiaryController.getBeneficiary)
  .patch(beneficiaryController.updateBeneficiary)
  .delete(beneficiaryController.deleteBeneficiary);

// Toggle favorite status
router.patch("/:id/favorite", beneficiaryController.toggleFavorite);

module.exports = router;
