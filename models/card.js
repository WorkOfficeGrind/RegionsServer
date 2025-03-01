const mongoose = require("mongoose");

const CardSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["Debit", "Credit", "Black", "Platinum"],
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    phone: {
      type: String,
      required: true,
      unique: true,
    },
    bank: {
      type: String,
      required: true,
    },
    number: {
      type: String,
      required: true,
      unique: true,
    },
    month: {
      type: String,
      required: true,
      unique: true,
    },
    year: {
      type: String,
      required: true,
      unique: true,
    },
    cvv: {
      type: String,
      required: true,
      unique: true,
    },
    address: {
      type: String,
      required: true,
      unique: true,
    },
    city: {
      type: String,
      required: true,
      unique: true,
    },
    state: {
      type: String,
      required: true,
      unique: true,
    },
    zipCode: {
      type: String,
      required: true,
      unique: true,
    },
    last4: {
      type: String,
    },
    routingNumber: {
      type: String,
      required: true,
      unique: true,
    },
    availableBalance: {
      type: Number,
      required: true,
    },
    ledgerBalance: {
      type: Number,
      required: true,
    },
    reach: {
      type: String,
      required: true,
    },
    transactions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Transaction",
      },
    ],
    zelle: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Zelle",
      },
    ],
    cashApp: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Cashapp",
      },
    ],
    venmo: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Venmo",
      },
    ],
    paypal: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Paypal",
      },
    ],
    applePay: {
      type: Boolean,
    },
    googlePay: {
      type: Boolean,
    },
  },
  { versionKey: false, timestamps: true }
);

const Card = mongoose.model("Card", CardSchema);

module.exports = Card;
