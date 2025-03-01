const mongoose = require("mongoose");

const BeneficiarySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    image: {
      type: String,
    },
    accountNumber: {
      type: Number,
      required: true,
      unique: true,
    },
    routingNumber: {
      type: Number,
      required: true,
      unique: true,
    },
    bank: {
      type: String,
      required: true,
    },
    rank: {
      type: Number,
      //   required: true,
    },
  },
  { versionKey: false, timestamps: true }
);

const Beneficiary = mongoose.model("Beneficiary", BeneficiarySchema);

module.exports = Beneficiary;
