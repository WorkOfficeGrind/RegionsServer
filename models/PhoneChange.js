const mongoose = require("mongoose");
const { logger } = require("../config/logger");

const PhoneChangeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    currentPhone: {
      type: String,
      trim: true,
    },
    requestedPhone: {
      type: String,
      required: [true, "Requested phone number is required"],
      trim: true,
    },
    // Verification images
    frontIdUrl: {
      type: String,
      required: true,
    },
    frontIdPublicId: {
      type: String,
      required: true,
    },
    backIdUrl: {
      type: String,
      required: true,
    },
    backIdPublicId: {
      type: String,
      required: true,
    },
    // Status and review info
    status: {
      type: String,
      enum: ["pending_review", "approved", "rejected"],
      default: "pending_review",
      index: true,
    },
    requestDate: {
      type: Date,
      default: Date.now,
      index: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    reviewDate: Date,
    completedDate: Date,
    rejectionReason: String,
    notes: String,
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Log phone change creation and updates
PhoneChangeSchema.post("save", function (doc) {
  logger.info("Phone change request saved", {
    phoneChangeId: doc._id,
    userId: doc.userId,
    status: doc.status,
    action: this.isNew ? "created" : "updated",
  });
});

// Create indexes
PhoneChangeSchema.index({ status: 1, requestDate: -1 });
PhoneChangeSchema.index({ userId: 1, status: 1 });

const PhoneChange = mongoose.model("PhoneChange", PhoneChangeSchema);

module.exports = PhoneChange;
