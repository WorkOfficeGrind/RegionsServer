const express = require("express");
const {
  createUser,
  getAllUsers,
  updateUser,
  initiatePasswordReset,
  completePasswordReset,
  updatePasswordAuthenticated,
} = require("../controllers/userController");
const { rateLimiter, hasRole, isResourceOwner, hasAccessOrIsAdmin, auth } = require("../middleware/auth");
const { generateEtherealCredentials } = require("../controllers/testControllers");
const router = express.Router();

if (process.env.NODE_ENV === "development") {
  router.post("/cred", generateEtherealCredentials);
}

router.post("/forgot-password", rateLimiter, initiatePasswordReset);
router.post("/reset-password", rateLimiter, completePasswordReset);
router.post("/register", rateLimiter, createUser);

router.get("/", auth, hasRole("admin"), getAllUsers);
router.put("/:id", auth, hasAccessOrIsAdmin, updateUser);
router.patch("/update-password", auth, isResourceOwner, updatePasswordAuthenticated);


module.exports = router;
