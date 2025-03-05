const winston = require("winston");
const { createLogger, format, transports } = winston;
const { combine, timestamp, printf, colorize, json } = format;
require("winston-daily-rotate-file");

// Custom format for console logging
// const consoleFormat = printf(({ level, message, timestamp, ...metadata }) => {
//   const metaStr = Object.keys(metadata).length
//     ? JSON.stringify(metadata, null, 2)
//     : "";
//   return `${timestamp} [${level}]: ${message} ${metaStr}`;
// });

const consoleFormat = printf(({ level, message, timestamp, ...metadata }) => {
  const getCircularReplacer = () => {
    const seen = new WeakSet();
    return (key, value) => {
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) {
          return;
        }
        seen.add(value);
      }
      return value;
    };
  };

  const metaStr = Object.keys(metadata).length
    ? JSON.stringify(metadata, getCircularReplacer(), 2)
    : "";
  return `${timestamp} [${level}]: ${message} ${metaStr}`;
});

// Define file transports for different log levels
const fileTransport = new transports.DailyRotateFile({
  filename: "logs/application-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  zippedArchive: true,
  maxSize: "20m",
  maxFiles: "14d",
  format: combine(timestamp(), json()),
});

const errorFileTransport = new transports.DailyRotateFile({
  filename: "logs/error-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  zippedArchive: true,
  maxSize: "20m",
  maxFiles: "30d",
  level: "error",
  format: combine(timestamp(), json()),
});

const transactionFileTransport = new transports.DailyRotateFile({
  filename: "logs/transactions-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  zippedArchive: true,
  maxSize: "20m",
  maxFiles: "90d",
  format: combine(timestamp(), json()),
});

// Create the logger
const logger = createLogger({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  format: combine(timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), json()),
  defaultMeta: { service: "banking-investment-api" },
  transports: [
    new transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        consoleFormat
      ),
    }),
    fileTransport,
    errorFileTransport,
    transactionFileTransport,
  ],
  exceptionHandlers: [
    new transports.DailyRotateFile({
      filename: "logs/exceptions-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxSize: "20m",
      maxFiles: "30d",
    }),
    new transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        consoleFormat
      ),
    }),
  ],
  rejectionHandlers: [
    new transports.DailyRotateFile({
      filename: "logs/rejections-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxSize: "20m",
      maxFiles: "30d",
    }),
    new transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        consoleFormat
      ),
    }),
  ],
});

// Create specialized transaction logger
const transactionLogger = createLogger({
  level: "info",
  format: combine(timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), json()),
  defaultMeta: { service: "transaction-service" },
  transports: [
    transactionFileTransport,
    new transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        consoleFormat
      ),
    }),
  ],
});

// Log database operations in development
if (process.env.NODE_ENV !== "production") {
  logger.debug("Logging initialized at debug level");
}

// Module augmentation to add request context
const addRequestContext = (req) => {
  return {
    userId: req.user ? req.user._id : "unauthenticated",
    ip: req.ip,
    method: req.method,
    path: req.path,
    requestId: req.id, // Assuming a request ID middleware is used
    userAgent: req.get("user-agent") || "unknown",
  };
};

module.exports = {
  logger,
  transactionLogger,
  addRequestContext,
};
