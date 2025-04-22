require("./models/User");
require("./models/Account");
require("./models/Card");
require("./models/Wallet");
require("./models/Beneficiary");
require("./models/WalletBeneficiary");
require("./models/Bill");
require("./models/RefreshToken");
require("./models/WalletTransaction");
require("./models/Transaction");
require("./models/Cashapp");
require("./models/InvestmentPlan");
require("./models/InvestmentTransaction");
require("./models/EmailChange");
require("./models/NameChange");
require("./models/PhoneChange");
require("./models/AddressChange");
require("./models/Paypal");
require("./models/PreloadedWallet");
require("./models/UserInvestment");
require("./models/Venmo");
require("./models/Waitlist");
require("./models/Zelle");
require("./models/Notification");

const express = require("express");
const morgan = require("morgan");
const helmet = require("helmet");
const cors = require("cors");
const xss = require("xss-clean");
const mongoSanitize = require("express-mongo-sanitize");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const hpp = require("hpp");
const { v4: uuidv4 } = require("uuid");
const passport = require("passport");
const { logger } = require("./config/logger");
const errorHandler = require("./middlewares/errorHandler");
const { requestLogger } = require("./middlewares/requestLogger");

// Route imports
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const accountRoutes = require("./routes/accountRoutes");
const cardRoutes = require("./routes/cardRoutes");
const walletRoutes = require("./routes/walletRoutes");
const preloadedWalletRoutes = require("./routes/preloadedWalletRoutes");
const transactionRoutes = require("./routes/transactionRoutes");
const investmentRoutes = require("./routes/investmentRoutes");
const beneficiaryRoutes = require("./routes/beneficiaryRoutes");
const walletBeneficiaryRoutes = require("./routes/walletBeneficiaryRoutes");
const billRoutes = require("./routes/billRoutes");
const notificationRoutes = require("./routes/notificationRoutes");

// Initialize express application
const app = express();

app.use((req, res, next) => {
  // Preserve existing ID from headers if present (for microservice tracing)
  req.id = req.headers["x-request-id"] || uuidv4();
  // Add it to response headers for client debugging
  res.setHeader("x-request-id", req.id);
  next();
});

// Performance monitoring middleware
app.use((req, res, next) => {
  const start = process.hrtime();

  res.on("finish", () => {
    const [seconds, nanoseconds] = process.hrtime(start);
    const duration = seconds * 1000 + nanoseconds / 1000000;

    // Log slow requests (over 1 second)
    if (duration > 1000) {
      logger.warn(`Slow request detected: ${req.method} ${req.originalUrl}`, {
        duration: `${duration.toFixed(2)}ms`,
        method: req.method,
        path: req.originalUrl,
        requestId: req.id,
        userId: req.user ? req.user._id : "unauthenticated",
      });
    }
  });

  next();
});

// Body parser
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));

// Set security HTTP headers
app.use(helmet());

// CORS configuration
// app.use(
//   cors({
//     origin:
//       process.env.NODE_ENV === "production"
//         ? process.env.ALLOWED_ORIGINS.split(",")
//         : "*",
//     methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
//     allowedHeaders: ["Content-Type", "Authorization"],
//     credentials: true,
//   })
// );

app.use(
  cors({
    origin: "*", // During development, you can use * (not recommended for production)
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true, // If you need to send cookies
  })
);

// Development logging
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// Request logger middleware - assign unique ID to each request
app.use((req, res, next) => {
  req.id = uuidv4();
  next();
});

// Custom request logger
app.use(requestLogger);

// Rate limiting
const limiter = rateLimit({
  max: 100, // 100 requests per windowMs
  windowMs: 15 * 60 * 1000, // 15 minutes
  message: "Too many requests from this IP, please try again after 15 minutes",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip, // Use IP for rate limiting
  handler: (req, res) => {
    logger.warn("Rate limit exceeded", {
      ip: req.ip,
      endpoint: req.originalUrl,
    });
    res.status(429).json({
      status: "error",
      message: "Too many requests, please try again later.",
    });
  },
});

// Apply rate limiting to all API routes
app.use("/api", limiter);

// Data sanitization against NoSQL query injection
app.use(mongoSanitize());

// Data sanitization against XSS
app.use(xss());

// Prevent parameter pollution
app.use(
  hpp({
    whitelist: [
      "amount",
      "status",
      "type",
      "currency",
      "date",
      "sort",
      "fields",
      "page",
      "limit",
      "startDate",
      "endDate",
    ],
  })
);

// Compression middleware
app.use(compression());

// Initialize passport
app.use(passport.initialize());
require("./config/passport");

// API routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/accounts", accountRoutes);
// app.use("/api/v1/cards", cardRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/wallets", walletRoutes);
app.use("/api/v1/preloaded-wallets", preloadedWalletRoutes);
app.use("/api/v1/transactions", transactionRoutes);
app.use("/api/v1/investments", investmentRoutes);
app.use("/api/v1/beneficiaries", beneficiaryRoutes);
app.use("/api/v1/wallet-beneficiaries", walletBeneficiaryRoutes);
app.use("/api/v1/bills", billRoutes);

// Health check route
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "success",
    message: "API is running smoothly",
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// Handle undefined routes
app.all("*", (req, res, next) => {
  logger.warn(`Route not found: ${req.originalUrl}`, {
    method: req.method,
    ip: req.ip,
  });

  const err = new Error(`Cannot find ${req.originalUrl} on this server!`);
  err.status = "fail";
  err.statusCode = 404;

  next(err);
});

// Global error handler
app.use(errorHandler);

module.exports = app;
