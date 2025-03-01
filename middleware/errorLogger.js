
const logger = require("../utils/logger");

const errorLogger = (err, req, res, next) => {
  // Log error details
  logger.error({
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    user: req.user ? req.user.id : "unauthenticated",
    timestamp: new Date().toISOString(),
    requestId: req.id, // Assuming you're using express-request-id
    body: sanitizeRequestBody(req.body),
    params: req.params,
    query: req.query,
  });

  next(err);
};

// Helper function to remove sensitive data
const sanitizeRequestBody = (body) => {
  const sanitized = { ...body };
  const sensitiveFields = ["password", "pin", "ssn", "token"];

  sensitiveFields.forEach((field) => {
    if (sanitized[field]) {
      sanitized[field] = "********";
    }
  });

  return sanitized;
};

module.exports = errorLogger;
