const mongoose = require("mongoose");
const { logger } = require("../config/logger");

const PaypalSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      required: [true, "Email is required for Paypal"],
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    verificationDate: {
      type: Date,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "pending", "suspended"],
      default: "pending",
    },
    accountType: {
      type: String,
      enum: ["personal", "business"],
      default: "personal",
    },
    businessName: {
      type: String,
      trim: true,
    },
    lastUsed: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Post-save hook
PaypalSchema.post("save", function (doc) {
  logger.info("Paypal account saved", {
    paypalId: doc._id,
    userId: doc.user,
    email: doc.email,
    status: doc.status,
    accountType: doc.accountType,
    action: this.isNew ? "created" : "updated",
  });
});

const Paypal = mongoose.model("Paypal", PaypalSchema);

module.exports = Paypal;