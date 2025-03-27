const mongoose = require("mongoose");
const { logger } = require("../config/logger");

const WalletBeneficiarySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: {
      type: String,
      required: [true, "Beneficiary name is required"],
      trim: true,
    },
    image: {
      type: String,
    },
    address: {
      type: String,
      required: [true, "Wallet Address is required"],
      trim: true,
    },
    currency: {
      type: String,
      required: [true, "Currency is required"],
      trim: true,
    },
    // bank: {
    //   type: String,
    //   required: [true, "Bank name is required"],
    //   trim: true,
    // },
    rank: {
      type: Number,
      default: 0,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    nickname: {
      type: String,
      trim: true,
    },
    relationship: {
      type: String,
      enum: ["family", "friend", "business", "other"],
      default: "other",
    },
    homeAddress: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: String,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "pending", "rejected"],
      default: "active",
    },
    // accountType: {
    //   type: String,
    //   enum: ["checking", "savings", "investment", "other"],
    //   default: "checking",
    // },
    // transferLimit: {
    //   daily: {
    //     type: Number,
    //     default: 1000,
    //   },
    //   transaction: {
    //     type: Number,
    //     default: 500,
    //   },
    // },
    isFavorite: {
      type: Boolean,
      default: false,
    },
    notes: {
      type: String,
      trim: true,
    },
    recentTransactions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "WalletTransaction",
      },
    ],
    verification: {
      isVerified: {
        type: Boolean,
        default: false,
      },
      method: {
        type: String,
        enum: ["microdeposit", "instant", "manual", "none"],
        default: "none",
      },
      verifiedAt: Date,
      verifiedBy: String,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for masked account number
WalletBeneficiarySchema.virtual("maskedAccountNumber").get(function () {
  const acc = this.accountNumber || "";
  if (acc.length <= 4) return acc;
  return "xxxx" + acc.slice(-4);
});

// Virtual for display name (nickname or name)
WalletBeneficiarySchema.virtual("displayName").get(function () {
  return this.nickname || this.name;
});

// Pre-save hook
WalletBeneficiarySchema.pre("save", function (next) {
  // Set display rank for favorites
  if (this.isModified("isFavorite") && this.isFavorite) {
    this.rank = 1;
  }

  next();
});

// Post-save hook
WalletBeneficiarySchema.post("save", function (doc) {
  logger.info("Beneficiary saved", {
    beneficiaryId: doc._id,
    userId: doc.user,
    name: doc.name,
    bank: doc.bank,
    status: doc.status,
    action: this.isNew ? "created" : "updated",
  });
});

// Method to verify beneficiary
WalletBeneficiarySchema.methods.verify = async function (
  method = "manual",
  verifiedBy = "system"
) {
  try {
    this.verification.isVerified = true;
    this.verification.method = method;
    this.verification.verifiedAt = new Date();
    this.verification.verifiedBy = verifiedBy;
    this.status = "active";

    await this.save();

    logger.info("Beneficiary verified", {
      beneficiaryId: this._id,
      userId: this.user,
      method: method,
      verifiedBy: verifiedBy,
    });

    return {
      success: true,
      message: "Beneficiary verified successfully",
    };
  } catch (error) {
    logger.error("Error verifying beneficiary", {
      beneficiaryId: this._id,
      userId: this.user,
      error: error.message,
      stack: error.stack,
    });

    throw error;
  }
};

// Method to make favorite
WalletBeneficiarySchema.methods.toggleFavorite = async function () {
  try {
    this.isFavorite = !this.isFavorite;
    this.rank = this.isFavorite ? 1 : 0;

    await this.save();

    logger.info("Beneficiary favorite status toggled", {
      beneficiaryId: this._id,
      userId: this.user,
      isFavorite: this.isFavorite,
    });

    return {
      success: true,
      isFavorite: this.isFavorite,
    };
  } catch (error) {
    logger.error("Error toggling beneficiary favorite status", {
      beneficiaryId: this._id,
      userId: this.user,
      error: error.message,
      stack: error.stack,
    });

    throw error;
  }
};

// Method to check transfer limit
WalletBeneficiarySchema.methods.checkTransferLimit = function (amount) {
  if (amount > this.transferLimit.transaction) {
    return {
      allowed: false,
      reason: `Amount exceeds per-transaction limit of ${this.transferLimit.transaction}`,
    };
  }

  // Additional checks could be implemented here

  return { allowed: true };
};

// Create indexes
WalletBeneficiarySchema.index({ user: 1 });
WalletBeneficiarySchema.index({ user: 1, name: 1 });
WalletBeneficiarySchema.index({ isFavorite: 1 });
WalletBeneficiarySchema.index({ status: 1 });

const WalletBeneficiary = mongoose.model("WalletBeneficiary", WalletBeneficiarySchema);

module.exports = WalletBeneficiary;
