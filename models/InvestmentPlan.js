const mongoose = require("mongoose");
const { logger } = require("../config/logger");

const InvestmentPlanSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Plan name is required"],
      trim: true,
      unique: true,
    },
    symbol: {
      type: String,
      required: [true, "Symbol is required"],
      trim: true,
      uppercase: true,
    },
    image: {
      type: String,
    },
    roi: {
      type: Number,
      required: [true, "Return on investment is required"],
      min: [0, "ROI cannot be negative"],
    },
    maturityPeriod: {
      type: Number,
      required: [true, "Maturity period is required"],
      min: [1, "Maturity period must be at least 1 day"],
    },
    maturityUnit: {
      type: String,
      enum: ["days", "weeks", "months", "years"],
      default: "days",
    },
    minInvestment: {
      type: Number,
      required: [true, "Minimum investment is required"],
      min: [1, "Minimum investment must be at least 1"],
    },
    maxInvestment: {
      type: Number,
    },
    currency: {
      type: String,
      required: [true, "Currency is required"],
      uppercase: true,
      default: "USD",
    },
    riskLevel: {
      type: String,
      enum: ["low", "medium", "high", "very_high"],
      required: [true, "Risk level is required"],
    },
    compoundFrequency: {
      type: String,
      enum: ["daily", "weekly", "monthly", "quarterly", "annually", "none"],
      default: "monthly",
    },
    allowEarlyWithdrawal: {
      type: Boolean,
      default: false,
    },
    earlyWithdrawalFee: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    description: {
      type: String,
      trim: true,
    },
    category: {
      type: String,
      enum: [
        "stocks",
        "bonds",
        "crypto",
        "forex",
        "realestate",
        "commodities",
        "mutual_funds",
        "etf",
        "other",
      ],
      required: [true, "Category is required"],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isPublic: {
      type: Boolean,
      default: true,
    },
    features: [String],
    tags: [String],
    maxSlots: {
      type: Number,
    },
    availableSlots: {
      type: Number,
    },
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

// Calculate maturity in days
InvestmentPlanSchema.virtual("maturityInDays").get(function () {
  const multipliers = {
    days: 1,
    weeks: 7,
    months: 30,
    years: 365,
  };

  return this.maturityPeriod * multipliers[this.maturityUnit];
});

// Format ROI as percentage
InvestmentPlanSchema.virtual("roiFormatted").get(function () {
  return `${this.roi}%`;
});

// Pre-save hook
InvestmentPlanSchema.pre("save", function (next) {
  // If availableSlots not set but maxSlots is, initialize it
  if (this.isNew && this.maxSlots && !this.availableSlots) {
    this.availableSlots = this.maxSlots;
  }

  next();
});

// Post-save hook
InvestmentPlanSchema.post("save", function (doc) {
  logger.info("Investment plan saved", {
    planId: doc._id,
    name: doc.name,
    roi: doc.roi,
    action: this.isNew ? "created" : "updated",
  });
});

// Method to calculate expected returns for a specific investment amount
InvestmentPlanSchema.methods.calculateReturns = function (
  amount,
  duration = null
) {
  // Validate input
  if (amount < this.minInvestment) {
    return {
      error: `Amount is below minimum investment of ${this.minInvestment} ${this.currency}`,
    };
  }

  if (this.maxInvestment && amount > this.maxInvestment) {
    return {
      error: `Amount exceeds maximum investment of ${this.maxInvestment} ${this.currency}`,
    };
  }

  // Use specified duration or plan's maturity period
  const daysToMaturity = duration || this.maturityInDays;

  // Calculate returns based on compound frequency
  let interestRate = this.roi / 100;
  let periods;

  switch (this.compoundFrequency) {
    case "daily":
      periods = daysToMaturity;
      interestRate = interestRate / 365;
      break;
    case "weekly":
      periods = daysToMaturity / 7;
      interestRate = interestRate / 52;
      break;
    case "monthly":
      periods = daysToMaturity / 30;
      interestRate = interestRate / 12;
      break;
    case "quarterly":
      periods = daysToMaturity / 90;
      interestRate = interestRate / 4;
      break;
    case "annually":
      periods = daysToMaturity / 365;
      break;
    case "none":
      // Simple interest
      return {
        initialInvestment: amount,
        expectedReturn: amount * (interestRate * (daysToMaturity / 365)),
        totalValue: amount * (1 + interestRate * (daysToMaturity / 365)),
        annualYield: this.roi,
      };
    default:
      periods = daysToMaturity / 30;
      interestRate = interestRate / 12;
  }

  // Apply compound interest formula: A = P(1 + r)^t
  const totalValue = amount * Math.pow(1 + interestRate, periods);
  const expectedReturn = totalValue - amount;

  return {
    initialInvestment: amount,
    expectedReturn: expectedReturn,
    totalValue: totalValue,
    annualYield: this.roi,
  };
};

// Method to decrease available slots
InvestmentPlanSchema.methods.reserveSlot = async function () {
  if (!this.maxSlots) return true; // No limit on slots

  if (this.availableSlots <= 0) {
    return false; // No slots available
  }

  this.availableSlots--;
  await this.save();

  logger.info("Investment plan slot reserved", {
    planId: this._id,
    name: this.name,
    availableSlots: this.availableSlots,
  });

  return true;
};

// Create indexes
// InvestmentPlanSchema.index({ name: 1 }, { unique: true });
InvestmentPlanSchema.index({ symbol: 1 });
InvestmentPlanSchema.index({ category: 1 });
InvestmentPlanSchema.index({ isActive: 1, isPublic: 1 });
InvestmentPlanSchema.index({ roi: 1 });
InvestmentPlanSchema.index({ riskLevel: 1 });

const InvestmentPlan = mongoose.model("InvestmentPlan", InvestmentPlanSchema);

module.exports = InvestmentPlan;
