const mongoose = require("mongoose");
const { transactionLogger } = require("../config/logger");

const TransactionSchema = new mongoose.Schema(
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
        "payment",
        "refund",
        "exchange",
        "fee",
        "investment",
        "interest",
      ],
      required: [true, "Transaction type is required"],
    },
    amount: {
      type: Number,
      required: [true, "Amount is required"],
      min: [0.01, "Amount must be greater than 0"],
    },
    source: {
      type: String,
      refPath: "sourceType",
      required: true,
    },
    sourceType: {
      type: String,
      required: [true, "Source type is required"],
      enum: ["Account", "Card", "Wallet", "external"],
    },
    sourceCurrency: {
      type: String,
      required: [true, "Source currency is required"],
      default: "USD",
    },
    destination: {
      type: String,
      refPath: "destinationType",
      required: true,
    },
    destinationType: {
      type: String,
      required: [true, "Destination type is required"],
      enum: ["Account", "Card", "Wallet", "external"],
    },
    destinationCurrency: {
      type: String,
      required: [true, "Destination currency is required"],
      default: "USD",
    },
    description: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: [
        "pending",
        "completed",
        "failed",
        "cancelled",
        "refunded",
        "processing",
      ],
      default: "pending",
    },
    reference: {
      type: String,
      unique: true,
      required: true,
    },
    fee: {
      type: Number,
      default: 0,
    },
    conversionRate: {
      type: Number,
      default: 1,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
    failureReason: {
      type: String,
    },
    processedAt: {
      type: Date,
    },
    processingDuration: {
      type: Number, // In milliseconds
    },
    ipAddress: String,
    userAgent: String,
    deviceInfo: mongoose.Schema.Types.Mixed,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Define a post-initialization hook for detailed transaction logging
TransactionSchema.post("init", function () {
  this._original = this.toObject();
});

// Define a virtual for total amount (including fees)
TransactionSchema.virtual("totalAmount").get(function () {
  return this.amount + this.fee;
});

// Generate a unique reference number for transactions
const generateUniqueReference = () => {
  const timestamp = new Date().getTime().toString().slice(-8);
  const random = Math.floor(Math.random() * 100000)
    .toString()
    .padStart(5, "0");
  return `TXN${timestamp}${random}`;
};

// Pre-save middleware
TransactionSchema.pre("save", function (next) {
  // If new transaction
  if (this.isNew) {
    // Assign reference number if not set already
    if (!this.reference) {
      this.reference = generateUniqueReference();
    }

    // Log new transaction
    transactionLogger.info("New transaction initiated", {
      transactionId: this._id,
      userId: this.user,
      amount: this.amount,
      type: this.type,
      source: `${this.sourceType}:${this.sourceId}`,
      destination: `${this.destinationType}:${this.destinationId}`,
      status: this.status,
      reference: this.reference,
    });
  } else {
    // Log transaction update, focusing on status changes
    if (this._original && this._original.status !== this.status) {
      transactionLogger.info("Transaction status changed", {
        transactionId: this._id,
        userId: this.user,
        amount: this.amount,
        type: this.type,
        previousStatus: this._original.status,
        newStatus: this.status,
        reference: this.reference,
        failureReason: this.failureReason,
      });
    }
  }

  // Calculate processing duration if the transaction is now completed
  if (
    this.isModified("status") &&
    this.status === "completed" &&
    !this.processedAt
  ) {
    this.processedAt = new Date();
    this.processingDuration = this.processedAt - this.createdAt;
  }

  next();
});

// Post-save middleware
TransactionSchema.post("save", function (doc) {
  // Log after saving
  transactionLogger.info("Transaction saved", {
    transactionId: doc._id,
    userId: doc.user,
    amount: doc.amount,
    status: doc.status,
    reference: doc.reference,
  });
});

// Post-remove middleware
TransactionSchema.post("remove", function (doc) {
  // Log after removing
  transactionLogger.warn("Transaction removed", {
    transactionId: doc._id,
    userId: doc.user,
    reference: doc.reference,
  });
});

// Method to complete a transaction
TransactionSchema.methods.complete = async function () {
  try {
    this.status = "completed";
    this.processedAt = new Date();
    this.processingDuration = this.processedAt - this.createdAt;

    await this.save();

    transactionLogger.info("Transaction completed", {
      transactionId: this._id,
      userId: this.user,
      reference: this.reference,
      processingTime: this.processingDuration,
    });

    return this;
  } catch (error) {
    transactionLogger.error("Error completing transaction", {
      transactionId: this._id,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

// Method to fail a transaction
TransactionSchema.methods.fail = async function (reason) {
  try {
    this.status = "failed";
    this.failureReason = reason || "Unknown error";
    this.processedAt = new Date();
    this.processingDuration = this.processedAt - this.createdAt;

    await this.save();

    transactionLogger.warn("Transaction failed", {
      transactionId: this._id,
      userId: this.user,
      reference: this.reference,
      reason: this.failureReason,
    });

    return this;
  } catch (error) {
    transactionLogger.error("Error marking transaction as failed", {
      transactionId: this._id,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

// Create indexes
TransactionSchema.index({ user: 1 });
// TransactionSchema.index({ reference: 1 });
TransactionSchema.index({ status: 1 });
TransactionSchema.index({ createdAt: 1 });
TransactionSchema.index({ sourceId: 1, sourceType: 1 });
TransactionSchema.index({ destinationId: 1, destinationType: 1 });

const Transaction = mongoose.model("Transaction", TransactionSchema);

module.exports = Transaction;
