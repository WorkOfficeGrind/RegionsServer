const mongoose = require("mongoose");
const { logger } = require("../config/logger");

const VenmoSchema = new mongoose.Schema(
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
      required: [true, "Email is required for Venmo"],
    },
    username: {
      type: String,
      trim: true,
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
    lastUsed: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Post-save hook
VenmoSchema.post("save", function (doc) {
  logger.info("Venmo account saved", {
    venmoId: doc._id,
    userId: doc.user,
    email: doc.email,
    status: doc.status,
    action: this.isNew ? "created" : "updated",
  });
});

const Venmo = mongoose.model("Venmo", VenmoSchema);

module.exports = Venmo