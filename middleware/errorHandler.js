const logger = require("../utils/logger");
const ValidationError = require("../utils/validationError");

const errorHandler = (err, req, res, next) => {
  // Skip validation errors as they're handled by validationErrorHandler
  if (err instanceof ValidationError) {
    return next(err);
  }

  // Create structured error log
  const errorLog = {
    type: err.name || "Error",
    statusCode: err.statusCode || 500,
    message: err.message,
    requestId: req.id,
    timestamp: new Date().toISOString(),
    request: {
      method: req.method,
      url: req.originalUrl,
      params: req.params,
      query: req.query,
      body: sanitizeRequestBody(req.body),
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
    error: {
      stack: err.stack,
      ...(err.details && { details: err.details }),
    },
    clientInfo: {
      ip: req.ip,
      userAgent: req.get("user-agent"),
    },
  };

  // Log based on error severity
  if (err.statusCode >= 500) {
    logger.error(errorLog);
  } else {
    logger.warn(errorLog);
  }

  // Send response based on environment
  if (process.env.NODE_ENV === "development") {
    return res.status(err.statusCode || 500).json({
      status: err.status || "error",
      message: err.message,
      stack: err.stack,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });
  }

  // Production response
  return res.status(err.statusCode || 500).json({
    status: err.status || "error",
    message: err.isOperational ? err.message : "Something went wrong",
    requestId: req.id,
  });
};

// Helper function to sanitize request body
const sanitizeRequestBody = (body) => {
  if (!body) return {};

  const sensitiveFields = [
    "password",
    "token",
    "apiKey",
    "secret",
    "pin",
    "ssn",
  ];
  const sanitized = JSON.parse(JSON.stringify(body));

  const maskField = (obj) => {
    for (const key in obj) {
      if (typeof obj[key] === "object") {
        maskField(obj[key]);
      } else if (sensitiveFields.includes(key.toLowerCase())) {
        obj[key] = "********";
      }
    }
  };

  maskField(sanitized);
  return sanitized;
};

module.exports = errorHandler;
