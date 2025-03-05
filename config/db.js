const mongoose = require("mongoose");
const { logger } = require("./logger");

// MongoDB connection options
const options = {
  autoIndex: process.env.NODE_ENV !== "production", // Don't build indexes in production
  serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
  socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
  family: 4, // Use IPv4, skip trying IPv6
};

// Log all MongoDB queries in development
if (process.env.NODE_ENV !== "production") {
  mongoose.set("debug", (collectionName, method, query, doc) => {
    logger.debug(`MongoDB: ${collectionName}.${method}`, {
      query,
      doc,
      collection: collectionName,
    });
  });
}

// Connect to MongoDB
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, options);

    logger.info(`MongoDB Connected: ${conn.connection.host}`, {
      database: conn.connection.name,
      host: conn.connection.host,
    });

    // Handle connection events
    mongoose.connection.on("error", (err) => {
      logger.error("MongoDB connection error", { error: err.message });
    });

    mongoose.connection.on("disconnected", () => {
      logger.warn("MongoDB disconnected");
    });

    mongoose.connection.on("reconnected", () => {
      logger.info("MongoDB reconnected");
    });

    // Graceful shutdown
    process.on("SIGINT", async () => {
      await mongoose.connection.close();
      logger.info("MongoDB connection closed due to app termination");
      process.exit(0);
    });

    return conn;
  } catch (error) {
    logger.error("MongoDB connection error", {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
};

module.exports = connectDB;
