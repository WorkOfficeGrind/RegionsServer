const mongoose = require("mongoose");

const nameChangeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    //   index: true,
    },
    currentFirstName: {
      type: String,
      required: true,
    },
    currentLastName: {
      type: String,
      required: true,
    },
    requestedFirstName: {
      type: String,
      required: true,
    },
    requestedLastName: {
      type: String,
      required: true,
    },
    // Added verification fields from the NameChangeVerification model
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
    status: {
      type: String,
      enum: ["pending_review", "approved", "rejected"],
      default: "pending_review",
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
nameChangeSchema.index({ userId: 1, status: 1 });
nameChangeSchema.index({ status: 1, requestDate: 1 });

const NameChange = mongoose.model("NameChange", nameChangeSchema);

module.exports = NameChange;
