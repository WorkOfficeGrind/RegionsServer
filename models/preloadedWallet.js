const mongoose = require("mongoose");

const PreloadedWalletSchema = new mongoose.Schema(
  {
    currency: {
      type: String,
      enum: ["USD", "BTC", "ETH", "SOL", "XRP", "ADA", "USDT"],
      required: true,
    },
    address: {
      type: String,
      required: true,
    },
    assigned: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true, versionKey: false }
);

const PreloadedWallet = mongoose.model("PreloadedWallet", PreloadedWalletSchema);

module.exports = PreloadedWallet