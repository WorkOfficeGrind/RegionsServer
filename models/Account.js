const mongoose = require("mongoose");
const { logger } = require("../config/logger");

const AccountSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["checking", "savings", "investment", "credit", "loan"],
      // required: [true, "Account type is required"],
      default: "checking",
    },
    status: {
      type: String,
      enum: ["active", "inactive", "suspended", "closed", "pending"],
      default: "pending",
    },
    name: {
      type: String,
      required: [true, "Account name is required"],
      trim: true,
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
    bank: {
      type: String,
      required: [true, "Bank name is required"],
      trim: true,
    },
    accountNumber: {
      type: String,
      required: [true, "Account number is required"],
      trim: true,
      unique: true,
    },
    routingNumber: {
      type: String,
      required: [true, "Routing number is required"],
      trim: true,
      // unique: true
    },
    availableBalance: {
      type: Number,
      default: 0,
    },
    ledgerBalance: {
      type: Number,
      default: 0,
    },
    reach: {
      type: Number,
      default: 0,
    },
    transactions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Transaction",
      },
    ],
    zelle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Zelle",
    },
    cashapp: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Cashapp",
    },
    venmo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Venmo",
    },
    paypal: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Paypal",
    },
    applepay: {
      enabled: {
        type: Boolean,
        default: false,
      },
      deviceId: String,
    },
    googlepay: {
      enabled: {
        type: Boolean,
        default: false,
      },
      deviceId: String,
    },
    limits: {
      dailyWithdrawal: {
        type: Number,
        default: 2000,
      },
      dailyTransfer: {
        type: Number,
        default: 5000,
      },
      monthlyTransfer: {
        type: Number,
        default: 20000,
      },
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    createdIp: String,
    lastAccessedIp: String,
    lastAccessedAt: Date,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual property for masked account number
AccountSchema.virtual("maskedAccountNumber").get(function () {
  const acc = this.accountNumber || "";
  if (acc.length <= 4) return acc;
  return "xxxx" + acc.slice(-4);
});

// Pre-save middleware
AccountSchema.pre("save", function (next) {
  // Perform any validation or data transformation here
  next();
});

// Post-save middleware
AccountSchema.post("save", function (doc) {
  logger.info("Account saved", {
    accountId: doc._id,
    userId: doc.user,
    accountType: doc.type,
    action: this.isNew ? "created" : "updated",
  });
});

// Method to update balance
AccountSchema.methods.updateBalance = async function (amount, isCredit = true) {
  try {
    if (isCredit) {
      this.availableBalance += amount;
      this.ledgerBalance += amount;
    } else {
      if (this.availableBalance < amount) {
        throw new Error("Insufficient funds");
      }
      this.availableBalance -= amount;
      this.ledgerBalance -= amount;
    }

    await this.save();

    logger.info("Account balance updated", {
      accountId: this._id,
      userId: this.user,
      amount: amount,
      transactionType: isCredit ? "credit" : "debit",
      newBalance: this.availableBalance,
    });

    return this;
  } catch (error) {
    logger.error("Error updating account balance", {
      accountId: this._id,
      userId: this.user,
      amount: amount,
      transactionType: isCredit ? "credit" : "debit",
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

// Create indexes
AccountSchema.index({ user: 1 });
// AccountSchema.index({ accountNumber: 1 });
AccountSchema.index({ status: 1 });

const Account = mongoose.model("Account", AccountSchema);

module.exports = Account;
