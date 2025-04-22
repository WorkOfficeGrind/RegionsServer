const mongoose = require("mongoose");
const { logger } = require("../config/logger");

const UserInvestmentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    plan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InvestmentPlan",
      required: true,
    },
    source: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Wallet",
      required: true,
    },
    label: {
      type: String,
      trim: true,
    },
    currency: {
      type: String,
      required: [true, "Currency is required"],
      uppercase: true,
      default: "USD",
    },
    rate: {
      type: Number,
      required: [true, "Interest rate is required"],
    },
    amount: {
      type: Number,
      required: [true, "Amount is required"],
      min: [1, "Amount is required"],
    },
    previousValue: {
      type: Number,
      required: [true, "Previous value is required"],
      default: function () {
        return this.amount; // Initially set to investment amount
      },
    },
    currentValue: {
      type: Number,
      required: [true, "Current value is required"],
      default: function () {
        return this.amount;
      },
    },
    investedAt: {
      type: Date,
      default: Date.now,
    },
    maturityDate: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "matured", "withdrawn", "cancelled"],
      default: "active",
    },
    compoundFrequency: {
      type: String,
      enum: ["daily", "weekly", "monthly", "quarterly", "annually", "none"],
      default: "monthly",
    },
    withdrawalAllowed: {
      type: Boolean,
      default: false,
    },
    earlyWithdrawalFee: {
      type: Number,
      default: 0,
    },
    lastInterestCalculatedAt: {
      type: Date,
      default: Date.now,
    },
    interestPaidOut: {
      type: Number,
      default: 0,
    },
    transactions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "InvestmentTransaction",
      },
    ],
    source: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Wallet",
      required: true,
    },

    // Add withdrawalHistory array to track withdrawals properly
    withdrawalHistory: [
      {
        amount: Number,
        date: Date,
        transactionReference: String,
        fee: Number,
      },
    ],
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for return on investment
UserInvestmentSchema.virtual("roi").get(function () {
  if (this.investedAmount === 0) return 0;
  return (
    ((this.currentValue - this.investedAmount) / this.investedAmount) * 100
  );
});

UserInvestmentSchema.virtual("investedAmount").get(function () {
  return this.amount; // Use amount field as investedAmount
});

