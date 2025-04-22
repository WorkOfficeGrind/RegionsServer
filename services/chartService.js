// server/services/chartDataService.js

const socketIo = require("socket.io");
const mongoose = require("mongoose");
const UserInvestment = require("../models/UserInvestment");
const { logger } = require("../config/logger");

/**
 * Service to generate and emit real-time chart data for investments
 */
class ChartDataService {
  constructor(server) {
    this.io = socketIo(server, {
      cors: {
        origin: "*", // Configure according to your security requirements
        methods: ["GET", "POST"],
      },
    });

    this.activeConnections = new Map(); // Map of userId -> Set of socketIds
    this.watchedInvestments = new Map(); // Map of investmentId -> Set of socketIds
    this.cachedData = new Map(); // Cache of chart data by investmentId
    this.updateIntervals = new Map(); // Map of investmentId -> interval id

    this.setupSocketConnections();
    logger.info("Chart data service initialized");
  }

  /**
   * Setup socket connection handlers
   */
  setupSocketConnections() {
    this.io.on("connection", (socket) => {
      logger.info(`New socket connection: ${socket.id}`);

      // Authenticate user
      socket.on("authenticate", (data) => {
        this.authenticateUser(socket, data);
      });

      // Subscribe to investment updates
      socket.on("subscribe", (data) => {
        this.subscribeToInvestment(socket, data);
      });

      // Unsubscribe from investment updates
      socket.on("unsubscribe", (data) => {
        this.unsubscribeFromInvestment(socket, data);
      });

      // Handle disconnection
      socket.on("disconnect", () => {
        this.handleDisconnect(socket);
      });
    });
  }

  /**
   * Authenticate user connection
   */
  authenticateUser(socket, { userId, token }) {
    // In production, implement proper token validation here
    // For now, we'll trust the userId
    logger.info(`Authenticating user: ${userId}`);

    socket.userId = userId;

    // Track connection by userId
    if (!this.activeConnections.has(userId)) {
      this.activeConnections.set(userId, new Set());
    }
    this.activeConnections.get(userId).add(socket.id);

    socket.emit("authenticated", { success: true });
    logger.info(`User authenticated: ${userId}`);
  }

  /**
   * Subscribe a socket to investment updates
   */
  async subscribeToInvestment(socket, { investmentId }) {
    if (!socket.userId) {
      socket.emit("error", { message: "Authentication required" });
      return;
    }

    logger.info(
      `Subscribe request: User ${socket.userId} to investment ${investmentId}`
    );

    try {
      // Verify the user owns this investment
      const investment = await UserInvestment.findOne({
        _id: investmentId,
        user: socket.userId,
      });

      if (!investment) {
        socket.emit("error", {
          message: "Investment not found or access denied",
        });
        return;
      }

      // Add socket to the watched investments
      if (!this.watchedInvestments.has(investmentId)) {
        this.watchedInvestments.set(investmentId, new Set());

        // Initialize chart data generation for this investment
        this.initializeChartData(investmentId, investment);
      }

      this.watchedInvestments.get(investmentId).add(socket.id);

      // Join the investment's room
      socket.join(`investment:${investmentId}`);

      // Send initial data
      if (this.cachedData.has(investmentId)) {
        socket.emit("chartData", {
          investmentId,
          data: this.cachedData.get(investmentId),
        });
      }

      logger.info(
        `User ${socket.userId} subscribed to investment ${investmentId}`
      );
      socket.emit("subscribed", { investmentId });
    } catch (error) {
      logger.error(`Subscription error: ${error.message}`, {
        error: error.stack,
        userId: socket.userId,
        investmentId,
      });
      socket.emit("error", {
        message: "Failed to subscribe to investment updates",
      });
    }
  }

  /**
   * Unsubscribe a socket from investment updates
   */
  unsubscribeFromInvestment(socket, { investmentId }) {
    if (this.watchedInvestments.has(investmentId)) {
      this.watchedInvestments.get(investmentId).delete(socket.id);

      // If no more subscribers, stop generating data
      if (this.watchedInvestments.get(investmentId).size === 0) {
        this.stopChartDataGeneration(investmentId);
      }
    }

    // Leave the investment's room
    socket.leave(`investment:${investmentId}`);
    logger.info(
      `User ${socket.userId} unsubscribed from investment ${investmentId}`
    );
    socket.emit("unsubscribed", { investmentId });
  }

