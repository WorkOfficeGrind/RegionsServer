// Create a new file: utils/error.js
class AppError extends Error {
  constructor(message, statusCode, errorCode = null) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode || this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
