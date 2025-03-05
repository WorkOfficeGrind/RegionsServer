const mongoose = require("mongoose");
const { logger } = require("../config/logger");

const ZelleSchema = new mongoose.Schema(
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
    },
    phone: {
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
    isDefault: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "pending", "suspended"],
      default: "pending",
    },
    dailyLimit: {
      type: Number,
      default: 2500,
    },
    monthlyLimit: {
      type: Number,
      default: 20000,
    },
    lastUsed: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Pre-save hook
ZelleSchema.pre("save", function (next) {
  // At least one contact method is required
  if (!this.email && !this.phone) {
    return next(new Error("Either email or phone is required for Zelle"));
  }

  next();
});

// Post-save hook
ZelleSchema.post("save", function (doc) {
  logger.info("Zelle account saved", {
    zelleId: doc._id,
    userId: doc.user,
    status: doc.status,
    action: this.isNew ? "created" : "updated",
  });
});

const Zelle = mongoose.model("Zelle", ZelleSchema);


module.exports = Zelle