  /**
   * Handle socket disconnection
   */
  handleDisconnect(socket) {
    logger.info(`Socket disconnected: ${socket.id}`);

    // Remove from active connections
    if (socket.userId && this.activeConnections.has(socket.userId)) {
      this.activeConnections.get(socket.userId).delete(socket.id);
      if (this.activeConnections.get(socket.userId).size === 0) {
        this.activeConnections.delete(socket.userId);
      }
    }

    // Remove from watched investments
    this.watchedInvestments.forEach((sockets, investmentId) => {
      if (sockets.has(socket.id)) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          this.stopChartDataGeneration(investmentId);
        }
      }
    });
  }

  /**
   * Initialize chart data generation for an investment
   */
  async initializeChartData(investmentId, investment) {
    try {
      // Generate initial chart data
      const initialData = await this.generateChartData(investment);
      this.cachedData.set(investmentId, initialData);

      // Set up interval for updates (every 1 minute)
      const updateInterval = setInterval(() => {
        this.updateChartData(investmentId, investment);
      }, 60 * 1000); // 1 minute

      this.updateIntervals.set(investmentId, updateInterval);

      logger.info(
        `Chart data generation initialized for investment ${investmentId}`
      );
    } catch (error) {
      logger.error(`Failed to initialize chart data: ${error.message}`, {
        error: error.stack,
        investmentId,
      });
    }
  }

  /**
   * Stop chart data generation for an investment
   */
  stopChartDataGeneration(investmentId) {
    if (this.updateIntervals.has(investmentId)) {
      clearInterval(this.updateIntervals.get(investmentId));
      this.updateIntervals.delete(investmentId);
      this.watchedInvestments.delete(investmentId);
      this.cachedData.delete(investmentId);

      logger.info(
        `Chart data generation stopped for investment ${investmentId}`
      );
    }
  }

  /**
   * Generate chart data for an investment
   */
  async generateChartData(investment) {
    // This function should be similar to your client-side generateCandlestickData
    // but optimized for server-side execution

    if (
      !investment?.metadata?.growthSchedule ||
      !investment.metadata.growthSchedule.length
    ) {
      logger.warn("No growth schedule found for investment", {
        investmentId: investment._id,
      });
      return [];
    }

    const { growthSchedule, nextGrowthIndex = 0 } = investment.metadata;
    const currentValue = investment.currentValue;
    const previousValue = investment.previousValue || investment.amount;

    // Generate 30 days of data by default
    const daysToShow = 30;
    const startIndex = Math.max(0, nextGrowthIndex - daysToShow);
    const endIndex = nextGrowthIndex;

    // Get relevant portion of growth schedule
    const relevantGrowth = growthSchedule.slice(startIndex, endIndex);

    // If we don't have enough days in history, pad with estimated data
    if (relevantGrowth.length < daysToShow) {
      // Calculate average daily return from available data
      const avgReturn =
        relevantGrowth.reduce((sum, val) => sum + val, 0) /
        (relevantGrowth.length || 1);

      // Pad with estimated values
      while (relevantGrowth.length < daysToShow) {
        // Add some randomness to earlier days
        const randomFactor = 0.5 + Math.random();
        relevantGrowth.unshift(avgReturn * randomFactor);
      }
    }

    // Work backwards from current value to reconstruct historical daily values
    const dailyValues = [];
    let runningValue = currentValue;

    // Add current day's value
    dailyValues.push(runningValue);

    // Work backwards through growth schedule
    for (let i = relevantGrowth.length - 1; i >= 0; i--) {
      const growthAmount = relevantGrowth[i];
      runningValue -= growthAmount;
      dailyValues.unshift(runningValue);
    }

    // Generate candlestick data with multiple candles per day
    return this.expandToCandlesticks(dailyValues);
  }

  /**
   * Convert daily values to candlestick data with multiple candles per day
   */
  expandToCandlesticks(dailyValues) {
    const result = [];
    const candlesPerDay = 4; // 4 candles per day (6-hour intervals)

    // Generate start date (days ago)
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - dailyValues.length + 1);
    startDate.setHours(0, 0, 0, 0);

    dailyValues.forEach((closeValue, dayIndex) => {
      // Determine date for this day
      const dayDate = new Date(startDate);
      dayDate.setDate(dayDate.getDate() + dayIndex);

      // Generate realistic intraday volatility
      const volatilityFactor = 0.005; // 0.5% volatility
      const volatility = closeValue * volatilityFactor;

      // Previous close becomes today's open
      const open =
        dayIndex === 0
          ? closeValue * (1 - Math.random() * 0.005) // First day needs an open price
          : dailyValues[dayIndex - 1];

      // The day's overall movement from open to close
      const dailyPriceMovement = closeValue - open;

      // Generate multiple candles for this day
      let lastClose = open;
      const hoursPerCandle = 24 / candlesPerDay;

      for (let i = 0; i < candlesPerDay; i++) {
        // Calculate timestamp for this candle
        const candleTime = new Date(dayDate);
        candleTime.setHours(candleTime.getHours() + i * hoursPerCandle);

        // For very last candle of the day, ensure we hit the day's close price
        if (i === candlesPerDay - 1) {
          const candleVolatility = volatility * 0.5;

          result.push({
            timestamp: candleTime.getTime(),
            open: lastClose,
            high:
              Math.max(lastClose, closeValue) +
              Math.random() * candleVolatility,
            low:
              Math.min(lastClose, closeValue) -
              Math.random() * candleVolatility,
            close: closeValue,
          });
        } else {
          // Calculate a portion of the day's movement for this candle
          const movePercent = 0.2 + Math.random() * 0.4; // 20-60% of remaining move
          const remainingMove = closeValue - lastClose;
          const thisMove = remainingMove * movePercent;
          const thisClose = lastClose + thisMove;

          // Determine volatility for this candle
          const candleVolatility = volatility * (0.5 + Math.random() * 0.5);

          // Create the candle
          const candle = {
            timestamp: candleTime.getTime(),
            open: lastClose,
            close: thisClose,
            high:
              Math.max(lastClose, thisClose) + Math.random() * candleVolatility,
            low:
              Math.min(lastClose, thisClose) - Math.random() * candleVolatility,
          };

          result.push(candle);
          lastClose = thisClose;
        }
      }
    });

    return result;
  }

  /**
   * Update chart data and broadcast to subscribers
   */
  async updateChartData(investmentId, investmentData) {
    try {
      // Refresh investment data from database
      const investment = await UserInvestment.findById(investmentId);

      if (!investment || investment.status !== "active") {
        this.stopChartDataGeneration(investmentId);
        return;
      }

      // Get existing data
      let data = this.cachedData.get(investmentId) || [];

      // Generate a new candle
      const lastCandle = data[data.length - 1];
      const lastClose = lastCandle ? lastCandle.close : investment.currentValue;

      // Simulate a realistic price movement
      const volatility = lastClose * 0.002; // 0.2% volatility per update
      const movement = (Math.random() - 0.5) * volatility * 2;
      const newClose = lastClose + movement;

      // Create new candle
      const now = new Date();
      const newCandle = {
        timestamp: now.getTime(),
        open: lastClose,
        close: newClose,
        high: Math.max(lastClose, newClose) + Math.random() * volatility * 0.5,
        low: Math.min(lastClose, newClose) - Math.random() * volatility * 0.5,
      };

      // Add new candle and remove old candles (keep only last 240 candles = 30 days @ 8 candles/day)
      data.push(newCandle);
      if (data.length > 240) {
        data = data.slice(data.length - 240);
      }

      // Update cache
      this.cachedData.set(investmentId, data);

      // Broadcast update to subscribers
      this.io.to(`investment:${investmentId}`).emit("chartData", {
        investmentId,
        data: [newCandle], // Send only the new candle to reduce data transfer
        isUpdate: true,
      });

      logger.debug(`Chart data updated for investment ${investmentId}`, {
        newClose,
        change: movement,
        subscribers: this.watchedInvestments.get(investmentId)?.size || 0,
      });
    } catch (error) {
      logger.error(`Failed to update chart data: ${error.message}`, {
        error: error.stack,
        investmentId,
      });
    }
  }
}

module.exports = ChartDataService;
