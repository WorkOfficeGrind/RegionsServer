const mongoose = require("mongoose");
const Wallet = require("../models/Wallet");
const User = require("../models/User");
const { logger } = require("../config/logger");
const crypto = require("crypto");

/**
 * Generate realistic crypto wallet address based on cryptocurrency
 * @param {string} currency - Cryptocurrency type (BTC, ETH, etc.)
 * @returns {string} - Crypto wallet address
 */
const generateWalletAddress = (currency) => {
  // Generate different formats based on cryptocurrency
  switch (currency) {
    case "BTC":
      // Bitcoin address format (P2PKH) - starts with 1 or 3, 26-35 alphanumeric chars
      const btcPrefix = Math.random() < 0.5 ? "1" : "3";
      return (
        btcPrefix + crypto.randomBytes(20).toString("hex").substring(0, 32)
      );

    case "ETH":
      // Ethereum address - 0x followed by 40 hex chars
      return "0x" + crypto.randomBytes(20).toString("hex");

    case "SOL":
      // Solana address - base58 encoded 32 bytes
      return crypto.randomBytes(32).toString("hex");

    case "XRP":
      // Ripple address - starts with r, ~25-35 chars
      return (
        "r" +
        crypto
          .randomBytes(20)
          .toString("base64")
          .replace(/[+/=]/g, "")
          .substring(0, 30)
      );

    case "ADA":
      // Cardano address - starts with addr, then ~100 chars
      return "addr1" + crypto.randomBytes(40).toString("hex");

    case "USDT":
      // USDT (on Ethereum) - 0x followed by 40 hex chars
      return "0x" + crypto.randomBytes(20).toString("hex");

    case "DOGE":
      // Dogecoin address - starts with D, ~34 chars
      return "D" + crypto.randomBytes(20).toString("hex").substring(0, 33);

    default:
      // Generic format
      return "0x" + crypto.randomBytes(20).toString("hex");
  }
};

/**
 * Generate wallet name based on existing user wallets count
 * @param {string} userId - User ID
 * @returns {Promise<string>} - Wallet name in format "Wallet XX"
 */
