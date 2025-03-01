// config/redis.js
const Redis = require("redis");
const logger = require("../utils/logger");

const redisClient = Redis.createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});

redisClient.on("error", (err) => {
  logger.error("Redis connection error:", err);
});

redisClient.on("connect", () => {
  logger.info("Redis connected successfully");
});

// Connect to Redis
const connectRedis = async () => {
  try {
    await redisClient.connect();
  } catch (error) {
    logger.error("Redis connection failed:", error);
    throw error;
  }
};

module.exports = { redisClient, connectRedis };
