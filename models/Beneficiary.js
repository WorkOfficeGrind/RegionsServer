// const mongoose = require("mongoose");
// const { logger } = require("../config/logger");

// const BeneficiarySchema = new mongoose.Schema(
//   {
//     user: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "User",
//       required: true,
//     },
//     name: {
//       type: String,
//       required: [true, "Beneficiary name is required"],
//       trim: true,
//     },
//     image: {
//       type: String,
//     },
//     accountNumber: {
//       type: String,
//       required: [true, "Account number is required"],
//       trim: true,
//     },
//     routingNumber: {
//       type: String,
//       required: [true, "Routing number is required"],
//       trim: true,
//     },
//     bank: {
//       type: String,
//       required: [true, "Bank name is required"],
//       trim: true,
//     },
//     rank: {
//       type: Number,
//       default: 0,
//     },
//     email: {
//       type: String,
//       trim: true,
//       lowercase: true,
//     },
//     phone: {
//       type: String,
//       trim: true,
//     },
//     nickname: {
//       type: String,
//       trim: true,
//     },
//     relationship: {
//       type: String,
//       enum: ["family", "friend", "business", "other"],
//       default: "other",
//     },
//     address: {
//       street: String,
//       city: String,
//       state: String,
//       zipCode: String,
//       country: String,
//     },
//     status: {
//       type: String,
//       enum: ["active", "inactive", "pending", "rejected"],
//       default: "active",
//     },
//     accountType: {
//       type: String,
//       enum: ["checking", "savings", "investment", "other"],
//       default: "checking",
//     },
//     transferLimit: {
//       daily: {
//         type: Number,
//         default: 1000,
//       },
//       transaction: {
//         type: Number,
//         default: 500,
//       },
//     },
//     isFavorite: {
//       type: Boolean,
//       default: false,
//     },
//     notes: {
//       type: String,
//       trim: true,
//     },
//     recentTransactions: [
//       {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: "Transaction",
//       },
//     ],
//     verification: {
//       isVerified: {
//         type: Boolean,
//         default: false,
//       },
//       method: {
//         type: String,
//         enum: ["microdeposit", "instant", "manual", "none"],
//         default: "none",
//       },
//       verifiedAt: Date,
//       verifiedBy: String,
//     },
//   },
//   {
//     timestamps: true,
//     toJSON: { virtuals: true },
//     toObject: { virtuals: true },
//   }
// );

// // Virtual for masked account number
// BeneficiarySchema.virtual("maskedAccountNumber").get(function () {
//   const acc = this.accountNumber || "";
//   if (acc.length <= 4) return acc;
//   return "xxxx" + acc.slice(-4);
// });

// // Virtual for display name (nickname or name)
// BeneficiarySchema.virtual("displayName").get(function () {
//   return this.nickname || this.name;
// });

// // Pre-save hook
// BeneficiarySchema.pre("save", function (next) {
//   // Set display rank for favorites
//   if (this.isModified("isFavorite") && this.isFavorite) {
//     this.rank = 1;
//   }

//   next();
// });

// // Post-save hook
// BeneficiarySchema.post("save", function (doc) {
//   logger.info("Beneficiary saved", {
//     beneficiaryId: doc._id,
//     userId: doc.user,
//     name: doc.name,
//     bank: doc.bank,
//     status: doc.status,
//     action: this.isNew ? "created" : "updated",
//   });
// });

// // Method to verify beneficiary
// BeneficiarySchema.methods.verify = async function (
//   method = "manual",
//   verifiedBy = "system"
// ) {
//   try {
//     this.verification.isVerified = true;
//     this.verification.method = method;
//     this.verification.verifiedAt = new Date();
//     this.verification.verifiedBy = verifiedBy;
//     this.status = "active";

//     await this.save();

//     logger.info("Beneficiary verified", {
//       beneficiaryId: this._id,
//       userId: this.user,
//       method: method,
//       verifiedBy: verifiedBy,
//     });

//     return {
//       success: true,
//       message: "Beneficiary verified successfully",
//     };
//   } catch (error) {
//     logger.error("Error verifying beneficiary", {
//       beneficiaryId: this._id,
//       userId: this.user,
//       error: error.message,
//       stack: error.stack,
//     });

//     throw error;
//   }
// };

// // Method to make favorite
// BeneficiarySchema.methods.toggleFavorite = async function () {
//   try {
//     this.isFavorite = !this.isFavorite;
//     this.rank = this.isFavorite ? 1 : 0;

//     await this.save();

//     logger.info("Beneficiary favorite status toggled", {
//       beneficiaryId: this._id,
//       userId: this.user,
//       isFavorite: this.isFavorite,
//     });

