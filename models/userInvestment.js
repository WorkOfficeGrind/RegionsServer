const mongoose = require("mongoose");

const UserInvestmentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    plan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InvestmentPlan",
      required: true,
    },
    wallet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Wallet",
      required: true,
    },
    investedAmount: { type: Number, required: true },
    currentValue: { type: Number },
    investedAt: { type: Date, default: Date.now },
    maturityDate: { type: Date },
    status: {
      type: String,
      enum: ["active", "matured", "withdrawn"],
      default: "active",
    },
  },
  { versionKey: false, timestamps: true }
);

// Pre-save middleware calculates maturity date and current value
UserInvestmentSchema.pre("save", async function (next) {
  // Ensure the plan is populated to access its fields
  if (!this.populated("plan")) {
    await this.populate("plan").execPopulate();
  }
  if (this.isNew) {
    // Calculate maturityDate using plan.maturityPeriod (assumed in days)
    this.maturityDate = new Date(
      this.investedAt.getTime() + this.plan.maturityPeriod * 24 * 60 * 60 * 1000
    );
  }
  // Compute current value based on the ROI multiplier
  this.currentValue = this.investedAmount * this.plan.roi;
  next();
});

const UserInvestment = mongoose.model("UserInvestment", UserInvestmentSchema);
module.exports = UserInvestment;
