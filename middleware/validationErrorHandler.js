const logger = require("../utils/logger");
const ValidationError = require("../utils/validationError");

const validationErrorHandler = (err, req, res, next) => {
  // Skip if not a validation error
  if (!(err instanceof ValidationError)) {
    return next(err);
  }

  // Create a comprehensive log entry
  const logEntry = {
    type: "VALIDATION_ERROR",
    requestId: req.id,
    timestamp: new Date().toISOString(),
    request: {
      method: req.method,
      url: req.originalUrl,
      params: req.params,
      query: req.query,
      body: err.requestData, // Already sanitized in ValidationError class
      headers: {
        "user-agent": req.get("user-agent"),
        "content-type": req.get("content-type"),
        accept: req.get("accept"),
      },
    },
    user: req.user
      ? {
          id: req.user.id,
          role: req.user.role,
        }
      : "unauthenticated",
    errors: err.errors,
    clientInfo: {
      ip: req.ip,
      userAgent: req.get("user-agent"),
    },
  };

  // Log the validation error
  logger.warn({
    message: "Validation Error",
    ...logEntry,
  });

  // Send response based on environment
  const response = {
    status: "fail",
    message: "Validation Error",
    errors: err.errors,
  };

  if (process.env.NODE_ENV === "development") {
    response.debug = {
      requestId: req.id,
      timestamp: new Date().toISOString(),
    };
  }

  res.status(400).json(response);
};

module.exports = validationErrorHandler;
