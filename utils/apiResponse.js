/**
 * Standard API response utility
 * Provides consistent response format across the application
 */

/**
 * Send success response
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Success message
 * @param {Object} data - Response data
 * @param {Object} meta - Additional metadata (pagination, etc.)
 */
const success = (
  res,
  statusCode = 200,
  message = "Success",
  data = {},
  meta = {}
) => {
  const response = {
    status: "success",
    message,
  };

  // Add data if provided (if not empty)
  if (data && Object.keys(data).length > 0) {
    response.data = data;
  }

  // Add metadata if provided (if not empty)
  if (meta && Object.keys(meta).length > 0) {
    response.meta = meta;
  }

  return res.status(statusCode).json(response);
};

/**
 * Send error response
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {Object} errors - Detailed error information
 */
const error = (res, statusCode = 500, message = "Error", errors = null) => {
  const response = {
    status: "error",
    message,
  };

  // Add detailed errors if provided
  if (errors) {
    response.errors = errors;
  }

  return res.status(statusCode).json(response);
};

/**
 * Send created response (HTTP 201)
 * @param {Object} res - Express response object
 * @param {string} message - Success message
 * @param {Object} data - Response data
 */
const created = (res, message = "Resource created successfully", data = {}) => {
  return success(res, 201, message, data);
};

/**
 * Send updated response
 * @param {Object} res - Express response object
 * @param {string} message - Success message
 * @param {Object} data - Response data
 */
const updated = (res, message = "Resource updated successfully", data = {}) => {
  return success(res, 200, message, data);
};

/**
 * Send deleted response
 * @param {Object} res - Express response object
 * @param {string} message - Success message
 */
const deleted = (res, message = "Resource deleted successfully") => {
  return success(res, 200, message);
};

/**
 * Send not found response
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 */
const notFound = (res, message = "Resource not found") => {
  return error(res, 404, message);
};

/**
 * Send bad request response
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 * @param {Object} errors - Detailed error information
 */
const badRequest = (res, message = "Invalid request", errors = null) => {
  return error(res, 400, message, errors);
};

/**
 * Send unauthorized response
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 */
const unauthorized = (res, message = "Authentication required") => {
  return error(res, 401, message);
};

/**
 * Send forbidden response
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 */
const forbidden = (
  res,
  message = "You do not have permission to perform this action"
) => {
  return error(res, 403, message);
};

/**
 * Send pagination metadata
 * @param {number} total - Total number of items
 * @param {number} page - Current page
 * @param {number} limit - Items per page
 * @param {number} pages - Total number of pages
 */
const paginationMeta = (total, page, limit, pages) => {
  return {
    pagination: {
      total,
      page,
      limit,
      pages,
    },
  };
};

module.exports = {
  success,
  error,
  created,
  updated,
  deleted,
  notFound,
  badRequest,
  unauthorized,
  forbidden,
  paginationMeta,
};
