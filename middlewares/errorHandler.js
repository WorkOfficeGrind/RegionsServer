const mongoose = require("mongoose");
const { logger } = require("../config/logger");

// Error classification helper
const classifyError = (err) => {
  if (
    err.name === "ValidationError" ||
    err instanceof mongoose.Error.ValidationError
  ) {
    return { type: "VALIDATION_ERROR", statusCode: 400 };
  }

  if (err.name === "CastError" || err instanceof mongoose.Error.CastError) {
    return { type: "CAST_ERROR", statusCode: 400 };
  }

  if (err.code === 11000) {
    return { type: "DUPLICATE_KEY_ERROR", statusCode: 409 };
  }

  if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    return { type: "TOKEN_ERROR", statusCode: 401 };
  }

  if (err.name === "TransactionError" || err.message.includes("transaction")) {
    return { type: "TRANSACTION_ERROR", statusCode: 400 };
  }

  if (
    err.name === "SecurityError" ||
    err.message.toLowerCase().includes("security")
  ) {
    return { type: "SECURITY_ERROR", statusCode: 403 };
  }

  if (err.statusCode === 404 || err.message.includes("not found")) {
    return { type: "NOT_FOUND_ERROR", statusCode: 404 };
  }

  if (err.statusCode === 403 || err.message.includes("permission")) {
    return { type: "FORBIDDEN_ERROR", statusCode: 403 };
  }

  return { type: "SERVER_ERROR", statusCode: err.statusCode || 500 };
};

// Format validation errors
const formatValidationErrors = (error) => {
  const validationErrors = {};

  // Mongoose validation errors
  if (error.errors) {
    Object.keys(error.errors).forEach((key) => {
      validationErrors[key] = error.errors[key].message;
    });
  }

  return validationErrors;
};

// Format duplicate key errors
const formatDuplicateKeyError = (error) => {
  const field = Object.keys(error.keyValue)[0];
  const value = error.keyValue[field];
  return { field, value };
};

// Main error handler middleware
const errorHandler = (err, req, res, next) => {
  // Classify the error
  const { type, statusCode } = classifyError(err);

  // Set default error message
  let errorMessage = err.message || "Something went wrong";
  let details = {};

  // Format error details based on type
  switch (type) {
    // Add this inside your errorHandler middleware, in the VALIDATION_ERROR case
    case "VALIDATION_ERROR":
      errorMessage = "Validation failed";
      details = formatValidationErrors(err);

      // Additional detailed logging for validation errors
      logger.warn(`Validation error details: ${JSON.stringify(details)}`, {
        endpoint: req.originalUrl,
        method: req.method,
        validationErrors: details,
        requestId: req.id,
        requestBody: sanitizeRequestBody(req.body),
      });
      break;

    case "CAST_ERROR":
      errorMessage = `Invalid ${err.path}: ${err.value}`;
      details = { field: err.path, value: err.value };
      break;

    case "DUPLICATE_KEY_ERROR":
      const dupDetails = formatDuplicateKeyError(err);
      errorMessage = `Duplicate value for ${dupDetails.field}: ${dupDetails.value}`;
      details = dupDetails;
      break;

    case "TOKEN_ERROR":
      errorMessage =
        err.name === "TokenExpiredError"
          ? "Your session has expired. Please log in again."
          : "Invalid authentication token";
      break;

    case "NOT_FOUND_ERROR":
      errorMessage = err.message || "Resource not found";
      break;

    case "FORBIDDEN_ERROR":
      errorMessage =
        err.message || "You do not have permission to perform this action";
      break;
  }

  // Log the error with appropriate level
  const logLevel = statusCode >= 500 ? "error" : "warn";

  // Replace the existing logging section
  logger[logLevel](`[${type}] ${errorMessage}`, {
    error: {
      message: err.message,
      name: err.name,
      code: err.code,
      type: type,
    },
    stack: err.stack,
    request: {
      id: req.id,
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      userAgent: req.get("user-agent") || "unknown",
    },
    user: req.user
      ? {
          id: req.user._id,
          role: req.user.role,
        }
      : "unauthenticated",
    details: details,
    timestamp: new Date().toISOString(),
  });

  // Prepare the response
  const errorResponse = {
    status: "error",
    message: errorMessage,
    code: type,
    requestId: req.id,
  };

  // Add details for specific error types
  if (Object.keys(details).length > 0) {
    errorResponse.details = details;
  }

  // Add stack trace in development environment
  if (process.env.NODE_ENV === "development") {
    errorResponse.stack = err.stack;
  }

  res.status(statusCode).json(errorResponse);
};

module.exports = errorHandler;
