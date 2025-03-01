class ValidationError extends Error {
  constructor(errors, requestData) {
    super("Validation Error");
    this.name = "ValidationError";
    this.statusCode = 400;
    this.status = "fail";
    this.isOperational = true;
    this.errors = this.formatErrors(errors);
    this.requestData = this.sanitizeRequestData(requestData);

    Error.captureStackTrace(this, this.constructor);
  }

  formatErrors(errors) {
    // Convert various error formats into a standardized structure
    if (Array.isArray(errors)) {
      return errors.map((error) => ({
        field: error.path || error.field || "unknown",
        message: error.message,
        value: error.value,
        code: error.code || "INVALID_VALUE",
      }));
    }

    if (typeof errors === "object") {
      return Object.entries(errors).map(([field, message]) => ({
        field,
        message: typeof message === "string" ? message : message.message,
        value: message.value,
        code: message.code || "INVALID_VALUE",
      }));
    }

    return [
      {
        field: "unknown",
        message: errors.toString(),
        code: "VALIDATION_ERROR",
      },
    ];
  }

  sanitizeRequestData(data) {
    if (!data) return {};

    const sensitiveFields = [
      "password",
      "token",
      "apiKey",
      "secret",
      "pin",
      "ssn",
    ];
    const sanitized = { ...data };

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
  }

  toJSON() {
    return {
      name: this.name,
      statusCode: this.statusCode,
      status: this.status,
      errors: this.errors,
      requestData: this.requestData,
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = ValidationError;
