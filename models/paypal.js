const mongoose = require("mongoose");

const PaypalSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
    }
  },
  { versionKey: false, timestamps: true }
);

const Paypal = mongoose.model("Paypal", PaypalSchema);

module.exports = Paypal;