// logStream.js
const winston = require("winston");
const { createServer } = require("http");
const { Server } = require("socket.io");
const Transport = require("winston-transport");
const logger = require("../utils/logger");

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

// Initialize the socket server
const initLogStream = (app) => {
  const server = createServer(app);
  const io = new Server(server, {
    path: "/logs",
    cors: {
      origin: process.env.LOG_DASHBOARD_URL || "http://localhost:3001",
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  // Secure the socket connection
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (token === process.env.LOG_ACCESS_TOKEN) {
      return next();
    }
    return next(new Error("Authentication error"));
  });

  // Add the Socket.io transport to Winston
  logger.add(
    new SocketTransport({
      io,
      level: "debug", // Capture all levels
    })
  );

  // Handle connections
  io.on("connection", (socket) => {
    console.log("Log client connected");

    // Allow filtering by log level
    socket.on("subscribe", (levels) => {
      socket.join(levels);
    });

    socket.on("disconnect", () => {
      console.log("Log client disconnected");
    });
  });

  // Start listening
  const PORT = process.env.LOG_STREAM_PORT || 3030;
  server.listen(PORT, () => {
    console.log(`Log streaming server running on port ${PORT}`);
  });

  return server;
};

module.exports = initLogStream;
