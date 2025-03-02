const mongoose = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");


const WalletTransactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // type: {
    //   type: String,
    //   enum: ["deposit", "withdrawal", "transfer"],
    //   required: true,
    // },
    type: {
      type: String,
      enum: ["deposit", "withdrawal", "swap", "payment", "refund", "fee"],
      required: [true, "Transaction type is required"],
    },
    amount: {
      type: mongoose.Schema.Types.Decimal128,
      required: [true, "Amount is required"],
      get: (v) => (v ? parseFloat(v.toString()) : 0),
    },
    currency: {
      type: String,
      required: [true, "Currency is required"],
      uppercase: true,
    },
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, "Source ID is required"],
    },
    sourceType: {
      type: String,
      enum: ["wallet", "account", "card", "external"],
      required: [true, "Source type is required"],
    },
    destinationId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, "Destination ID is required"],
    },
    destinationType: {
      type: String,
      enum: ["wallet", "account", "card", "external"],
      required: [true, "Destination type is required"],
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
    fee: {
      type: mongoose.Schema.Types.Decimal128,
      default: mongoose.Types.Decimal128.fromString("0"),
      get: (v) => (v ? parseFloat(v.toString()) : 0),
    },
    feeCurrency: {
      type: String,
      uppercase: true,
      default: "USD",
    },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed", "reversed"],
      default: "pending",
    },
    description: {
      type: String,
      default: "",
    },
    reference: {
      type: String,
      required: [true, "Reference is required"],
      unique: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    failureReason: {
      type: String,
      default: null,
    },
  },
  {
    versionKey: false,
    timestamps: true,
    toJSON: { getters: true, virtuals: true },
    toObject: { getters: true, virtuals: true },
  }
);

// Indexes for performance
WalletTransactionSchema.index({ user: 1, createdAt: -1 });
// WalletTransactionSchema.index({ reference: 1 }, { unique: true });
WalletTransactionSchema.index({ sourceId: 1, sourceType: 1 });
WalletTransactionSchema.index({ destinationId: 1, destinationType: 1 });
WalletTransactionSchema.index({ status: 1 });
WalletTransactionSchema.index({ type: 1 });



WalletTransactionSchema.plugin(mongoosePaginate);

const WalletTransaction = mongoose.model(
  "WalletTransaction",
  WalletTransactionSchema
);

module.exports = WalletTransaction;

