const express = require("express");
const { auth } = require("../middleware/auth");
const { getUserCards } = require("../controllers/cardControllers");


const router = express.Router();

router.get("/", auth, getUserCards);

// router.post("/transfer", auth, transferFunds);

module.exports = router;
