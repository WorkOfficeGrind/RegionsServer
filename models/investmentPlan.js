const mongoose = require("mongoose");

const InvestmentPlanSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    symbol: { type: String, required: true, unique: true },
    image: { type: String, required: true },
    roi: { type: Number, required: true }, // Multiplier (e.g. 1.05 for a 5% gain)
    maturityPeriod: { type: Number, required: true }, // In days
  },
  { versionKey: false, timestamps: true }
);

// Middleware to update currentValue for active investments if ROI changes
InvestmentPlanSchema.post("findOneAndUpdate", async function (doc) {
  if (!doc) return;
  try {
    const UserInvestment = mongoose.model("UserInvestment");
    const investments = await UserInvestment.find({
      plan: doc._id,
      status: "active",
    });
    for (let inv of investments) {
      inv.currentValue = inv.investedAmount * doc.roi;
      await inv.save();
    }
    console.log(
      `Updated ${investments.length} investments for plan ${doc.symbol}`
    );
  } catch (err) {
    console.error("Error updating investments:", err);
  }
});

const InvestmentPlan = mongoose.model("InvestmentPlan", InvestmentPlanSchema);
module.exports = InvestmentPlan;
