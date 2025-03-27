const mongoose = require("mongoose");
const { logger } = require("../config/logger");

const AllocationSchema = new mongoose.Schema({
  asset: {
    type: String,
    required: true,
  },
  percentage: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
  },
  color: {
    type: String,
    default: "#4CAF50", // Default color
  },
});

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
    maturityPeriod: {
      type: Number,
      required: [true, "Maturity period is required"],
      min: [1, "Maturity period must be at least 1 day"],
    },
    minInvestment: {
      type: Number,
      required: [true, "Minimum investment is required"],
      min: [1, "Minimum investment must be at least 1"],
    },
    currency: {
      type: String,
      required: [true, "Currency is required"],
      uppercase: true,
      default: "USD",
    },
    expectedReturnMin: {
      type: Number,
      required: [true, "Minimum expected return is required"],
    },
    expectedReturnMax: {
      type: Number,
      required: [true, "Maximum expected return is required"],
    },
    riskLevel: {
      type: String,
      enum: ["low", "medium", "high", "very_high"],
      required: [true, "Risk level is required"],
      default: "low",
    },
    description: {
      type: String,
      trim: true,
      required: [true, "Description is required"],
    },
    managementFee: {
      type: Number,
      default: 0, // As a percentage
    },
    allocations: [AllocationSchema],
    icon: {
      type: String,
      default: "chart-line", // Default icon name
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    features: [String],
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for formatting expected return range
InvestmentPlanSchema.virtual("expectedReturnRange").get(function () {
  return `${this.expectedReturnMin}-${this.expectedReturnMax}%`;
});

// Create indexes
// InvestmentPlanSchema.index({ name: 1 }, { unique: true });
InvestmentPlanSchema.index({ symbol: 1 });
InvestmentPlanSchema.index({ isActive: 1 });
InvestmentPlanSchema.index({ expectedReturnMin: 1, expectedReturnMax: 1 });
InvestmentPlanSchema.index({ riskLevel: 1 });
InvestmentPlanSchema.index({ isFeatured: 1 });

const InvestmentPlan = mongoose.model("InvestmentPlan", InvestmentPlanSchema);

module.exports = InvestmentPlan;
