// Application-wide configuration values
module.exports = {
  // JWT configuration
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || "24h",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  },

  // Database configuration
  db: {
    uri: process.env.MONGO_URI,
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    },
  },

  // Server configuration
  server: {
    port: process.env.PORT || 5000,
    env: process.env.NODE_ENV || "development",
    apiPrefix: "/api/v1",
  },

  // CORS configuration
  cors: {
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",")
      : "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  },

  // Email configuration
  email: {
    from: process.env.EMAIL_FROM || "noreply@bankingapp.com",
    smtp: {
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      auth: {
        user: process.env.EMAIL_USERNAME,
        pass: process.env.EMAIL_PASSWORD,
      },
    },
  },

  // Transaction fee structure
  fees: {
    transfer: {
      percentage: 0.5,
      min: 1,
      max: 25,
    },
    withdrawal: {
      percentage: 1,
      min: 2,
      max: 50,
    },
    exchange: {
      percentage: 1.5,
      min: 3,
      max: 100,
    },
  },

  // Currency exchange default values
  exchange: {
    defaultConversionRate: 1,
    supportedCurrencies: [
      "USD",
      "EUR",
      "GBP",
      "JPY",
      "CAD",
      "AUD",
      "CHF",
      "CNY",
      "BTC",
      "ETH",
    ],
  },

  // Security settings
  security: {
    bcryptSaltRounds: 12,
    maxLoginAttempts: 5,
    lockoutTime: 30 * 60 * 1000, // 30 minutes
    passwordResetExpires: 60 * 60 * 1000, // 1 hour
    passcodeMaxAttempts: 3,
  },

  // Rate limiting configuration
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || "info",
    maxFiles: {
      application: "14d",
      error: "30d",
      transaction: "90d",
    },
  },

  // Default limits for various operations
  limits: {
    transfer: {
      daily: 10000,
      transaction: 5000,
    },
    withdrawal: {
      daily: 5000,
      transaction: 2000,
    },
  },

  // Investment settings
  investment: {
    minAmount: 100,
    defaultCurrency: "USD",
    defaultMaturityPeriod: 30, // days
  },
};
