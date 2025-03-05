const Joi = require("joi");
const { logger } = require("../config/logger");

/**
 * Middleware for validating request data with Joi schemas
 * @param {Object} schema - Joi schema to validate against
 * @param {string} property - Request property to validate ('body', 'query', 'params')
 */
// const validate = (schema, property = "body") => {
//   return (req, res, next) => {
    
//     const dataToValidate = req[property];
//     const { error, value } = schema.validate(dataToValidate, {
//       abortEarly: false, // Return all errors, not just the first one
//       stripUnknown: true, // Remove unknown properties
//     });

//     if (error) {
//       const validationErrors = {};

//       // Format validation errors
//       error.details.forEach((detail) => {
//         const path = detail.path.join(".");
//         validationErrors[path] = detail.message;
//       });

//       logger.warn("Validation error", {
//         errors: validationErrors,
//         property,
//         data: dataToValidate,
//         requestId: req.id,
//         userId: req.user ? req.user._id : "unauthenticated",
//       });

//       return res.status(400).json({
//         status: "error",
//         message: "Validation failed",
//         errors: validationErrors,
//       });
//     }

//     // Replace validated values
//     req[property] = value;
//     next();
//   };
// };

// Common validations


// In your validator.js file, modify the validate function
const validate = (schema, property = "body") => {
  return (req, res, next) => {
    
    const dataToValidate = req[property];
    const { error, value } = schema.validate(dataToValidate, {
      abortEarly: false, // Return all errors, not just the first one
      stripUnknown: true, // Remove unknown properties
    });

    if (error) {
      const validationErrors = {};

      // Format validation errors
      error.details.forEach((detail) => {
        const path = detail.path.join(".");
        validationErrors[path] = detail.message;
      });

      // Enhanced logging for validation errors
      logger.warn("Validation error", {
        endpoint: req.originalUrl,
        method: req.method,
        errors: validationErrors,
        property,
        // Safely log received data without sensitive fields
        receivedFields: Object.keys(dataToValidate || {}),
        expectedFields: Object.keys(schema.describe().keys),
        requestId: req.id,
        userId: req.user ? req.user._id : "unauthenticated",
      });

      return res.status(400).json({
        status: "error",
        message: "Validation failed",
        errors: validationErrors,
      });
    }

    // Replace validated values
    req[property] = value;
    next();
  };
};

const commonValidations = {
  objectId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/),
  accountId: Joi.string().pattern(/^[0-9]{10}$/),

  email: Joi.string().email(),
  password: Joi.string()
    .min(8)
    .pattern(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/
    ),
  phone: Joi.string().pattern(/^\+?[1-9]\d{9,14}$/),
  username: Joi.string().alphanum().min(3).max(30),
  date: Joi.date(),
  boolean: Joi.boolean(),
  number: Joi.number(),
  currency: Joi.string().pattern(/^[A-Z]{3}$/),
  positiveNumber: Joi.number().positive(),
  nonNegativeNumber: Joi.number().min(0),
  string: Joi.string().trim(),
  arrayOfStrings: Joi.array().items(Joi.string()),
  arrayOfObjectIds: Joi.array().items(
    Joi.string().pattern(/^[0-9a-fA-F]{24}$/)
  ),
  pagination: {
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sort: Joi.string(),
  },
};




