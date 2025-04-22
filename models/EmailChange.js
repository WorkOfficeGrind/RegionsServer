const mongoose = require("mongoose");

const emailChangeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    currentEmail: {
      type: String,
      required: true,
    },
    requestedEmail: {
      type: String,
      required: true,
    },
    // Verification fields
    verificationCode: {
      type: String,
      required: true,
    },
    verificationExpires: {
      type: Date,
      required: true,
    },
    verificationAttempts: {
      type: Number,
      default: 0,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    // Admin approval fields
    status: {
      type: String,
      enum: ["pending_verification", "pending_review", "approved", "rejected"],
      default: "pending_verification",
    },
    notes: {
      type: String,
    },
    rejectionReason: {
      type: String,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    reviewDate: {
      type: Date,
    },
    requestDate: {
      type: Date,
      default: Date.now,
    },
    completedDate: {
      type: Date,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Add indexes for more efficient queries
emailChangeSchema.index({ userId: 1, status: 1 });
emailChangeSchema.index({ status: 1, requestDate: 1 });
// emailChangeSchema.index({ requestedEmail: 1 }, { unique: true, sparse: true });

const EmailChange = mongoose.model("EmailChange", emailChangeSchema);

module.exports = EmailChange;
