// Application-wide configuration values
module.exports = {
  appName: process.env.APP_NAME || "Regions Prime",
  appUrl: process.env.APP_URL || "https://regions.com/prime",
  supportEmail: process.env.SUPPORT_EMAIL || "support@primebanking.com",

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
    from: process.env.EMAIL_FROM || "noreply@primebanking.com",
    smtp: {
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      auth: {
        user: process.env.EMAIL_USERNAME,
        pass: process.env.EMAIL_PASSWORD,
      },
    },
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    fromAddress: process.env.SMTP_FROM_ADDRESS || "noreply@your-app.com",
    fromName: process.env.SMTP_FROM_NAME || "Your App Name",
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
    passwordMaxAttempts: 3,
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

  cloudinary: {
    timeout: process.env.CLOUDINARY_TIMEOUT || 60000,
    maxRetries: process.env.CLOUDINARY_MAX_RETRIES || 3,
    folder: process.env.CLOUDINARY_FOLDER || "prime-id-verification",
  },

  uploads: {
    maxFileSize: process.env.UPLOAD_MAX_FILE_SIZE || 10 * 1024 * 1024,
  },

  brevo: {
    apiKey: process.env.BREVO_API_KEY,
    senderEmail: process.env.BREVO_SENDER_EMAIL || "noreply@your-app.com",
    senderName: process.env.BREVO_SENDER_NAME || "Your App Name",

    // Template IDs (configured in Brevo dashboard)
    templates: {
      welcome: parseInt(process.env.BREVO_TEMPLATE_WELCOME) || 1,
      passwordReset: parseInt(process.env.BREVO_TEMPLATE_PASSWORD_RESET) || 2,
      emailChangeVerification:
        parseInt(process.env.BREVO_TEMPLATE_EMAIL_CHANGE_VERIFICATION) || 3,
      emailChangeConfirmation:
        parseInt(process.env.BREVO_TEMPLATE_EMAIL_CHANGE_CONFIRMATION) || 4,
      emailChangeRejection:
        parseInt(process.env.BREVO_TEMPLATE_EMAIL_CHANGE_REJECTION) || 5,
      nameChangeConfirmation:
        parseInt(process.env.BREVO_TEMPLATE_NAME_CHANGE_CONFIRMATION) || 6,
      nameChangeRejection:
        parseInt(process.env.BREVO_TEMPLATE_NAME_CHANGE_REJECTION) || 7,
      accountLocked: parseInt(process.env.BREVO_TEMPLATE_ACCOUNT_LOCKED) || 8,
      securityAlert: parseInt(process.env.BREVO_TEMPLATE_SECURITY_ALERT) || 9,
    },
  },

  // Email configuration fallbacks (if not using Brevo)
};
