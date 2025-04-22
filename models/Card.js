const mongoose = require("mongoose");
const { logger } = require("../config/logger");

const CardSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["virtual", "physical", "debit", "credit", "prepaid"],
      required: [true, "Card type is required"],
    },
    name: {
      type: String,
      required: [true, "Cardholder name is required"],
      trim: true,
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
    bank: {
      type: String,
      required: [true, "Bank name is required"],
      trim: true,
    },
    number: {
      type: String,
      required: [true, "Card number is required"],
      select: false,
      unique: true,
    },
    month: {
      type: String,
      required: [true, "Expiration month is required"],
      select: false,
    },
    year: {
      type: String,
      required: [true, "Expiration year is required"],
      select: false,
    },
    cvv: {
      type: String,
      required: [true, "CVV is required"],
      select: false,
    },
    address: {
      type: String,
      trim: true,
    },
    city: {
      type: String,
      trim: true,
    },
    state: {
      type: String,
      trim: true,
    },
    zipCode: {
      type: String,
      trim: true,
    },
    last4: {
      type: String,
      required: true,
    },
    routingNumber: {
      type: String,
      trim: true,
    },
    availableBalance: {
      type: Number,
      default: 0,
    },
    ledgerBalance: {
      type: Number,
      default: 0,
    },
    reach: {
      type: Number,
      default: 0,
    },
    transactions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Transaction",
      },
    ],
    zelle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Zelle",
    },
    cashapp: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Cashapp",
    },
    venmo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Venmo",
    },
    paypal: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Paypal",
    },
    applepay: {
      enabled: {
        type: Boolean,
        default: false,
      },
      deviceId: String,
    },
    googlepay: {
      enabled: {
        type: Boolean,
        default: false,
      },
      deviceId: String,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "blocked", "expired", "pending"],
      default: "pending",
    },
    brand: {
      type: String,
      enum: ["visa", "mastercard", "amex", "discover", "other"],
      required: true,
    },
    limits: {
      dailyWithdrawal: {
        type: Number,
        default: 2000,
      },
      maxWithdrawalPerTransaction: {
        type: Number,
        default: 2000,
      },
      dailyTransfer: {
        type: Number,
        default: 5000,
      },
      maxTransferPerTransaction: {
        type: Number,
        default: 5000,
      },
      monthlyTransfer: {
        type: Number,
        default: 20000,
      },
      monthlyWithdrawal: {
        type: Number,
        default: 20000,
      },
    },
    issueDate: {
      type: Date,
      default: Date.now,
    },
    expiryDate: {
      type: Date,
      required: true,
    },
    activatedAt: Date,
    lastUsedAt: Date,
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

// Virtual for formatted expiry date
CardSchema.virtual("expiryFormatted").get(function () {
  return `${this.month}/${this.year.slice(-2)}`;
});

// Virtual for masked card number
CardSchema.virtual("maskedNumber").get(function () {
  return `**** **** **** ${this.last4}`;
});

// Check if card is expired
CardSchema.virtual("isExpired").get(function () {
  return this.expiryDate < new Date();
});

// Pre-save hook
CardSchema.pre("save", function (next) {
  // Set last4 from card number if not provided
  if (this.isModified("number") && !this.last4) {
    this.last4 = this.number.slice(-4);
  }

  // Log sensitive data operations
  if (this.isModified("number") || this.isModified("cvv")) {
    logger.warn("Sensitive card data was modified", {
      cardId: this._id,
      userId: this.user,
      operation: this.isNew ? "create" : "update",
    });
  }

  next();
});

// Post-save hook
CardSchema.post("save", function (doc) {
  logger.info("Card saved", {
    cardId: doc._id,
    userId: doc.user,
    type: doc.type,
    last4: doc.last4,
    status: doc.status,
    action: this.isNew ? "created" : "updated",
  });
});

// Method to update balance
CardSchema.methods.updateBalance = async function (amount, isCredit = true) {
  try {
    if (isCredit) {
      this.availableBalance += amount;
      this.ledgerBalance += amount;
    } else {
      if (this.availableBalance < amount) {
        throw new Error("Insufficient funds");
      }
      this.availableBalance -= amount;
      this.ledgerBalance -= amount;
    }

    this.lastUsedAt = new Date();
    await this.save();

    logger.info("Card balance updated", {
      cardId: this._id,
      userId: this.user,
      amount: amount,
      transactionType: isCredit ? "credit" : "debit",
      newBalance: this.availableBalance,
    });

    return this;
  } catch (error) {
    logger.error("Error updating card balance", {
      cardId: this._id,
      userId: this.user,
      amount: amount,
      transactionType: isCredit ? "credit" : "debit",
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

// Method to check if transaction is allowed
CardSchema.methods.validateTransaction = function (amount) {
  // Check if card is active
  if (this.status !== "active") {
    return {
      allowed: false,
      reason: `Card is ${this.status}`,
    };
  }

  // Check if card is expired
  if (this.isExpired) {
    return {
      allowed: false,
      reason: "Card is expired",
    };
  }

  // Check transaction limits
  if (amount > this.limits.perTransaction) {
    return {
      allowed: false,
      reason: `Amount exceeds per-transaction limit of ${this.limits.perTransaction}`,
    };
  }

  // Check available balance for debit cards
  if (this.type === "debit" && amount > this.availableBalance) {
    return {
      allowed: false,
      reason: "Insufficient funds",
    };
  }

  return { allowed: true };
};

// Create indexes
CardSchema.index({ user: 1 });
CardSchema.index({ status: 1 });
CardSchema.index({ last4: 1 });
CardSchema.index({ expiryDate: 1 });

const Card = mongoose.model("Card", CardSchema);

module.exports = Card;
