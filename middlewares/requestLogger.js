const { logger, addRequestContext } = require("../config/logger");

/**
 * Middleware to log all requests
 * Provides detailed logging for both incoming requests and outgoing responses
 */
const requestLogger = (req, res, next) => {
  // Get the original send function
  const originalSend = res.send;

  // Get request start time
  req.startTime = Date.now();

  // Log the incoming request with context
  const requestContext = addRequestContext(req);

  // Skip logging for health check endpoints
  if (req.originalUrl === "/api/health") {
    return next();
  }

  // Log the request
  logger.info(`Incoming ${req.method} request: ${req.originalUrl}`, {
    ...requestContext,
    query: req.query,
    body: sanitizeRequestBody(req.body),
  });

  // Override the send function to log responses
  res.send = function (body) {
    // Calculate request duration
    const duration = Date.now() - req.startTime;

    // Log based on status code
    const statusCode = res.statusCode;
    const logLevel =
      statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";

    let responseBody;
    try {
      // Try to parse the response body
      responseBody = typeof body === "string" ? JSON.parse(body) : body;
      // Sanitize sensitive data
      responseBody = sanitizeResponseBody(responseBody);
    } catch (error) {
      responseBody = {
        message: "Response body is not valid JSON or contains binary data",
      };
    }

    logger[logLevel](
      `Response ${statusCode} sent for ${req.method} ${req.originalUrl}`,
      {
        ...requestContext,
        statusCode,
        duration: `${duration}ms`,
        size: Buffer.byteLength(body, "utf8"),
        response: responseBody,
      }
    );

    // Call the original send
    return originalSend.call(this, body);
  };

  next();
};

/**
 * Sanitize request body to remove sensitive information
 * @param {Object} body - Request body to sanitize
 * @returns {Object} Sanitized body
 */
const sanitizeRequestBody = (body) => {
  if (!body) return {};

  const sanitized = { ...body };

  // List of sensitive fields to redact
  const sensitiveFields = [
    "password",
    "passwordConfirm",
    "currentPassword",
    "newPassword",
    "token",
    "refreshToken",
    "authToken",
    "accessToken",
    "ssn",
    "socialSecurity",
    "taxId",
    "dob",
    "dateOfBirth",
    "cardNumber",
    "cvv",
    "cvc",
    "pin",
    "securityCode",
    "passcode",
    "passcodeHash",
    "privateKey",
    "secret",
  ];

  // Redact sensitive fields
  sensitiveFields.forEach((field) => {
    if (sanitized[field] !== undefined) {
      sanitized[field] = "[REDACTED]";
    }
  });

  return sanitized;
};

/**
 * Sanitize response body to remove sensitive information
 * @param {Object} body - Response body to sanitize
 * @returns {Object} Sanitized body
 */
const sanitizeResponseBody = (body) => {
  if (!body) return {};

  // For large responses, just return a summary
  if (body && typeof body === "object" && Object.keys(body).length > 20) {
    return {
      summary: `Large response (${Object.keys(body).length} keys)`,
      status: body.status,
    };
  }

  // Otherwise sanitize the body
  const sanitized = { ...body };

  // List of sensitive fields to redact in response
  const sensitiveFields = [
    "token",
    "refreshToken",
    "authToken",
    "accessToken",
    "password",
    "passwordHash",
    "passcodeHash",
    "ssn",
    "socialSecurity",
    "taxId",
  ];

  // Redact sensitive fields
  sensitiveFields.forEach((field) => {
    if (sanitized[field] !== undefined) {
      sanitized[field] = "[REDACTED]";
    }
  });

  return sanitized;
};



module.exports = { requestLogger, sanitizeRequestBody };
