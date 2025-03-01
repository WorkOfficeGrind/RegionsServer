const dotenv = require("dotenv");
dotenv.config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const mongoose = require("mongoose");
const helmet = require("helmet");
const compression = require("compression");
const { v4: uuidv4 } = require("uuid");
const { Server } = require("socket.io");
const winston = require("winston");
const Transport = require("winston-transport");
const connectDB = require("./config/db");
const userRoutes = require("./routes/user");
const authRoutes = require("./routes/auth");
const transactionRoutes = require("./routes/transaction");
const waitlistRoutes = require("./routes/waitlist");
const walletRoutes = require("./routes/wallet");
const CustomError = require("./utils/customError");
const logger = require("./utils/logger");
const errorHandler = require("./middleware/errorHandler");
const httpLogger = require("./middleware/httpLogger");
const errorLogger = require("./middleware/errorLogger");
const validationErrorHandler = require("./middleware/validationErrorHandler");

logger.info("Starting server initialization...");

// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);
server.setTimeout(30000);

// Socket.io setup for real-time logging
// Replace the existing Socket.io server setup with this
const io = new Server(server, {
  path: "/logs",
  cors: {
    origin: process.env.LOG_DASHBOARD_URL || "*", // Allow specified dashboard or any origin during development
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["my-custom-header"],
    exposedHeaders: ["my-custom-header"],
  },
  // Support WebSocket properly for React Native clients
  transports: ["websocket", "polling"],
  allowUpgrades: true,
  pingTimeout: 30000,
  pingInterval: 10000,
});

// Enhanced logging for socket connections
io.engine.on("connection_error", (err) => {
  logger.error("Socket.io connection error:", {
    code: err.code,
    message: err.message,
    context: err.context,
    timestamp: new Date().toISOString(),
  });
});

// Secure the socket connection with better error messages
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    logger.warn("Socket connection rejected - No token provided", {
      ip: socket.handshake.address,
      socketId: socket.id,
      timestamp: new Date().toISOString(),
    });
    return next(new Error("Authentication error - No token provided"));
  }

  if (token === process.env.LOG_ACCESS_TOKEN) {
    logger.info("Socket authenticated successfully", {
      socketId: socket.id,
      timestamp: new Date().toISOString(),
    });
    return next();
  }

  logger.warn("Socket connection rejected - Invalid token", {
    ip: socket.handshake.address,
    socketId: socket.id,
    timestamp: new Date().toISOString(),
  });
  return next(new Error("Authentication error - Invalid token"));
});

// Handle socket connections with better logging
io.on("connection", (socket) => {
  logger.info("Log client connected", {
    clientId: socket.id,
    address: socket.handshake.address,
    userAgent: socket.handshake.headers["user-agent"] || "Unknown",
    timestamp: new Date().toISOString(),
  });

  // Allow filtering by log level
  socket.on("subscribe", (levels) => {
    if (!Array.isArray(levels)) {
      levels = [levels].filter(Boolean);
    }

    socket.join(levels);
    logger.info("Client subscribed to levels", {
      clientId: socket.id,
      levels,
      timestamp: new Date().toISOString(),
    });

    // Send a test log to confirm subscription is working
    levels.forEach((level) => {
      if (socket.rooms.has(level)) {
        socket.emit("log", {
          timestamp: new Date().toISOString(),
          level: level,
          message: `Test ${level} message - subscription confirmed`,
          requestId: "test-" + socket.id.slice(0, 8),
        });
      }
    });
  });

  socket.on("disconnect", (reason) => {
    logger.info("Log client disconnected", {
      clientId: socket.id,
      reason,
      timestamp: new Date().toISOString(),
    });
  });
});

// Secure the socket connection
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (token === process.env.LOG_ACCESS_TOKEN) {
    return next();
  }
  return next(new Error("Authentication error"));
});

// Create a custom Winston transport for Socket.io
class SocketTransport extends Transport {
  constructor(opts) {
    super(opts);
    this.name = "socketio";
    this.level = opts.level || "info";
    this.io = opts.io;
  }

  log(info, callback) {
    if (this.io) {
      // Emit the log to all connected clients
      this.io.emit("log", {
        timestamp: new Date().toISOString(),
        level: info.level,
        message: info.message,
        ...info,
      });
    }
    callback();
  }
}

// Add the Socket.io transport to Winston logger
logger.add(
  new SocketTransport({
    io,
    level: "debug", // Capture all levels
  })
);

// Add request ID middleware
app.use((req, res, next) => {
  req.id = uuidv4();
  next();
});

app.use(helmet());

app.use(compression());

// Log HTTP requests
app.use(httpLogger);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// app.use(
//   cors({
//     origin: [process.env.CLIENT_URL, process.env.LOG_DASHBOARD_URL].filter(
//       Boolean
//     ),
//     methods: ["GET", "POST", "DELETE", "PUT", "PATCH"],
//     credentials: true,
//   })
// );

app.use(
  cors({
    origin: "*", // During development, you can use * (not recommended for production)
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true, // If you need to send cookies
  })
);

connectDB().catch((err) => {
  logger.error("Failed to connect to MongoDB:", err);
  process.exit(1);
});

// Routes
app.use("/api/users", userRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/waitlists", waitlistRoutes);
app.use("/api/wallets", walletRoutes);

app.get("/keep-alive", (req, res) => {
  res.status(200).send("Server is alive");
});

// Health check for log dashboard
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date(),
    message: "Server is healthy",
    version: "1.0.0",
  });
});

// Catch-all route for undefined endpoints (should be after all valid routes)
app.all("*", (req, res, next) => {
  logger.error({
    message: `Route not found: ${req.originalUrl}`,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    requestId: req.id,
    timestamp: new Date().toISOString(),
  });

  const err = new CustomError(
    404,
    `Welcome To BestendBackendSolutions. Can't find ${req.originalUrl} on the server`
  );
  next(err);
});

// Error handling middleware stack (order is important)
app.use(errorLogger); // Log all errors
app.use(validationErrorHandler); // Handle validation errors
app.use(errorHandler); // Handle all other errors

// Error event handlers
process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Server startup
const PORT = process.env.PORT || 8080;
const LOG_PORT = process.env.LOG_STREAM_PORT || PORT; // Use same port if not specified

server.on("error", (error) => {
  if (error.syscall !== "listen") {
    logger.error("Server error:", error);
    throw error;
  }

  switch (error.code) {
    case "EACCES":
      logger.error(`Port ${PORT} requires elevated privileges`);
      process.exit(1);
      break;
    case "EADDRINUSE":
      logger.error(`Port ${PORT} is already in use`);
      process.exit(1);
      break;
    default:
      logger.error("Server error:", error);
      throw error;
  }
});

server.listen(PORT, "0.0.0.0", () => {
  logger.info(`Server is running on port ${PORT}`);
  logger.info(`Log streaming available on same port, path: /logs`);
  logger.info(`Environment: ${process.env.NODE_ENV || "development"}`);
});

// Graceful shutdown handler
const gracefulShutdown = () => {
  logger.info("Received shutdown signal. Starting graceful shutdown...");

  server.close(() => {
    logger.info("HTTP server closed.");

    mongoose.connection
      .close(false)
      .then(() => {
        logger.info("MongoDB connection closed.");
        process.exit(0);
      })
      .catch((err) => {
        logger.error("Error during MongoDB connection closure:", err);
        process.exit(1);
      });

    setTimeout(() => {
      logger.error(
        "Could not close connections in time, forcefully shutting down"
      );
      process.exit(1);
    }, 10000);
  });
};

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

module.exports = app;
