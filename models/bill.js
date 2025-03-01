const mongoose = require("mongoose");

const RecurringDetailsSchema = new mongoose.Schema({
  frequency: { type: String, required: true },
  nextDate: { type: String, required: true },
  amount: { type: String, required: true },
});

const BillSchema = new mongoose.Schema({
  icon: { type: String, required: true },
  title: { type: String, required: true },
  customName: { type: String },
  label: { type: String },
  amount: { type: Number, required: true },
  dueDate: { type: String, required: true },
  accountNumber: { type: String, required: true },
  provider: { type: String, required: true },
  paymentMethod: {
    type: String,
    enum: ["electronic", "check"],
    required: true,
  },
  isEbillEnrolled: { type: Boolean, required: true },
  processingTime: { type: String, required: true },
  lastPaymentDate: { type: String },
  lastPaymentAmount: { type: Number },
  isRecurring: { type: Boolean, required: true },
  recurringDetails: { type: RecurringDetailsSchema },
});

const Bill = mongoose.model("Bill", BillSchema);

module.exports = Bill;