// Virtual for remaining time
UserInvestmentSchema.virtual("remainingDays").get(function () {
  if (this.status !== "active") return 0;

  const now = new Date();
  const maturity = new Date(this.maturityDate);

  if (maturity <= now) return 0;

  const diffTime = Math.abs(maturity - now);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

UserInvestmentSchema.virtual("percentageChange").get(function () {
  if (!this.previousValue || this.previousValue === 0) return 0;
  return ((this.currentValue - this.previousValue) / this.previousValue) * 100;
});

// Virtual for progress percentage
UserInvestmentSchema.virtual("progressPercentage").get(function () {
  if (this.status !== "active") return 100;

  const start = new Date(this.investedAt);
  const end = new Date(this.maturityDate);
  const now = new Date();

  if (now >= end) return 100;
  if (now <= start) return 0;

  const totalDuration = end - start;
  const elapsed = now - start;

  return Math.min(100, Math.floor((elapsed / totalDuration) * 100));
});

// Pre-save hook
UserInvestmentSchema.pre("save", function (next) {
  // Generate label if not provided
  if (this.isNew && !this.label) {
    this.label = `Investment #${Date.now().toString().slice(-6)}`;
  }

  next();
});

// Post-save hook
UserInvestmentSchema.post("save", function (doc) {
  logger.info("User investment saved", {
    investmentId: doc._id,
    userId: doc.user,
    planId: doc.plan,
    amount: doc.investedAmount,
    status: doc.status,
    action: this.isNew ? "created" : "updated",
  });
});

UserInvestmentSchema.methods.recordValueChange = async function () {
  // Only update previousValue when calculating new interest
  this.previousValue = this.currentValue;
  await this.save();

  return {
    success: true,
    message: "Previous value recorded successfully",
    previousValue: this.previousValue,
  };
};

// Method to calculate interest
UserInvestmentSchema.methods.calculateInterest = async function (
  asOfDate = new Date()
) {
  try {
    if (this.status !== "active") {
      return {
        success: false,
        message: `Investment is ${this.status}, not active`,
      };
    }

    const lastCalculatedDate = new Date(this.lastInterestCalculatedAt);

    // Don't calculate if already calculated today
    if (
      lastCalculatedDate.getDate() === asOfDate.getDate() &&
      lastCalculatedDate.getMonth() === asOfDate.getMonth() &&
      lastCalculatedDate.getFullYear() === asOfDate.getFullYear()
    ) {
      return {
        success: true,
        message: "Interest already calculated today",
        currentValue: this.currentValue,
      };
    }

    // Check if this is after maturity date
    if (asOfDate > this.maturityDate) {
      this.status = "matured";
      await this.save();

      return {
        success: true,
        message: "Investment has matured",
        currentValue: this.currentValue,
      };
    }

    // Calculate days since last calculation
    const diffTime = Math.abs(asOfDate - lastCalculatedDate);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return {
        success: true,
        message: "No days have passed since last calculation",
        currentValue: this.currentValue,
      };
    }

    // ADD THIS HERE: Update previousValue before calculating new interest
    this.previousValue = this.currentValue;

    // Calculate interest based on compound frequency
    let interestRate = this.rate / 100;
    let periodsPerYear;

    // ... rest of your calculation logic ...

    // Update current value and last calculation date
    const interestEarned = newValue - this.currentValue;
    this.currentValue = newValue;
    this.lastInterestCalculatedAt = asOfDate;

    await this.save();

    logger.info("Investment interest calculated", {
      investmentId: this._id,
      userId: this.user,
      interestEarned: interestEarned,
      currentValue: this.currentValue,
      previousValue: this.previousValue,
      daysElapsed: diffDays,
    });

    return {
      success: true,
      message: "Interest calculated successfully",
      interestEarned: interestEarned,
      currentValue: this.currentValue,
      previousValue: this.previousValue,
    };
  } catch (error) {
    logger.error("Error calculating investment interest", {
      investmentId: this._id,
      userId: this.user,
      error: error.message,
      stack: error.stack,
    });

    throw error;
  }
};

// Method to withdraw investment
UserInvestmentSchema.methods.withdraw = async function (
  amount,
  transactionReference
) {
  try {
    if (this.status !== "active" && this.status !== "matured") {
      throw new Error(`Cannot withdraw from ${this.status} investment`);
    }

    const now = new Date();
    const maturityReached = now >= this.maturityDate;

    // Validate withdrawal
    if (!maturityReached && !this.withdrawalAllowed) {
      throw new Error("Early withdrawal is not allowed for this investment");
    }

    if (amount > this.currentValue) {
      throw new Error("Withdrawal amount exceeds available investment value");
    }

    // Calculate fee for early withdrawal
    let fee = 0;
    if (!maturityReached && this.earlyWithdrawalFee > 0) {
      fee = amount * (this.earlyWithdrawalFee / 100);
    }

    // Update investment
    const actualWithdrawal = amount - fee;
    this.currentValue -= amount;

    // Record withdrawal in history
    this.withdrawalHistory.push({
      amount: actualWithdrawal,
      date: now,
      transactionReference,
      fee,
    });

    // Update status if fully withdrawn
    if (this.currentValue <= 0) {
      this.status = "withdrawn";
    }

    await this.save();

    logger.info("Investment withdrawal processed", {
      investmentId: this._id,
      userId: this.user,
      withdrawalAmount: amount,
      fee: fee,
      remainingValue: this.currentValue,
      transactionReference: transactionReference,
    });

    return {
      success: true,
      withdrawalAmount: actualWithdrawal,
      fee: fee,
      remainingValue: this.currentValue,
      status: this.status,
    };
  } catch (error) {
    logger.error("Error processing investment withdrawal", {
      investmentId: this._id,
      userId: this.user,
      amount: amount,
      error: error.message,
      stack: error.stack,
    });

    throw error;
  }
};



// Create indexes
UserInvestmentSchema.index({ user: 1 });
UserInvestmentSchema.index({ plan: 1 });
UserInvestmentSchema.index({ status: 1 });
UserInvestmentSchema.index({ maturityDate: 1 });
UserInvestmentSchema.index({ investedAt: 1 });

const UserInvestment = mongoose.model("UserInvestment", UserInvestmentSchema);

module.exports = UserInvestment;
