/**
 * Standard API response utility
 * Provides consistent response format across the application
 */

/**
 * Send success response
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {string} title - Success title
 * @param {string} message - Success message
 * @param {Object} data - Response data
 * @param {Object} meta - Additional metadata (pagination, etc.)
 */
const success = (
  res,
  statusCode = 200,
  title = "Success",
  message = "Operation Successful",
  data = {},
  meta = {}
) => {
  const response = {
    success: true,
    title,
    message,
    data,
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
 * @param {string} title - Error title
 * @param {string} message - Error message
 * @param {string} errorCode - Error code for debugging
 */
const error = (
  res,
  statusCode = 500,
  title = "Error",
  message = "An error occurred",
  errorCode = "SERVER_ERROR",
  errors = null
) => {
  const response = {
    success: false,
    title,
    message,
    errorCode,
  };

  // Add detailed errors if provided
  if (errors) {
    response.errors = errors;
  }

  return res.status(statusCode).json(response);
};

/**
 * Send created response (HTTP 201)
 */
const created = (
  res,
  title = "Created",
  message = "Resource created successfully",
  data = {}
) => {
  return success(res, 201, title, message, data);
};

/**
 * Send updated response
 */
const updated = (
  res,
  title = "Updated",
  message = "Resource updated successfully",
  data = {}
) => {
  return success(res, 200, title, message, data);
};

/**
 * Send deleted response
 */
const deleted = (
  res,
  title = "Deleted",
  message = "Resource deleted successfully"
) => {
  return success(res, 200, title, message);
};

/**
 * Send not found response
 */
const notFound = (
    res,
  title = "Not Found",
  message = "Resource not found",
  errorCode = "NOT_FOUND"
 ) => {
  return error(res, 404, title, message, errorCode);
};

/**
 * Send bad request response
 */
const badRequest = (
  res,
  title = "Bad Request",
  message = "Invalid request",
  errorCode = "BAD_REQUEST"
) => {
  return error(res, 400, title, message, errorCode);
};

/**
 * Send unauthorized response
 */
const unauthorized = (
  res,
  title = "Unauthorized",
  message = "Authentication required",
  errorCode = "UNAUTHORIZED"
) => {
  return error(res, 401, title, message, errorCode);
};


const unvalidated = (
  res,
  title = "Unvalidated",
  message = "Authentication required",
  errorCode = "UNVALIDATED"
) => {
  return error(res, 403, title, message, errorCode);
};

/**
 * Send forbidden response
 */
const forbidden = (
  res,
  title = "Forbidden",
  message = "You do not have permission to perform this action",
  errorCode = "FORBIDDEN"
) => {
  return error(res, 403, title, message, errorCode);
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
  unvalidated,
  forbidden,
  paginationMeta,
};
