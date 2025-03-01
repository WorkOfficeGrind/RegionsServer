const mongoose = require("mongoose");

const WalletSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    address: {
      type: String,
      required: true,
      // unique: true,
    },
    currency: {
      type: String,
      required: true,
      enum: ["USD", "BTC", "ETH", "SOL", "XRP", "ADA", "USDT"], // Extend as needed
    },
    balance: {
      type: Number,
      required: true,
      default: 0,
    },
    transactions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "WalletTransaction",
      },
    ],
    ledgerBalance: {
      type: Number,
      required: true,
      default: 0,
    },
    name: {
      type: String,
      // required: true,
    },
  },
  { versionKey: false, timestamps: true }
);

// Pre-save hook to auto-generate the wallet name based on the wallet count
WalletSchema.pre("save", async function (next) {
  if (this.isNew) {
    // Count the number of wallets already created for this user
    const count = await this.constructor.countDocuments({ user: this.user });
    // Wallet count + 1 gives the current wallet number
    const walletNumber = count + 1;
    // Pad the number to 2 digits and assign the name
    this.name = `Address ${walletNumber.toString().padStart(2, "0")}`;
  }
  next();
});

const Wallet = mongoose.model("Wallet", WalletSchema);

module.exports = Wallet;