//     return {
//       success: true,
//       isFavorite: this.isFavorite,
//     };
//   } catch (error) {
//     logger.error("Error toggling beneficiary favorite status", {
//       beneficiaryId: this._id,
//       userId: this.user,
//       error: error.message,
//       stack: error.stack,
//     });

//     throw error;
//   }
// };

// // Method to check transfer limit
// BeneficiarySchema.methods.checkTransferLimit = function (amount) {
//   if (amount > this.transferLimit.transaction) {
//     return {
//       allowed: false,
//       reason: `Amount exceeds per-transaction limit of ${this.transferLimit.transaction}`,
//     };
//   }

//   // Additional checks could be implemented here

//   return { allowed: true };
// };

// // Create indexes
// BeneficiarySchema.index({ user: 1 });
// BeneficiarySchema.index({ user: 1, name: 1 });
// BeneficiarySchema.index({ isFavorite: 1 });
// BeneficiarySchema.index({ status: 1 });

// const Beneficiary = mongoose.model("Beneficiary", BeneficiarySchema);

// module.exports = Beneficiary;


const mongoose = require("mongoose");
const { logger } = require("../config/logger");

const BeneficiarySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Basic info that all beneficiary types would have
    name: {
      type: String,
      required: [true, "Beneficiary name is required"],
      trim: true,
    },
    image: {
      type: String,
    },

    // Entity type identification
    entityType: {
      type: String,
      enum: ["account", "card", "wallet", "external"],
      required: [true, "Entity type is required"],
    },

    // Direct reference to the entity (if internal)
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "entityModel",
    },

    // The model name this entity refers to
    entityModel: {
      type: String,
      enum: ["Account", "Card", "Wallet"],
      required: function () {
        return this.entityType !== "external";
      },
    },

    // For external bank accounts
    accountDetails: {
      accountNumber: {
        type: String,
        required: function () {
          return (
            this.entityType === "account" || this.entityType === "external"
          );
        },
        trim: true,
      },
      routingNumber: {
        type: String,
        required: function () {
          return (
            this.entityType === "account" || this.entityType === "external"
          );
        },
        trim: true,
      },
      bank: {
        type: String,
        required: function () {
          return (
            this.entityType === "account" || this.entityType === "external"
          );
        },
        trim: true,
      },
      accountType: {
        type: String,
        enum: ["checking", "savings", "investment", "other"],
        default: "checking",
      },
    },

    // For card beneficiaries
    cardDetails: {
      last4: {
        type: String,
        required: function () {
          return this.entityType === "card";
        },
      },
      brand: {
        type: String,
        enum: ["visa", "mastercard", "amex", "discover", "other"],
        required: function () {
          return this.entityType === "card";
        },
      },
      expiryMonth: String,
      expiryYear: String,
    },

    // For wallet beneficiaries
    walletDetails: {
      address: {
        type: String,
        required: function () {
          return this.entityType === "wallet";
        },
      },
      currency: {
        type: String,
        required: function () {
          return this.entityType === "wallet";
        },
        uppercase: true,
      },
      walletType: {
        type: String,
        enum: ["fiat", "crypto", "investment"],
        default: "fiat",
      },
    },

    // Common fields across different beneficiary types
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    nickname: {
      type: String,
      trim: true,
    },
    relationship: {
      type: String,
      enum: ["family", "friend", "business", "self", "other"],
      default: "other",
    },
    address: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: String,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "pending", "rejected"],
      default: "active",
    },
    transferLimit: {
      daily: {
        type: Number,
        default: 1000,
      },
      transaction: {
        type: Number,
        default: 500,
      },
    },
    rank: {
      type: Number,
      default: 0,
    },
    isFavorite: {
      type: Boolean,
      default: false,
    },
    notes: {
      type: String,
      trim: true,
    },
    recentTransactions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Transaction",
      },
    ],
    verification: {
      isVerified: {
        type: Boolean,
        default: false,
      },
      method: {
        type: String,
        enum: ["microdeposit", "instant", "manual", "none"],
        default: "none",
      },
      verifiedAt: Date,
      verifiedBy: String,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for display identifier based on entity type
BeneficiarySchema.virtual("identifier").get(function () {
  switch (this.entityType) {
    case "account":
    case "external":
      const acc = this.accountDetails?.accountNumber || "";
      return acc.length <= 4 ? acc : "xxxx" + acc.slice(-4);
    case "card":
      return `**** **** **** ${this.cardDetails.last4}`;
    case "wallet":
      const addr = this.walletDetails?.address || "";
      return addr.length <= 8
        ? addr
        : addr.substring(0, 4) + "..." + addr.slice(-4);
    default:
      return "";
  }
});

// Virtual for display name (nickname or name)
BeneficiarySchema.virtual("displayName").get(function () {
  return this.nickname || this.name;
});

// Pre-save hook
BeneficiarySchema.pre("save", function (next) {
  // Set display rank for favorites
  if (this.isModified("isFavorite") && this.isFavorite) {
    this.rank = 1;
  }

  next();
});

// Post-save hook
BeneficiarySchema.post("save", function (doc) {
  logger.info("Beneficiary saved", {
    beneficiaryId: doc._id,
    userId: doc.user,
    name: doc.name,
    entityType: doc.entityType,
    status: doc.status,
    action: this.isNew ? "created" : "updated",
  });
});

// Method to verify beneficiary
BeneficiarySchema.methods.verify = async function (
  method = "manual",
  verifiedBy = "system"
) {
  try {
    this.verification.isVerified = true;
    this.verification.method = method;
    this.verification.verifiedAt = new Date();
    this.verification.verifiedBy = verifiedBy;
    this.status = "active";

    await this.save();

    logger.info("Beneficiary verified", {
      beneficiaryId: this._id,
      userId: this.user,
      method: method,
      verifiedBy: verifiedBy,
    });

    return {
      success: true,
      message: "Beneficiary verified successfully",
    };
  } catch (error) {
    logger.error("Error verifying beneficiary", {
      beneficiaryId: this._id,
      userId: this.user,
      error: error.message,
      stack: error.stack,
    });

    throw error;
  }
};

// Method to make favorite
BeneficiarySchema.methods.toggleFavorite = async function () {
  try {
    this.isFavorite = !this.isFavorite;
    this.rank = this.isFavorite ? 1 : 0;

    await this.save();

    logger.info("Beneficiary favorite status toggled", {
      beneficiaryId: this._id,
      userId: this.user,
      isFavorite: this.isFavorite,
    });

    return {
      success: true,
      isFavorite: this.isFavorite,
    };
  } catch (error) {
    logger.error("Error toggling beneficiary favorite status", {
      beneficiaryId: this._id,
      userId: this.user,
      error: error.message,
      stack: error.stack,
    });

    throw error;
  }
};

// Method to check transfer limit
BeneficiarySchema.methods.checkTransferLimit = function (amount) {
  if (amount > this.transferLimit.transaction) {
    return {
      allowed: false,
      reason: `Amount exceeds per-transaction limit of ${this.transferLimit.transaction}`,
    };
  }

  return { allowed: true };
};

// Static method to create beneficiary from entity
BeneficiarySchema.statics.createFromEntity = async function (
  user,
  entity,
  entityType
) {
  try {
    const beneficiaryData = {
      user: user._id || user,
      name: entity.name,
      entityType: entityType,
      entityId: entity._id,
      entityModel:
        entityType === "account"
          ? "Account"
          : entityType === "card"
          ? "Card"
          : "Wallet",
    };

    // Add entity-specific details
    switch (entityType) {
      case "account":
        beneficiaryData.accountDetails = {
          accountNumber: entity.accountNumber,
          routingNumber: entity.routingNumber,
          bank: entity.bank,
          accountType: entity.type || "checking",
        };
        break;
      case "card":
        beneficiaryData.cardDetails = {
          last4: entity.last4,
          brand: entity.brand,
          expiryMonth: entity.month,
          expiryYear: entity.year,
        };
        break;
      case "wallet":
        beneficiaryData.walletDetails = {
          address: entity.address,
          currency: entity.currency,
          walletType: entity.type || "fiat",
        };
        break;
    }

    // Add common fields if they exist on the entity
    if (entity.email) beneficiaryData.email = entity.email;
    if (entity.phone) beneficiaryData.phone = entity.phone;

    const beneficiary = await this.create(beneficiaryData);

    logger.info("Beneficiary created from entity", {
      beneficiaryId: beneficiary._id,
      userId: user._id || user,
      entityType: entityType,
      entityId: entity._id,
    });

    return beneficiary;
  } catch (error) {
    logger.error("Error creating beneficiary from entity", {
      userId: user._id || user,
      entityType: entityType,
      entityId: entity?._id,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

// Create indexes
BeneficiarySchema.index({ user: 1 });
BeneficiarySchema.index({ user: 1, name: 1 });
BeneficiarySchema.index({ user: 1, entityType: 1 });
BeneficiarySchema.index({ user: 1, entityId: 1 });
BeneficiarySchema.index({ isFavorite: 1 });
BeneficiarySchema.index({ status: 1 });
BeneficiarySchema.index({ rank: 1 });

const Beneficiary = mongoose.model("Beneficiary", BeneficiarySchema);

module.exports = Beneficiary;