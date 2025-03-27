const mongoose = require("mongoose");
const { logger } = require("../config/logger");

const PreloadedWalletSchema = new mongoose.Schema(
  {
    currency: {
      type: String,
      required: [true, "Currency is required"],
      trim: true,
      uppercase: true,
    },
    address: {
      type: String,
      required: [true, "Wallet address is required"],
      unique: true,
    },
    name: {
      type: String,
      required: [true, "Name is required"],
      unique: true,
    },
    image: {
      type: String,
      required: [true, "Image is required"],
      // unique: true,
    },
    privateKey: {
      type: String,
      // required: [true, "Private key is required"],
      select: false, // Never include in query results by default
    },
    assigned: {
      type: Boolean,
      default: false,
    },
    balance: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "assigned", "depleted"],
      default: "active",
    },
    assignedToUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    assignedWallet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Wallet",
    },
    assignedAt: {
      type: Date,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    notes: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Pre-save hook
PreloadedWalletSchema.pre("save", function (next) {
  // If being assigned, update status and date
  if (this.isModified("assigned") && this.assigned) {
    this.status = "assigned";
    this.assignedAt = new Date();
  }

  next();
});

// Post-save hook
PreloadedWalletSchema.post("save", function (doc) {
  // Avoid logging private key!
  logger.info("Preloaded wallet saved", {
    walletId: doc._id,
    currency: doc.currency,
    address: doc.address,
    status: doc.status,
    assigned: doc.assigned,
    action: this.isNew ? "created" : "updated",
  });
});

// Method to assign wallet to user
PreloadedWalletSchema.methods.assignToUser = async function (userId, walletId) {
  try {
    if (this.assigned) {
      throw new Error("Wallet is already assigned");
    }

    this.assigned = true;
    this.status = "assigned";
    this.assignedToUser = userId;
    this.assignedWallet = walletId;
    this.assignedAt = new Date();

    await this.save();

    logger.info("Preloaded wallet assigned to user", {
      walletId: this._id,
      currency: this.currency,
      address: this.address,
      assignedToUserId: userId,
      assignedWalletId: walletId,
    });

    return {
      success: true,
      message: "Wallet assigned successfully",
    };
  } catch (error) {
    logger.error("Error assigning preloaded wallet to user", {
      walletId: this._id,
      userId: userId,
      error: error.message,
      stack: error.stack,
    });

    throw error;
  }
};

// Static method to find available wallet for currency
PreloadedWalletSchema.statics.findAvailableWallet = async function (currency) {
  try {
    const wallet = await this.findOne({
      currency: currency.toUpperCase(),
      assigned: false,
      status: "active",
    });

    if (!wallet) {
      logger.warn("No available preloaded wallet found", {
        currency: currency.toUpperCase(),
      });
      return null;
    }

    return wallet;
  } catch (error) {
    logger.error("Error finding available preloaded wallet", {
      currency: currency,
      error: error.message,
      stack: error.stack,
    });

    throw error;
  }
};

// Create indexes
PreloadedWalletSchema.index({ currency: 1, assigned: 1, status: 1 });
// PreloadedWalletSchema.index({ address: 1 }, { unique: true });
PreloadedWalletSchema.index({ assignedToUser: 1 });

const PreloadedWallet = mongoose.model(
  "PreloadedWallet",
  PreloadedWalletSchema
);

module.exports = PreloadedWallet;
