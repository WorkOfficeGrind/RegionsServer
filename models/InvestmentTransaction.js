const mongoose = require("mongoose");
const User = require("./User");

const InvestmentTransactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["credit", "debit", "investment", "return"],
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
    sourceAmount: {
      type: Number,
      required: [true, "Source amount is required"],
      min: [0.00001, "Source amount must be greater than 0"],
    },
    source: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Wallet",
      required: true,
    },
    sourceType: {
      type: String,
      required: [true, "Source type is required"],
      enum: ["Wallet", "Account", "Card", "UserInvestment", "external"],
    },
    sourceCurrency: {
      type: String,
      required: [true, "Source currency is required"],
      uppercase: true,
    },
    beneficiary: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Wallet",
      required: true,
    },
    beneficiaryType: {
      type: String,
      required: [true, "Destination type is required"],
      enum: ["Wallet", "Account", "Card", "UserInvestment", "external"],
    },
    beneficiaryCurrency: {
      type: String,
      required: [true, "Destination currency is required"],
      uppercase: true,
    },

    description: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "pending",
    },
    reference: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

InvestmentTransactionSchema.index({ user: 1 });
InvestmentTransactionSchema.index({ source: 1 });
InvestmentTransactionSchema.index({ beneficiary: 1 });
InvestmentTransactionSchema.index({ status: 1 });

const InvestmentTransaction = mongoose.model(
  "InvestmentTransaction",
  InvestmentTransactionSchema
);

module.exports = InvestmentTransaction;
