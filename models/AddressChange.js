const mongoose = require("mongoose");
const { logger } = require("../config/logger");

const AddressChangeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Current address
    currentStreet1: String,
    currentStreet2: String,
    currentCity: String,
    currentState: String,
    currentZipCode: String,
    currentCountry: {
      type: String,
      default: "US",
    },
    // Requested address
    requestedStreet1: {
      type: String,
      required: true,
      trim: true,
    },
    requestedStreet2: {
      type: String,
      trim: true,
    },
    requestedCity: {
      type: String,
      required: true,
      trim: true,
    },
    requestedState: {
      type: String,
      required: true,
      trim: true,
    },
    requestedZipCode: {
      type: String,
      required: true,
      trim: true,
    },
    requestedCountry: {
      type: String,
      default: "US",
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
    proofOfAddressUrl: {
      type: String,
      required: true,
    },
    proofOfAddressPublicId: {
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

// Log address change creation and updates
AddressChangeSchema.post("save", function (doc) {
  logger.info("Address change request saved", {
    addressChangeId: doc._id,
    userId: doc.userId,
    status: doc.status,
    action: this.isNew ? "created" : "updated",
  });
});

// Create indexes
AddressChangeSchema.index({ status: 1, requestDate: -1 });
AddressChangeSchema.index({ userId: 1, status: 1 });

const AddressChange = mongoose.model("AddressChange", AddressChangeSchema);

module.exports = AddressChange;
