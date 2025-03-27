const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { logger } = require("../config/logger");

const UserSchema = new mongoose.Schema(
  {
    kycStatus: {
      type: String,
      enum: ["pending", "verified", "rejected", "notStarted"],
      default: "notStarted",
    },
    firstName: {
      type: String,
      required: [true, "First name is required"],
      trim: true,
    },
    lastName: {
      type: String,
      required: [true, "Last name is required"],
      trim: true,
    },
    fullName: {
      type: String,
      trim: true,
    },
    username: {
      type: String,
      required: [true, "Username is required"],
      unique: true,
      trim: true,
      lowercase: true,
    },
    email: {
      type: String,
      required: [true, "Email address is required"],
      unique: true,
      trim: true,
      lowercase: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        "Please enter a valid email address",
      ],
    },
    phone: {
      type: String,
      trim: true,
    },
    dateOfBirth: {
      type: Date,
    },
    ssn: {
      type: String,
      trim: true,
      select: false, // This field will not be included in query results by default
    },
    address: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: {
        type: String,
        default: "US",
      },
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 8,
      select: false,
    },
    passcodeHash: {
      type: String,
      select: false,
    },
    picture: {
      type: String,
      default: "default.jpg",
    },
    role: {
      type: String,
      enum: ["user", "admin", "support"],
      default: "user",
    },
    pendingUpdates: {
      type: mongoose.Schema.Types.Mixed,
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
    investments: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "UserInvestment",
      },
    ],
    beneficiaries: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Beneficiary",
      },
    ],
    walletBeneficiaries: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "WalletBeneficiary",
      },
    ],
    pendingWallets: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Waitlist",
      },
    ],
    mfaEnabled: {
      type: Boolean,
      default: false,
    },
    passcodeAttemptLeft: {
      type: Number,
      default: 5,
    },
    status: {
      type: String,
      enum: [
        "active",
        "inactive",
        "suspended",
        "locked",
        "passcode_locked",
        "pendingVerification",
      ],
      default: "pendingVerification",
    },
    lastLogin: {
      type: Date,
    },
    devices: [
      {
        deviceId: String,
        deviceName: String,
        lastUsed: Date,
      },
    ],
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for user's full name
UserSchema.virtual("name").get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Virtual for user's investments
// UserSchema.virtual("investments", {
//   ref: "UserInvestment",
//   localField: "_id",
//   foreignField: "user",
// });

// Middleware: pre-save hooks
UserSchema.pre("save", async function (next) {
  // Set fullName from firstName and lastName
  if (this.isModified("firstName") || this.isModified("lastName")) {
    this.fullName = `${this.firstName} ${this.lastName}`;
  }

  // Only hash password if it has been modified or is new
  if (!this.isModified("password")) return next();

  try {
    // Generate salt and hash password
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    logger.error("Error hashing password", {
      userId: this._id,
      error: error.message,
      stack: error.stack,
    });
    next(error);
  }
});

// Method to check if password matches
UserSchema.methods.matchPassword = async function (enteredPassword) {
  try {
    return await bcrypt.compare(enteredPassword, this.password);
  } catch (error) {
    logger.error("Error comparing passwords", {
      userId: this._id,
      error: error.message,
    });
    throw new Error("Password verification failed");
  }
};

// Method to check if passcode matches
UserSchema.methods.matchPasscode = async function (enteredPasscode) {
  try {
    return await bcrypt.compare(enteredPasscode, this.passcodeHash);
  } catch (error) {
    logger.error("Error comparing passcodes", {
      userId: this._id,
      error: error.message,
    });
    throw new Error("Passcode verification failed");
  }
};

// Log user creation and updates
UserSchema.post("save", function (doc) {
  logger.info("User saved", {
    userId: doc._id,
    username: doc.username,
    action: this.isNew ? "created" : "updated",
  });
});

// Create indexes
// UserSchema.index({ email: 1 });
// UserSchema.index({ username: 1 });
UserSchema.index({ status: 1 });

const User = mongoose.model("User", UserSchema);

module.exports = User;
