const mongoose = require("mongoose");

const CashappSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      unique: true,
    },
    tag: {
      type: String,
      required: true,
      unique: true,
    },
  },
  { versionKey: false, timestamps: true }
);

const Cashapp = mongoose.model("Cashapp", CashappSchema);

module.exports = Cashapp;
