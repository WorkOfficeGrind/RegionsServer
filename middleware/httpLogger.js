
const morgan = require("morgan");
const logger = require("../utils/logger");

// Create a write stream for Morgan
const stream = {
  write: (message) => logger.http(message.trim()),
};

// Custom token for request body
morgan.token("body", (req) => {
  const body = { ...req.body };

  // Remove sensitive data
  if (body.password) body.password = "********";
  if (body.pin) body.pin = "****";
  if (body.ssn) body.ssn = "***-**-****";

  return JSON.stringify(body);
});

// Custom format string
const morganFormat =
  ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :response-time ms :body';

// Create the middleware
const httpLogger = morgan(morganFormat, { stream });

module.exports = httpLogger;