const generateWalletName = async (userId) => {
  try {
    // Get count of existing wallets for the user
    const walletCount = await Wallet.countDocuments({ user: userId });

    // Generate a wallet name in the format "Wallet 01", "Wallet 02", etc.
    return `Wallet ${String(walletCount + 1).padStart(2, "0")}`;
  } catch (error) {
    logger.error("Error generating wallet name", {
      userId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

const walletService = {
  /**
   * Create a new wallet for a user
   * @param {Object} walletData - Wallet creation data
   * @param {string} walletData.userId - User ID
   * @param {string} walletData.currency - Currency (default: BTC)
   * @param {string} walletData.address - Custom wallet address (optional)
   * @param {string} walletData.name - Custom wallet name (optional)
   * @returns {Promise<Object>} - Created wallet
   */
  async createWallet(walletData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { userId, currency = "BTC", address, name } = walletData;

      // Check if user exists
      const user = await User.findById(userId);
      if (!user) {
        throw new Error("User not found");
      }

      // Generate wallet name if not provided
      const walletName = name || (await generateWalletName(userId));

      // Generate wallet address if not provided
      const walletAddress = address || generateWalletAddress(currency);

      // Create wallet
      const wallet = new Wallet({
        user: userId,
        address: walletAddress,
        currency: currency.toUpperCase(),
        balance: 0,
        ledgerBalance: 0,
        name: walletName,
        status: "active",
        type: "crypto",
        isDefault: false, // Only first wallet is default
        securitySettings: {
          transferLimit: {
            daily: 5000,
            singleTransaction: 2000,
          },
          requireConfirmation: true,
          twoFactorEnabled: false,
        },
      });

      await wallet.save({ session });

      // Update user's wallets array
      user.wallets.push(wallet._id);
      await user.save({ session });

      await session.commitTransaction();
      session.endSession();

      logger.info("New wallet created", {
        userId,
        walletId: wallet._id,
        currency,
        walletName,
      });

      return wallet;
    } catch (error) {
      await session.abortTransaction();
      session.endSession();

      logger.error("Error creating wallet", {
        userId: walletData.userId,
        currency: walletData.currency,
        error: error.message,
        stack: error.stack,
      });

      throw error;
    }
  },

  /**
   * Get a wallet by ID
   * @param {string} walletId - Wallet ID
   * @param {string} userId - User ID (for authorization)
   * @returns {Promise<Object>} - Wallet
   */
  async getWalletById(walletId, userId) {
    try {
      const wallet = await Wallet.findOne({ _id: walletId, user: userId });

      if (!wallet) {
        throw new Error("Wallet not found");
      }

      return wallet;
    } catch (error) {
      logger.error("Error getting wallet by ID", {
        walletId,
        userId,
        error: error.message,
        stack: error.stack,
      });

      throw error;
    }
  },

  /**
   * Get all wallets for a user
   * @param {string} userId - User ID
   * @returns {Promise<Array>} - User's wallets
   */
  async getUserWallets(userId) {
    try {
      const wallets = await Wallet.find({ user: userId }).sort({
        isDefault: -1,
        createdAt: 1,
      });

      return wallets;
    } catch (error) {
      logger.error("Error getting user wallets", {
        userId,
        error: error.message,
        stack: error.stack,
      });

      throw error;
    }
  },

  /**
   * Search  wallets by currency
   * @param {String} currency - Currency to search for
   * @param {Number} page - Page number for pagination
   * @param {Number} limit - Number of items per page
   * @returns {Object} - Results and pagination info
   */
  async searchByCurrency(currency, page, limit) {
    // Convert string parameters to numbers
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    // Calculate skip value for pagination
    const skip = (pageNum - 1) * limitNum;

    // Create case-insensitive search
    const query = { currency: new RegExp(currency, "i") };

    // Execute query with pagination
    const results = await Wallet.find(query)
      .skip(skip)
      .limit(limitNum)
      .sort({ createdAt: -1 });

    // Get total count for pagination
    const total = await Wallet.countDocuments(query);

    return {
      results,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    };
  },

  /**
   * Update wallet details
   * @param {string} walletId - Wallet ID
   * @param {string} userId - User ID (for authorization)
   * @param {Object} updateData - Fields to update
   * @returns {Promise<Object>} - Updated wallet
   */
  async updateWallet(walletId, userId, updateData) {
    try {
      // Only allow specific fields to be updated by regular users
      const allowedFields = ["name", "securitySettings"];

      const updateObj = {};
      for (const field of allowedFields) {
        if (updateData[field] !== undefined) {
          updateObj[field] = updateData[field];
        }
      }

      const wallet = await Wallet.findOneAndUpdate(
        { _id: walletId, user: userId },
        { $set: updateObj },
        { new: true, runValidators: true }
      );

      if (!wallet) {
        throw new Error("Wallet not found");
      }

      logger.info("Wallet updated", {
        walletId,
        userId,
        updatedFields: Object.keys(updateObj),
      });

      return wallet;
    } catch (error) {
      logger.error("Error updating wallet", {
        walletId,
        userId,
        updateData,
        error: error.message,
        stack: error.stack,
      });

      throw error;
    }
  },

  /**
   * Set a wallet as default
   * @param {string} walletId - Wallet ID
   * @param {string} userId - User ID (for authorization)
   * @returns {Promise<Object>} - Updated wallet
   */
  async setDefaultWallet(walletId, userId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // First, unset any existing default wallet
      await Wallet.updateMany(
        { user: userId, isDefault: true },
        { $set: { isDefault: false } },
        { session }
      );

      // Then set the new default wallet
      const wallet = await Wallet.findOneAndUpdate(
        { _id: walletId, user: userId },
        { $set: { isDefault: true } },
        { new: true, session }
      );

      if (!wallet) {
        throw new Error("Wallet not found");
      }

      await session.commitTransaction();
      session.endSession();

      logger.info("Default wallet changed", {
        walletId,
        userId,
      });

      return wallet;
    } catch (error) {
      await session.abortTransaction();
      session.endSession();

      logger.error("Error setting default wallet", {
        walletId,
        userId,
        error: error.message,
        stack: error.stack,
      });

      throw error;
    }
  },
};

module.exports = walletService;
