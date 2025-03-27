const mongoose = require("mongoose");
const { logger } = require("../config/logger");

const WalletSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    address: {
      type: String,
      required: [true, "Wallet address is required"],
      unique: true,
    },
    currency: {
      type: String,
      required: [true, "Currency is required"],
      trim: true,
      uppercase: true,
    },
    balance: {
      type: Number,
      default: 0,
      min: [0, "Balance cannot be negative"],
    },
    ledgerBalance: {
      type: Number,
      default: 0,
    },
    transactions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "WalletTransaction",
      },
    ],
    name: {
      type: String,
      trim: true,
      default: "Primary Wallet",
    },
    status: {
      type: String,
      enum: ["active", "inactive", "frozen", "closed"],
      default: "active",
    },
    type: {
      type: String,
      enum: ["fiat", "crypto", "investment"],
      default: "fiat",
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    securitySettings: {
      transferLimit: {
        daily: {
          type: Number,
          default: 5000,
        },
        singleTransaction: {
          type: Number,
          default: 2000,
        },
      },
      requireConfirmation: {
        type: Boolean,
        default: true,
      },
      twoFactorEnabled: {
        type: Boolean,
        default: false,
      },
    },
    lastActivityAt: {
      type: Date,
      default: Date.now,
    },
    image: {
      type: String,
      required: [true, "Image is required"],
      unique: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Generate a unique wallet address
const generateWalletAddress = (currency) => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${currency.toLowerCase()}_${timestamp}${random}`.toUpperCase();
};

// Pre-save hook
WalletSchema.pre("save", function (next) {
  // Generate wallet address if not provided
  if (this.isNew && !this.address) {
    this.address = generateWalletAddress(this.currency);
  }

  // Update last activity timestamp
  if (this.isModified("balance")) {
    this.lastActivityAt = new Date();
  }

  next();
});

// Post-save hook
WalletSchema.post("save", function (doc) {
  logger.info("Wallet saved", {
    walletId: doc._id,
    userId: doc.user,
    currency: doc.currency,
    action: this.isNew ? "created" : "updated",
  });
});

// Virtual for getting recent transactions
WalletSchema.virtual("recentTransactions", {
  ref: "WalletTransaction",
  localField: "_id",
  foreignField: "sourceId",
  options: {
    sort: { createdAt: -1 },
    limit: 10,
    match: { sourceType: "Wallet" },
  },
});

// Method to update balance
WalletSchema.methods.updateBalance = async function (amount, isCredit = true) {
  try {
    if (isCredit) {
      this.balance += amount;
      this.ledgerBalance += amount;
    } else {
      if (this.balance < amount) {
        throw new Error("Insufficient funds");
      }
      this.balance -= amount;
      this.ledgerBalance -= amount;
    }

    this.lastActivityAt = new Date();
    await this.save();

    logger.info("Wallet balance updated", {
      walletId: this._id,
      userId: this.user,
      amount: amount,
      transactionType: isCredit ? "credit" : "debit",
      newBalance: this.balance,
      currency: this.currency,
    });

    return this;
  } catch (error) {
    logger.error("Error updating wallet balance", {
      walletId: this._id,
      userId: this.user,
      amount: amount,
      transactionType: isCredit ? "credit" : "debit",
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

// Method to check if transaction is within limits
WalletSchema.methods.checkTransactionLimits = function (amount) {
  if (amount > this.securitySettings.transferLimit.singleTransaction) {
    return {
      allowed: false,
      reason: `Amount exceeds single transaction limit of ${this.securitySettings.transferLimit.singleTransaction} ${this.currency}`,
    };
  }

  // Additional limit checks can be implemented here

  return { allowed: true };
};

// Create indexes
WalletSchema.index({ user: 1 });
// WalletSchema.index({ address: 1 });
WalletSchema.index({ currency: 1 });
WalletSchema.index({ status: 1 });

const Wallet = mongoose.model("Wallet", WalletSchema);

module.exports = Wallet;
