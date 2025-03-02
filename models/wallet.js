const mongoose = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");


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
      type: mongoose.Schema.Types.Decimal128,
      default: mongoose.Types.Decimal128.fromString("0"),
      get: (v) => (v ? parseFloat(v.toString()) : 0),
      required: true,
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

    // isActive: {
    //   type: Boolean,
    //   default: true,
    // },
    // isDefault: {
    //   type: Boolean,
    //   default: false,
    // },
    // lastTransactionDate: {
    //   type: Date,
    //   default: null,
    // },
  },
  {
    versionKey: false,
    timestamps: true,
    toJSON: { getters: true, virtuals: true },
    toObject: { getters: true, virtuals: true },
  }
);

// Indexes for performance
WalletSchema.index({ user: 1, currency: 1 });
WalletSchema.index({ user: 1, isDefault: 1 });

// Pre-save hook to auto-generate the wallet name based on the wallet count
WalletSchema.pre("save", async function (next) {
  if (this.isNew) {
    // Count the number of wallets already created for this user
    const count = await this.constructor.countDocuments({ user: this.user });
    // Wallet count + 1 gives the current wallet number
    const walletNumber = count + 1;
    // Pad the number to 2 digits and assign the name
    this.name = `Wallet ${walletNumber.toString().padStart(2, "0")}`;
  }
  if (this.isDefault) {
    // Find any other default wallets for this user and unset them
    await this.constructor.updateMany(
      { user: this.user, _id: { $ne: this._id }, isDefault: true },
      { isDefault: false }
    );
  }

  next();
});

WalletSchema.plugin(mongoosePaginate);

const Wallet = mongoose.model("Wallet", WalletSchema);

module.exports = Wallet;

