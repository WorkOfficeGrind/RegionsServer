const mongoose = require("mongoose");
const { transactionLogger } = require("../config/logger");

const WalletTransactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: [
        "deposit",
        "withdrawal",
        "transfer",
        "exchange",
        "fee",
        "investment",
        "return",
      ],
      required: [true, "Transaction type is required"],
    },
    amount: {
      type: Number,
      required: [true, "Amount is required"],
      min: [0.00001, "Amount must be greater than 0"],
    },
    currency: {
      type: String,
      required: [true, "Currency is required"],
      uppercase: true,
    },
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "sourceType",
      required: true,
    },
    sourceType: {
      type: String,
      required: [true, "Source type is required"],
      enum: ["Wallet", "Account", "Card", "external"],
    },
    sourceCurrency: {
      type: String,
      required: [true, "Source currency is required"],
      uppercase: true,
    },
    destinationId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "destinationType",
      required: true,
    },
    destinationType: {
      type: String,
      required: [true, "Destination type is required"],
      enum: ["Wallet", "Account", "Card", "external"],
    },
    destinationCurrency: {
      type: String,
      required: [true, "Destination currency is required"],
      uppercase: true,
    },
    conversionRate: {
      type: Number,
      default: 1,
    },
    feeCurrency: {
      type: String,
      uppercase: true,
    },
    fee: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "cancelled", "processing"],
      default: "pending",
    },
    description: {
      type: String,
      trim: true,
    },
    reference: {
      type: String,
      unique: true,
      required: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
    failureReason: {
      type: String,
    },
    completedAt: Date,
    networkConfirmations: {
      required: {
        type: Number,
        default: 1,
      },
      current: {
        type: Number,
        default: 0,
      },
    },
    hash: String, // Blockchain transaction hash
    blockNumber: Number, // Blockchain block number
    ipAddress: String,
    userAgent: String,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Generate unique reference
function generateReference() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `WT${timestamp}${random}`.toUpperCase();
}

// Post-init hook for tracking changes
WalletTransactionSchema.post("init", function () {
  this._original = this.toObject();
});

// Virtual for equivalent amount in USD
WalletTransactionSchema.virtual("usdAmount").get(function () {
  // This would typically involve a currency conversion service call
  // For now, using a simple placeholder
  if (this.currency === "USD") return this.amount;
  return this.amount * this.conversionRate;
});

// Pre-save middleware
WalletTransactionSchema.pre("save", function (next) {
  // Generate reference if new transaction
  if (this.isNew && !this.reference) {
    this.reference = generateReference();
  }

  // Log status changes
  if (!this.isNew && this._original && this._original.status !== this.status) {
    transactionLogger.info("Wallet transaction status changed", {
      transactionId: this._id,
      userId: this.user,
      reference: this.reference,
      previousStatus: this._original.status,
      newStatus: this.status,
      amount: this.amount,
      currency: this.currency,
    });
  }

  // Set completion timestamp if completed
  if (
    this.isModified("status") &&
    this.status === "completed" &&
    !this.completedAt
  ) {
    this.completedAt = new Date();
  }

  next();
});

// Post-save middleware
WalletTransactionSchema.post("save", function (doc) {
  let logLevel = "info";
  let message = "Wallet transaction saved";

  if (doc.status === "failed") {
    logLevel = "warn";
    message = "Wallet transaction failed";
  }

  transactionLogger[logLevel](message, {
    transactionId: doc._id,
    userId: doc.user,
    reference: doc.reference,
    type: doc.type,
    amount: doc.amount,
    currency: doc.currency,
    status: doc.status,
    failureReason: doc.status === "failed" ? doc.failureReason : undefined,
  });
});

// Method to complete transaction
WalletTransactionSchema.methods.complete = async function () {
  try {
    this.status = "completed";
    this.completedAt = new Date();

    await this.save();

    transactionLogger.info("Wallet transaction completed", {
      transactionId: this._id,
      userId: this.user,
      reference: this.reference,
      processingTime: this.completedAt - this.createdAt,
    });

    return this;
  } catch (error) {
    transactionLogger.error("Error completing wallet transaction", {
      transactionId: this._id,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

// Method to fail transaction
WalletTransactionSchema.methods.fail = async function (reason) {
  try {
    this.status = "failed";
    this.failureReason = reason || "Unknown error";

    await this.save();

    transactionLogger.warn("Wallet transaction failed", {
      transactionId: this._id,
      userId: this.user,
      reference: this.reference,
      reason: this.failureReason,
    });

    return this;
  } catch (error) {
    transactionLogger.error("Error marking wallet transaction as failed", {
      transactionId: this._id,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

// Create indexes
WalletTransactionSchema.index({ user: 1 });
// WalletTransactionSchema.index({ reference: 1 }, { unique: true });
WalletTransactionSchema.index({ status: 1 });
WalletTransactionSchema.index({ createdAt: 1 });
WalletTransactionSchema.index({ currency: 1 });
WalletTransactionSchema.index({ sourceId: 1, sourceType: 1 });
WalletTransactionSchema.index({ destinationId: 1, destinationType: 1 });

const WalletTransaction = mongoose.model(
  "WalletTransaction",
  WalletTransactionSchema
);

module.exports = WalletTransaction;
