


const mongoose = require("mongoose");

const TransactionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["Deposit", "Withdrawal", "Transfer", "Payment"],
      required: true,
    },
    fromAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
    },
    toAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
    },
    fromUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    toUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: "USD",
    },
    status: {
      type: String,
      enum: ["Pending", "Completed", "Failed"],
      default: "Pending",
    },
    narration: {
      type: String,
    },
    reference: {
      type: String,
      unique: true,
    },
    transactionId: {
      type: String,
      unique: true,
    },
    fees: {
      type: Number,
      default: 0,
    },
    processingDate: {
      type: Date,
    },
  },
  { versionKey: false, timestamps: true }
);

// Generate unique transaction reference
TransactionSchema.pre("save", function (next) {
  if (!this.reference) {
    const prefix = this.type.substring(0, 3).toUpperCase();
    const timestamp = Date.now().toString().substring(6);
    const random = Math.floor(Math.random() * 9000 + 1000);
    this.reference = `${prefix}-${timestamp}-${random}`;
  }

  if (!this.transactionId) {
    this.transactionId = mongoose.Types.ObjectId().toString();
  }

  next();
});

const Transaction = mongoose.model("Transaction", TransactionSchema);

module.exports = Transaction;