const { validationResult } = require("express-validator");
const CustomError = require("../utils/customError");
// Add a logger import - you can use any logging library you prefer
const logger = require("../utils/logger"); // Adjust path to your logger

/**
 * Express middleware that runs validation rules and handles validation errors
 * with enhanced logging for root cause analysis
 *
 * @param {Array} validations - Array of express-validator validation chains
 * @returns {Function} Express middleware function
 */
const middlewareRunner = (validations) => {
  return async (req, res, next) => {
    // Run all validations
    await Promise.all(validations.map((validation) => validation.run(req)));

    // Check for validation errors
    const errors = validationResult(req);

    if (errors.isEmpty()) {
      // No validation errors, continue to next middleware/controller
      return next();
    }

    // Format errors for the response
    const extractedErrors = [];
    errors.array().forEach((err) => {
      extractedErrors.push({ [err.param]: err.msg });
    });

    // Create a detailed error log with context for root cause analysis
    const logContext = {
      path: req.path,
      method: req.method,
      body: req.body,
      params: req.params,
      query: req.query,
      headers: {
        contentType: req.get("Content-Type"),
        userAgent: req.get("User-Agent"),
      },
      validationErrors: errors.array(),
      timestamp: new Date().toISOString(),
    };

    // Log the validation error with context
    logger.error("Validation error occurred", logContext);

    // Create a custom error with validation details
    const error = new CustomError(400, "Validation Error", {
      errors: extractedErrors,
    });

    next(error);
  };
};

module.exports = middlewareRunner;
