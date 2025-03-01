const mongoose = require("mongoose");

const VenmoSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
    }
  },
  { versionKey: false, timestamps: true }
);

const Venmo = mongoose.model("Venmo", VenmoSchema);

module.exports = Venmo;