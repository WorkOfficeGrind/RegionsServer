// const mongoose = require("mongoose");

// const AccountSchema = new mongoose.Schema(
//   {
//     type: {
//       type: String,
//       enum: ["Savings", "Checking", "Business", "Prime"],
//     },
//     name: {
//       type: String,
//       required: true,
//     },
//     email: {
//       type: String,
//       required: true,
//       unique: true,
//     },
//     phone: {
//       type: String,
//       required: true,
//       unique: true,
//     },
//     bank: {
//       type: String,
//       required: true,
//     },
//     accountNumber: {
//       type: String,
//       required: true,
//       unique: true,
//     },
//     routingNumber: {
//       type: String,
//       required: true,
//       unique: true,
//     },
//     availableBalance: {
//       type: Number,
//       required: true,
//     },
//     ledgerBalance: {
//       type: Number,
//       required: true,
//     },
//     reach: {
//       type: String,
//       required: true,
//     },
//     transactions: [
//       {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: "Transaction",
//       },
//     ],
//     zelle: [
//       {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: "Zelle",
//       },
//     ],
//     cashApp: [
//       {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: "Cashapp",
//       },
//     ],
//     venmo: [
//       {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: "Venmo",
//       },
//     ],
//     paypal: [
//       {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: "Paypal",
//       },
//     ],
//     applePay: {
//       type: Boolean,
//     },
//     googlePay: {
//       type: Boolean,
//     },
//   },
//   { versionKey: false, timestamps: true }
// );

// const Account = mongoose.model("Account", AccountSchema);

// module.exports = Account;

const mongoose = require("mongoose");

const AccountSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["Savings", "Checking", "Business", "Prime"],
      default: "Checking",
    },
    status: {
      type: String,
      enum: ["active", "inactive", "suspended", "closed"],
      default: "active",
    },
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
    },
    phone: {
      type: String,
      required: true,
    },
    bank: {
      type: String,
      required: true,
      default: "Regions Bank",
    },
    accountNumber: {
      type: String,
      required: true,
      unique: true,
    },
    routingNumber: {
      type: String,
      required: true,
      default: "062000019", // Default Regions Bank routing number
    },
    availableBalance: {
      type: Number,
      required: true,
      default: 0,
    },
    ledgerBalance: {
      type: Number,
      required: true,
      default: 0,
    },
    reach: {
      type: String,
      required: true,
      default: "Domestic",
    },
    transactions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Transaction",
      },
    ],
    zelle: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Zelle",
      },
    ],
    cashApp: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Cashapp",
      },
    ],
    venmo: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Venmo",
      },
    ],
    paypal: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Paypal",
      },
    ],
    applePay: {
      type: Boolean,
      default: false,
    },
    googlePay: {
      type: Boolean,
      default: false,
    },
  },
  {
    versionKey: false,
    timestamps: true,
  }
);

// Generate unique account number
AccountSchema.statics.generateAccountNumber = async function () {
  const prefix = "900"; // Regions Bank prefix
  const randomNum = Math.floor(10000000 + Math.random() * 90000000);
  const accountNumber = `${prefix}${randomNum}`;

  const existingAccount = await this.findOne({ accountNumber });
  if (existingAccount) {
    return this.generateAccountNumber();
  }

  return accountNumber;
};

// Create default account for a user
AccountSchema.statics.createDefaultAccount = async function (
  userData,
  session
) {
  if (!session) {
    throw new Error("Session is required for createDefaultAccount");
  }

  const accountNumber = await this.generateAccountNumber();

  const defaultAccount = new this({
    user: userData._id,
    type: "Checking",
    name: `${userData.firstName} ${userData.lastName}`,
    email: userData.email,
    phone: userData.phone,
    bank: "Regions Bank",
    accountNumber,
    routingNumber: "062000019",
    availableBalance: 0,
    ledgerBalance: 0,
    reach: "Domestic",
    status: "active",
  });

  await defaultAccount.save({ session });
  return defaultAccount;
};

// Middleware to prevent duplicate email/phone if they belong to the same user
AccountSchema.pre("save", async function (next) {
  if (this.isNew) {
    const existingAccount = await this.constructor.findOne({
      user: this.user,
      $or: [{ email: this.email }, { phone: this.phone }],
    });

    if (existingAccount) {
      // Allow if it's the same user
      next();
    }
  }
  next();
});



const Account = mongoose.model("Account", AccountSchema);

module.exports = Account;