const mongoose = require("mongoose");

const WaitlistSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    currency: {
      type: String,
      enum: ["USD", "BTC", "ETH", "SOL", "XRP", "ADA", "USDT"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    preloadedAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PreloadedWallet",
    },
  },
  { timestamps: true, versionKey: false }
);

const Waitlist = mongoose.model("Waitlist", WaitlistSchema);

module.exports = Waitlist;
