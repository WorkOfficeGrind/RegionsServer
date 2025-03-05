const mongoose = require("mongoose");
const { logger } = require("../config/logger");

const CashappSchema = new mongoose.Schema(
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
      required: [true, "Email is required for Cashapp"],
    },
    tag: {
      type: String,
      trim: true,
      required: [true, "Cashapp tag is required"],
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
CashappSchema.post("save", function (doc) {
  logger.info("Cashapp account saved", {
    cashappId: doc._id,
    userId: doc.user,
    tag: doc.tag,
    status: doc.status,
    action: this.isNew ? "created" : "updated",
  });
});

const Cashapp = mongoose.model("Cashapp", CashappSchema);

module.exports = Cashapp