// Schemas for different validation scenarios
const schemas = {
  // Auth schemas
  auth: {
    register: Joi.object({
      firstName: Joi.string().trim().required(),
      lastName: Joi.string().trim().required(),
      username: commonValidations.username.required(),
      email: commonValidations.email.required(),
      password: commonValidations.password.required(),
      passwordConfirm: Joi.ref("password"),
      phone: commonValidations.phone,
    }),

    login: Joi.object({
      identifier: Joi.string().required(),
      password: Joi.string().required(),
    }),

    refreshToken: Joi.object({
      refreshToken: Joi.string().required(),
    }),

    setPasscode: Joi.object({
      passcode: Joi.string()
        .pattern(/^\d{4}$/)
        .required(),
      passcodeConfirm: Joi.ref("passcode"),
    }),

    forgotPassword: Joi.object({
      email: commonValidations.email.required(),
    }),

    resetPassword: Joi.object({
      token: Joi.string().required(),
      password: commonValidations.password.required(),
      passwordConfirm: Joi.ref("password"),
    }),
  },

  // User schemas
  user: {
    update: Joi.object({
      firstName: Joi.string().trim(),
      lastName: Joi.string().trim(),
      phone: commonValidations.phone,
      address: Joi.object({
        street: Joi.string().trim(),
        city: Joi.string().trim(),
        state: Joi.string().trim(),
        zipCode: Joi.string().trim(),
        country: Joi.string().trim(),
      }),
      picture: Joi.string().trim(),
    }),

    updatePassword: Joi.object({
      currentPassword: Joi.string().required(),
      newPassword: commonValidations.password.required(),
      newPasswordConfirm: Joi.ref("newPassword"),
    }),
  },

  // Account schemas
  account: {
    create: Joi.object({
      type: Joi.string()
        .valid("checking", "savings", "investment", "credit", "loan")
        .required(),
      name: Joi.string().trim().required(),
      email: commonValidations.email,
      phone: commonValidations.phone,
      bank: Joi.string().trim().required(),
      accountNumber: Joi.string().trim().required(),
      routingNumber: Joi.string().trim().required(),
    }),

    update: Joi.object({
      name: Joi.string().trim(),
      email: commonValidations.email,
      phone: commonValidations.phone,
      status: Joi.string().valid(
        "active",
        "inactive",
        "suspended",
        "closed",
        "pending"
      ),
    }),

    query: Joi.object({
      type: Joi.string().valid(
        "checking",
        "savings",
        "investment",
        "credit",
        "loan"
      ),
      status: Joi.string().valid(
        "active",
        "inactive",
        "suspended",
        "closed",
        "pending"
      ),
      ...commonValidations.pagination,
    }),
  },

  // Transaction schemas
  transaction: {
    create: Joi.object({
      type: Joi.string()
        .valid(
          "deposit",
          "withdrawal",
          "transfer",
          "payment",
          "refund",
          "exchange",
          "fee",
          "investment",
          "interest"
        )
        .required(),
      amount: commonValidations.positiveNumber.required(),
      sourceId: commonValidations.accountId.required(),
      sourceType: Joi.string()
        .valid("Account", "Card", "Wallet", "external")
        .required(),
      sourceCurrency: commonValidations.currency.required(),
      destinationId: commonValidations.accountId.required(),
      destinationType: Joi.string()
        .valid("Account", "Card", "Wallet", "external")
        .required(),
      destinationCurrency: commonValidations.currency.required(),
      description: Joi.string().trim(),
      metadata: Joi.object(),
      // narration: Joi.string(),
      newBeneficiary: Joi.object(),
    }),

    query: Joi.object({
      type: Joi.string().valid(
        "deposit",
        "withdrawal",
        "transfer",
        "payment",
        "refund",
        "exchange",
        "fee",
        "investment",
        "interest"
      ),
      status: Joi.string().valid(
        "pending",
        "completed",
        "failed",
        "cancelled",
        "refunded",
        "processing"
      ),
      minAmount: commonValidations.nonNegativeNumber,
      maxAmount: commonValidations.positiveNumber,
      startDate: commonValidations.date,
      endDate: commonValidations.date,
      sourceCurrency: commonValidations.currency,
      destinationCurrency: commonValidations.currency,
      sourceId: commonValidations.objectId,
      destinationId: commonValidations.objectId,
      ...commonValidations.pagination,
    }),
  },

  // Wallet schemas
  wallet: {
    create: Joi.object({
      currency: commonValidations.currency.required(),
      name: Joi.string().trim(),
    }),

    update: Joi.object({
      name: Joi.string().trim(),
      status: Joi.string().valid("active", "inactive", "frozen", "closed"),
    }),

    query: Joi.object({
      currency: commonValidations.currency,
      status: Joi.string().valid("active", "inactive", "frozen", "closed"),
      ...commonValidations.pagination,
    }),
  },

  // Investment schemas
  investment: {
    create: Joi.object({
      planId: commonValidations.objectId.required(),
      walletId: commonValidations.objectId.required(),
      amount: commonValidations.positiveNumber.required(),
      label: Joi.string().trim(),
    }),

    withdraw: Joi.object({
      amount: commonValidations.positiveNumber.required(),
    }),

    query: Joi.object({
      status: Joi.string().valid("active", "matured", "withdrawn", "cancelled"),
      planId: commonValidations.objectId,
      minAmount: commonValidations.nonNegativeNumber,
      maxAmount: commonValidations.positiveNumber,
      ...commonValidations.pagination,
    }),
  },

  // Bill schemas
  bill: {
    create: Joi.object({
      title: Joi.string().trim().required(),
      customName: Joi.string().trim(),
      amount: commonValidations.positiveNumber.required(),
      dueDate: commonValidations.date.required(),
      accountNumber: Joi.string().trim(),
      provider: Joi.string().trim().required(),
      paymentMethod: commonValidations.objectId,
      paymentMethodType: Joi.string().valid("Account", "Card", "Wallet"),
      isEbillEnrolled: commonValidations.boolean,
      isRecurring: commonValidations.boolean,
      recurringDetails: Joi.object({
        frequency: Joi.string()
          .valid(
            "weekly",
            "biweekly",
            "monthly",
            "quarterly",
            "semiannually",
            "annually"
          )
          .required(),
        dayOfMonth: Joi.number().integer().min(1).max(31),
        dayOfWeek: Joi.number().integer().min(0).max(6),
        endDate: commonValidations.date,
        autopay: commonValidations.boolean,
      }).when("isRecurring", { is: true, then: Joi.required() }),
      category: Joi.string().valid(
        "utility",
        "housing",
        "transportation",
        "insurance",
        "subscription",
        "loan",
        "credit_card",
        "other"
      ),
      notes: Joi.string().trim(),
    }),

    update: Joi.object({
      title: Joi.string().trim(),
      customName: Joi.string().trim(),
      amount: commonValidations.positiveNumber,
      dueDate: commonValidations.date,
      accountNumber: Joi.string().trim(),
      provider: Joi.string().trim(),
      paymentMethod: commonValidations.objectId,
      paymentMethodType: Joi.string().valid("Account", "Card", "Wallet"),
      isEbillEnrolled: commonValidations.boolean,
      isRecurring: commonValidations.boolean,
      status: Joi.string().valid(
        "pending",
        "paid",
        "overdue",
        "cancelled",
        "scheduled"
      ),
      notes: Joi.string().trim(),
    }),

    makePayment: Joi.object({
      amount: commonValidations.positiveNumber.required(),
      paymentMethod: commonValidations.objectId.required(),
      paymentMethodType: Joi.string()
        .valid("Account", "Card", "Wallet")
        .required(),
      notes: Joi.string().trim(),
    }),

    query: Joi.object({
      status: Joi.string().valid(
        "pending",
        "paid",
        "overdue",
        "cancelled",
        "scheduled"
      ),
      category: Joi.string().valid(
        "utility",
        "housing",
        "transportation",
        "insurance",
        "subscription",
        "loan",
        "credit_card",
        "other"
      ),
      provider: Joi.string().trim(),
      isRecurring: commonValidations.boolean,
      dueStartDate: commonValidations.date,
      dueEndDate: commonValidations.date,
      minAmount: commonValidations.nonNegativeNumber,
      maxAmount: commonValidations.positiveNumber,
      ...commonValidations.pagination,
    }),
  },

  // Card schemas
  card: {
    create: Joi.object({
      type: Joi.string()
        .valid("virtual", "physical", "debit", "credit", "prepaid")
        .required(),
      name: Joi.string().trim().required(),
      email: commonValidations.email,
      phone: commonValidations.phone,
      bank: Joi.string().trim().required(),
      number: Joi.string().trim().required(),
      month: Joi.string().trim().required(),
      year: Joi.string().trim().required(),
      cvv: Joi.string().trim().required(),
      address: Joi.string().trim(),
      city: Joi.string().trim(),
      state: Joi.string().trim(),
      zipCode: Joi.string().trim(),
    }),

    update: Joi.object({
      name: Joi.string().trim(),
      email: commonValidations.email,
      phone: commonValidations.phone,
      status: Joi.string().valid(
        "active",
        "inactive",
        "blocked",
        "expired",
        "pending"
      ),
    }),

    query: Joi.object({
      type: Joi.string().valid(
        "virtual",
        "physical",
        "debit",
        "credit",
        "prepaid"
      ),
      status: Joi.string().valid(
        "active",
        "inactive",
        "blocked",
        "expired",
        "pending"
      ),
      brand: Joi.string().valid(
        "visa",
        "mastercard",
        "amex",
        "discover",
        "other"
      ),
      ...commonValidations.pagination,
    }),
  },

  // Beneficiary schemas
  beneficiary: {
    create: Joi.object({
      name: Joi.string().trim().required(),
      accountNumber: Joi.string().trim().required(),
      routingNumber: Joi.string().trim().required(),
      bank: Joi.string().trim().required(),
      nickname: Joi.string().trim(),
      email: commonValidations.email,
      phone: commonValidations.phone,
      relationship: Joi.string().valid("family", "friend", "business", "other"),
    }),

    update: Joi.object({
      name: Joi.string().trim(),
      nickname: Joi.string().trim(),
      email: commonValidations.email,
      phone: commonValidations.phone,
      relationship: Joi.string().valid("family", "friend", "business", "other"),
      isFavorite: commonValidations.boolean,
      notes: Joi.string().trim(),
    }),

    query: Joi.object({
      bank: Joi.string().trim(),
      relationship: Joi.string().valid("family", "friend", "business", "other"),
      isFavorite: commonValidations.boolean,
      status: Joi.string().valid("active", "inactive", "pending", "rejected"),
      ...commonValidations.pagination,
    }),
  },

  // Payment service schemas
  paymentService: {
    createZelle: Joi.object({
      email: commonValidations.email,
      phone: commonValidations.phone,
    }).or("email", "phone"),

    createCashapp: Joi.object({
      email: commonValidations.email.required(),
      tag: Joi.string().trim().required(),
    }),

    createVenmo: Joi.object({
      email: commonValidations.email.required(),
      username: Joi.string().trim(),
    }),

    createPaypal: Joi.object({
      email: commonValidations.email.required(),
      accountType: Joi.string()
        .valid("personal", "business")
        .default("personal"),
      businessName: Joi.string().trim().when("accountType", {
        is: "business",
        then: Joi.required(),
      }),
    }),
  },

  // Waitlist schemas
  waitlist: {
    create: Joi.object({
      currency: commonValidations.currency.required(),
    }),

    approve: Joi.object({
      notes: Joi.string().trim(),
    }),

    fulfill: Joi.object({
      preloadedWalletId: commonValidations.objectId.required(),
      notes: Joi.string().trim(),
    }),

    query: Joi.object({
      currency: commonValidations.currency,
      status: Joi.string().valid(
        "pending",
        "approved",
        "rejected",
        "fulfilled"
      ),
      ...commonValidations.pagination,
    }),
  },

  // InvestmentPlan schemas
  investmentPlan: {
    create: Joi.object({
      name: Joi.string().trim().required(),
      symbol: Joi.string().trim().required(),
      roi: commonValidations.positiveNumber.required(),
      maturityPeriod: commonValidations.positiveNumber.required(),
      maturityUnit: Joi.string()
        .valid("days", "weeks", "months", "years")
        .default("days"),
      minInvestment: commonValidations.positiveNumber.required(),
      maxInvestment: commonValidations.positiveNumber,
      currency: commonValidations.currency.default("USD"),
      riskLevel: Joi.string()
        .valid("low", "medium", "high", "very_high")
        .required(),
      compoundFrequency: Joi.string()
        .valid("daily", "weekly", "monthly", "quarterly", "annually", "none")
        .default("monthly"),
      allowEarlyWithdrawal: commonValidations.boolean.default(false),
      earlyWithdrawalFee: commonValidations.nonNegativeNumber.default(0),
      description: Joi.string().trim(),
      category: Joi.string()
        .valid(
          "stocks",
          "bonds",
          "crypto",
          "forex",
          "realestate",
          "commodities",
          "mutual_funds",
          "etf",
          "other"
        )
        .required(),
      isActive: commonValidations.boolean.default(true),
      isPublic: commonValidations.boolean.default(true),
      features: commonValidations.arrayOfStrings,
      tags: commonValidations.arrayOfStrings,
      maxSlots: Joi.number().integer().min(1),
    }),

    update: Joi.object({
      name: Joi.string().trim(),
      roi: commonValidations.positiveNumber,
      minInvestment: commonValidations.positiveNumber,
      maxInvestment: commonValidations.positiveNumber,
      description: Joi.string().trim(),
      isActive: commonValidations.boolean,
      isPublic: commonValidations.boolean,
      features: commonValidations.arrayOfStrings,
      tags: commonValidations.arrayOfStrings,
      maxSlots: Joi.number().integer().min(1),
      availableSlots: Joi.number().integer().min(0),
    }),

    query: Joi.object({
      category: Joi.string().valid(
        "stocks",
        "bonds",
        "crypto",
        "forex",
        "realestate",
        "commodities",
        "mutual_funds",
        "etf",
        "other"
      ),
      riskLevel: Joi.string().valid("low", "medium", "high", "very_high"),
      currency: commonValidations.currency,
      isActive: commonValidations.boolean,
      isPublic: commonValidations.boolean,
      minRoi: commonValidations.nonNegativeNumber,
      maxRoi: commonValidations.positiveNumber,
      hasAvailableSlots: commonValidations.boolean,
      ...commonValidations.pagination,
    }),
  },
};

// Module exports
module.exports = {
  validate,
  schemas,
  commonValidations,
};
