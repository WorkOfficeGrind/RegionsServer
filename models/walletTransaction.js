const mongoose = require("mongoose");

const WalletTransactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: ["deposit", "withdrawal", "transfer"],
      required: true,
    },
    amount: { type: Number, required: true },
    details: { type: Object }, // e.g., { from: accountId, to: accountId }
  },
  { versionKey: false, timestamps: true }
);

const WalletTransaction = mongoose.model("WalletTransaction", WalletTransactionSchema);

module.exports = WalletTransaction