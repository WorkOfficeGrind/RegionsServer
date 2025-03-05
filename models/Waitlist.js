const mongoose = require("mongoose");
const { logger } = require("../config/logger");

const WaitlistSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    currency: {
      type: String,
      required: [true, "Currency is required"],
      trim: true,
      uppercase: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "fulfilled"],
      default: "pending",
    },
    requestDate: {
      type: Date,
      default: Date.now,
    },
    priority: {
      type: Number,
      default: 0, // Higher number means higher priority
    },
    preloadedAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PreloadedWallet",
    },
    processingNotes: {
      type: String,
      trim: true,
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    processedAt: {
      type: Date,
    },
    notificationSent: {
      type: Boolean,
      default: false,
    },
    notificationDate: {
      type: Date,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Pre-save hook
WaitlistSchema.pre("save", function (next) {
  // If status changing to fulfilled, set date
  if (
    this.isModified("status") &&
    this.status === "fulfilled" &&
    !this.processedAt
  ) {
    this.processedAt = new Date();
  }

  next();
});

// Post-save hook
WaitlistSchema.post("save", function (doc) {
  logger.info("Waitlist entry saved", {
    waitlistId: doc._id,
    userId: doc.user,
    currency: doc.currency,
    status: doc.status,
    action: this.isNew ? "created" : "updated",
  });
});

// Method to approve request
WaitlistSchema.methods.approve = async function (adminUserId, notes) {
  try {
    if (this.status !== "pending") {
      throw new Error(`Cannot approve request with status: ${this.status}`);
    }

    this.status = "approved";
    this.processedBy = adminUserId;
    this.processedAt = new Date();

    if (notes) {
      this.processingNotes = notes;
    }

    await this.save();

    logger.info("Waitlist request approved", {
      waitlistId: this._id,
      userId: this.user,
      currency: this.currency,
      approvedBy: adminUserId,
    });

    return {
      success: true,
      message: "Waitlist request approved successfully",
    };
  } catch (error) {
    logger.error("Error approving waitlist request", {
      waitlistId: this._id,
      userId: this.user,
      error: error.message,
      stack: error.stack,
    });

    throw error;
  }
};

// Method to fulfill request
WaitlistSchema.methods.fulfill = async function (
  preloadedWalletId,
  adminUserId,
  notes
) {
  try {
    if (this.status !== "approved") {
      throw new Error(`Cannot fulfill request with status: ${this.status}`);
    }

    this.status = "fulfilled";
    this.preloadedAccount = preloadedWalletId;
    this.processedBy = adminUserId;
    this.processedAt = new Date();

    if (notes) {
      this.processingNotes = notes;
    }

    await this.save();

    logger.info("Waitlist request fulfilled", {
      waitlistId: this._id,
      userId: this.user,
      currency: this.currency,
      preloadedWalletId: preloadedWalletId,
      fulfilledBy: adminUserId,
    });

    return {
      success: true,
      message: "Waitlist request fulfilled successfully",
    };
  } catch (error) {
    logger.error("Error fulfilling waitlist request", {
      waitlistId: this._id,
      userId: this.user,
      error: error.message,
      stack: error.stack,
    });

    throw error;
  }
};

// Static method to get next in line for a currency
WaitlistSchema.statics.getNextInLine = async function (currency) {
  try {
    return await this.findOne({
      currency: currency.toUpperCase(),
      status: "approved",
    })
      .sort({ priority: -1, requestDate: 1 }) // Highest priority first, then oldest
      .populate("user", "email username");
  } catch (error) {
    logger.error("Error getting next waitlist request in line", {
      currency: currency,
      error: error.message,
      stack: error.stack,
    });

    throw error;
  }
};

// Create indexes
WaitlistSchema.index({ user: 1, currency: 1 });
WaitlistSchema.index({ currency: 1, status: 1 });
WaitlistSchema.index({ status: 1, priority: -1, requestDate: 1 });

const Waitlist = mongoose.model("Waitlist", WaitlistSchema);

module.exports = Waitlist;
