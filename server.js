require("dotenv").config();
const http = require("http");
const app = require("./app");
const connectDB = require("./config/db");
const cronService = require("./services/cronService");
const { logger } = require("./config/logger");

const server = http.createServer(app);

// Handle uncaught exceptions
process.on("uncaughtException", (err) => {
  logger.error("UNCAUGHT EXCEPTION! 💥 Shutting down...", {
    error: err.message,
    stack: err.stack,
    name: err.name,
  });
  process.exit(1);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (err) => {
  logger.error("UNHANDLED REJECTION! 💥 Shutting down...", {
    error: err.message,
    stack: err.stack,
    name: err.name,
  });
  server.close(() => {
    process.exit(1);
  });
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("👋 SIGTERM RECEIVED. Shutting down gracefully");
  server.close(() => {
    logger.info("💥 Process terminated!");
  });
});

// Connect to MongoDB
connectDB().then(() => {
  cronService.initCronJobs();

  // Start server
  const PORT = process.env.PORT || 5000;

  server.listen(PORT, () => {
    logger.info(
      `Server running in ${process.env.NODE_ENV} mode on port ${PORT}`
    );
  });
});
