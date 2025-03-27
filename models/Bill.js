const mongoose = require("mongoose");
const { logger } = require("../config/logger");
const { required } = require("joi");

const BillSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    icon: {
      type: String,
    },
    title: {
      type: String,
      required: [true, "Bill title is required"],
      trim: true,
    },
    customName: {
      type: String,
      trim: true,
    },
    label: {
      type: String,
      trim: true,
    },
    amount: {
      type: Number,
      required: [true, "Bill amount is required"],
      min: [0.01, "Bill amount must be greater than 0"],
    },
    dueDate: {
      type: Date,
      required: [true, "Due date is required"],
    },
    accountNumber: {
      type: String,
      trim: true,
    },
    provider: {
      type: String,
      required: [true, "Provider name is required"],
      trim: true,
    },
    paymentMethod: {
      type: String,
      required: true,
    },
    paymentMethodType: {
      type: String,
      required: [true, "Payment method is required"],
      enum: ["Account", "Card", "Wallet"],
    },
    isEbillEnrolled: {
      type: Boolean,
      default: false,
    },
    processingTime: {
      type: String,
      default: "1-2 business days",
    },
    lastPaymentDate: {
      type: Date,
    },
    lastPaymentAmount: {
      type: Number,
    },
    isRecurring: {
      type: Boolean,
      default: false,
    },
    recurringDetails: {
      frequency: {
        type: String,
        enum: [
          "weekly",
          "biweekly",
          "monthly",
          "quarterly",
          "semiannually",
          "annually",
        ],
      },
      nextPaymentDate: Date,
      dayOfMonth: Number,
      dayOfWeek: Number,
      endDate: Date,
      autopay: {
        type: Boolean,
        default: false,
      },
    },
    category: {
      type: String,
      enum: [
        "utility",
        "housing",
        "transportation",
        "insurance",
        "subscription",
        "loan",
        "credit_card",
        "other",
      ],
      default: "other",
    },
    status: {
      type: String,
      enum: ["pending", "paid", "overdue", "cancelled", "scheduled"],
      default: "pending",
    },
    reminders: [
      {
        reminderType: {
          type: String,
          enum: ["email", "push", "sms"],
          required: true,
        },
        daysBeforeDue: {
          type: Number,
          required: true,
        },
        enabled: {
          type: Boolean,
          default: true,
        },
        lastSent: Date,
      },
    ],
    notes: {
      type: String,
      trim: true,
    },
    attachments: [
      {
        fileName: String,
        fileType: String,
        fileUrl: String,
        uploadDate: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    paymentHistory: [
      {
        paymentDate: {
          type: Date,
          required: true,
        },
        amount: {
          type: Number,
          required: true,
        },
        status: {
          type: String,
          enum: ["completed", "failed", "pending", "refunded"],
          required: true,
        },
        transactionId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Transaction",
        },
        confirmationNumber: String,
        notes: String,
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for days remaining until due
BillSchema.virtual("daysRemaining").get(function () {
  const now = new Date();
  const due = new Date(this.dueDate);
  const diffTime = due - now;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Virtual for display name (custom name or title)
BillSchema.virtual("displayName").get(function () {
  return this.customName || this.title;
});

// Virtual for payment status
BillSchema.virtual("paymentStatus").get(function () {
  if (this.status === "paid") return "Paid";

  const now = new Date();
  const due = new Date(this.dueDate);

  if (now > due) return "Overdue";
  if (this.status === "scheduled") return "Scheduled";

  return "Due Soon";
});

// Pre-save hook
BillSchema.pre("save", function (next) {
  // If recurring bill, ensure recurringDetails is properly set
  if (
    this.isRecurring &&
    (!this.recurringDetails || !this.recurringDetails.frequency)
  ) {
    const error = new Error("Recurring bills must have frequency specified");
    return next(error);
  }

  // If due date has passed, mark as overdue
  const now = new Date();
  if (this.dueDate < now && this.status === "pending") {
    this.status = "overdue";
  }

  // Set the next payment date for recurring bills if not set already
  if (this.isRecurring && !this.recurringDetails.nextPaymentDate) {
    this.recurringDetails.nextPaymentDate = this.dueDate;
  }

  next();
});

// Post-save hook
BillSchema.post("save", function (doc) {
  logger.info("Bill saved", {
    billId: doc._id,
    userId: doc.user,
    provider: doc.provider,
    amount: doc.amount,
    dueDate: doc.dueDate,
    status: doc.status,
    action: this.isNew ? "created" : "updated",
  });
});

// Method to mark bill as paid
BillSchema.methods.markAsPaid = async function (
  amount,
  transactionId,
  confirmationNumber,
  notes
) {
  try {
    this.status = "paid";
    this.lastPaymentDate = new Date();
    this.lastPaymentAmount = amount || this.amount;

    // Add to payment history
    this.paymentHistory.push({
      paymentDate: new Date(),
      amount: amount || this.amount,
      status: "completed",
      transactionId,
      confirmationNumber,
      notes,
    });

    // If recurring, schedule next payment
    if (this.isRecurring) {
      const nextDate = this.calculateNextPaymentDate();

      this.dueDate = nextDate;
      this.status = "pending";

      if (this.recurringDetails) {
        this.recurringDetails.nextPaymentDate = nextDate;
      }
    }

    await this.save();

    logger.info("Bill marked as paid", {
      billId: this._id,
      userId: this.user,
      amount: amount || this.amount,
      transactionId: transactionId,
      confirmationNumber: confirmationNumber,
    });

    return {
      success: true,
      message: "Bill marked as paid",
      nextDueDate: this.isRecurring ? this.dueDate : null,
    };
  } catch (error) {
    logger.error("Error marking bill as paid", {
      billId: this._id,
      userId: this.user,
      error: error.message,
      stack: error.stack,
    });

    throw error;
  }
};

// Method to schedule a payment
BillSchema.methods.schedulePayment = async function (
  paymentDate,
  paymentMethodId,
  paymentMethodType
) {
  try {
    if (new Date(paymentDate) < new Date()) {
      throw new Error("Scheduled payment date cannot be in the past");
    }

    this.status = "scheduled";
    this.paymentMethod = paymentMethodId;
    this.paymentMethodType = paymentMethodType;

    await this.save();

    logger.info("Bill payment scheduled", {
      billId: this._id,
      userId: this.user,
      scheduledDate: paymentDate,
      paymentMethod: `${paymentMethodType}:${paymentMethodId}`,
    });

    return {
      success: true,
      message: "Payment scheduled successfully",
      scheduledDate: paymentDate,
    };
  } catch (error) {
    logger.error("Error scheduling bill payment", {
      billId: this._id,
      userId: this.user,
      error: error.message,
      stack: error.stack,
    });

    throw error;
  }
};

// Helper method to calculate next payment date based on frequency
BillSchema.methods.calculateNextPaymentDate = function () {
  if (
    !this.isRecurring ||
    !this.recurringDetails ||
    !this.recurringDetails.frequency
  ) {
    return null;
  }

  const currentDueDate = new Date(this.dueDate);
  let nextDate = new Date(currentDueDate);

  switch (this.recurringDetails.frequency) {
    case "weekly":
      nextDate.setDate(nextDate.getDate() + 7);
      break;
    case "biweekly":
      nextDate.setDate(nextDate.getDate() + 14);
      break;
    case "monthly":
      nextDate.setMonth(nextDate.getMonth() + 1);
      break;
    case "quarterly":
      nextDate.setMonth(nextDate.getMonth() + 3);
      break;
    case "semiannually":
      nextDate.setMonth(nextDate.getMonth() + 6);
      break;
    case "annually":
      nextDate.setFullYear(nextDate.getFullYear() + 1);
      break;
    default:
      nextDate.setMonth(nextDate.getMonth() + 1);
  }

  return nextDate;
};

// Create indexes
BillSchema.index({ user: 1 });
BillSchema.index({ dueDate: 1 });
BillSchema.index({ status: 1 });
BillSchema.index({ isRecurring: 1 });
BillSchema.index({ "recurringDetails.nextPaymentDate": 1 });

const Bill = mongoose.model("Bill", BillSchema);

module.exports = Bill;
