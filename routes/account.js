const express = require("express");
const { auth } = require("../middleware/auth");
const { getUserAccounts } = require("../controllers/accountsControllers");

const router = express.Router();

router.get("/", auth, getUserAccounts);

// router.post("/transfer", auth, transferFunds);

module.exports = router;
