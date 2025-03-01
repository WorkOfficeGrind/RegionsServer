// const mongoose = require("mongoose");
// const crypto = require("crypto");

// const UserSchema = new mongoose.Schema(
//   {
//     kycStatus: {
//       type: String,
//       enum: ["Pending", "Verified", "Rejected"],
//       default: "Pending",
//     },
//     firstName: {
//       type: String,
//       required: true,
//     },
//     lastName: {
//       type: String,
//       required: true,
//     },
//     fullName: {
//       type: String,
//     },
//     username: {
//       type: String,
//       unique: true,
//       required: true,
//     },
//     email: {
//       type: String,
//       unique: true,
//     },
//     phone: {
//       type: String,
//       unique: true,
//     },
//     dateOfBirth: {
//       type: Date,
//     },
//     ssn: {
//       type: String,
//     },
//     address: {
//       type: String,
//     },
//     pin: {
//       type: String,
//       required: true,
//     },
//     password: {
//       type: String,
//       required: true,
//     },
//     picture: {
//       type: String,
//     },
//     role: {
//       type: String,
//       enum: ["user", "admin"],
//       default: "user",
//     },
//     pendingUpdates: {
//       token: String,
//       expiry: Date,
//       fields: [
//         {
//           field: String,
//           value: String,
//         },
//       ],
//     },
//     accounts: [
//       {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: "Account",
//       },
//     ],
//     cards: [
//       {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: "Card",
//       },
//     ],
//     bills: [
//       {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: "Bill",
//       },
//     ],
//     wallets: [
//       {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: "Wallet",
//       },
//     ],
//     beneficiaries: [
//       {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: "Beneficiary",
//       },
//     ],
//     mfaEnabled: {
//       type: Boolean,
//       default: false,
//     },
//   },
//   { versionKey: false, timestamps: true }
// );

// // Generate full name before saving
// UserSchema.pre("save", function (next) {
//   if (this.firstName && this.lastName) {
//     this.fullName = `${this.firstName} ${this.lastName}`;
//   }
//   next();
// });

// // Method to generate a 10-digit account number
// UserSchema.methods.generateAccountNumber = function () {
//   return Math.floor(1000000000 + Math.random() * 9000000000).toString();
// };

// // Method to generate a unique 8-character username
// UserSchema.statics.generateUsername = async function () {
//   const generateRandomString = () => {
//     return crypto.randomBytes(4).toString("hex");
//   };

//   let username;
//   let isUnique = false;

//   while (!isUnique) {
//     username = generateRandomString();
//     // Check if username exists
//     const existingUser = await this.findOne({ username });
//     if (!existingUser) {
//       isUnique = true;
//     }
//   }

//   return username;
// };

// UserSchema.methods.createDefaultProduct = async function (
//   productType,
//   session
// ) {
//   const Account = require("./account");

//   try {
//     let defaultProduct;

//     switch (productType.toLowerCase()) {
//       case "account": {
//         defaultProduct = await Account.createDefaultAccount(this, session);
//         break;
//       }
//       default:
//         throw new Error(`Invalid product type: ${productType}`);
//     }

//     return defaultProduct;
//   } catch (error) {
//     throw new Error(`Error creating default product: ${error.message}`);
//   }
// };

// const User = mongoose.model("User", UserSchema);

// module.exports = User;


const mongoose = require("mongoose");
const crypto = require("crypto");

const UserSchema = new mongoose.Schema(
  {
    kycStatus: {
      type: String,
      enum: ["Pending", "Verified", "Rejected"],
      default: "Pending",
    },
    firstName: {
      type: String,
      required: true,
    },
    lastName: {
      type: String,
      required: true,
    },
    fullName: {
      type: String,
    },
    username: {
      type: String,
      unique: true,
      required: true,
    },
    email: {
      type: String,
      unique: true,
    },
    phone: {
      type: String,
      unique: true,
    },
    dateOfBirth: {
      type: Date,
    },
    ssn: {
      type: String,
    },
    address: {
      type: String,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    // Added passcodeHash for critical transaction validation
    passcodeHash: {
      type: String,
      select: false,
    },
    picture: {
      type: String,
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    pendingUpdates: {
      token: String,
      expiry: Date,
      fields: [
        {
          field: String,
          value: String,
        },
      ],
    },
    accounts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Account",
      },
    ],
    cards: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Card",
      },
    ],
    bills: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Bill",
      },
    ],
    wallets: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Wallet",
      },
    ],
    beneficiaries: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Beneficiary",
      },
    ],
    mfaEnabled: {
      type: Boolean,
      default: false,
    },
  },
  { versionKey: false, timestamps: true }
);

// Generate full name before saving
UserSchema.pre("save", function (next) {
  if (this.firstName && this.lastName) {
    this.fullName = `${this.firstName} ${this.lastName}`;
  }
  next();
});

// Method to generate a 10-digit account number
UserSchema.methods.generateAccountNumber = function () {
  return Math.floor(1000000000 + Math.random() * 9000000000).toString();
};

// Method to generate a unique 8-character username
UserSchema.statics.generateUsername = async function () {
  const generateRandomString = () => {
    return crypto.randomBytes(4).toString("hex");
  };

  let username;
  let isUnique = false;

  while (!isUnique) {
    username = generateRandomString();
    // Check if username exists
    const existingUser = await this.findOne({ username });
    if (!existingUser) {
      isUnique = true;
    }
  }

  return username;
};

// Validate passcode for critical operations
UserSchema.methods.validatePasscode = function (passcode) {
  if (!this.passcodeHash) {
    return false;
  }

  const passcodeHash = crypto
    .createHash("sha256")
    .update(passcode)
    .digest("hex");

  return this.passcodeHash === passcodeHash;
};

// Create default products for a user
UserSchema.methods.createDefaultProduct = async function (
  productType,
  session
) {
  const Account = require("./account");

  try {
    let defaultProduct;

    switch (productType.toLowerCase()) {
      case "account": {
        defaultProduct = await Account.createDefaultAccount(this, session);
        break;
      }
      default:
        throw new Error(`Invalid product type: ${productType}`);
    }

    return defaultProduct;
  } catch (error) {
    throw new Error(`Error creating default product: ${error.message}`);
  }
};

const User = mongoose.model("User", UserSchema);

module.exports = User;