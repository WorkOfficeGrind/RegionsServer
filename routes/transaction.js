const express = require("express");
const { auth } = require("../middleware/auth");
const {
  logoutUser,
  getCurrentUser,
  loginUser,
} = require("../controllers/authControllers");
const { transferFunds, getTransactionHistory } = require("../controllers/transactionControllers");
const router = express.Router();

router.get("/history", getTransactionHistory);

router.post("/transfer", auth, transferFunds);

module.exports = router;
