const PreloadedWallet = require("../models/PreloadedWallet");
const { logger } = require("../config/logger");

/**
 * Service for handling preloaded wallet operations
 */
const preloadedWalletService = {
  /**
   * Search preloaded wallets by currency
   * @param {String} currency - Currency to search for
   * @param {Number} page - Page number for pagination
   * @param {Number} limit - Number of items per page
   * @returns {Object} - Results and pagination info
   */
  // async searchByCurrency(currency, page, limit) {
  //   // Convert string parameters to numbers
  //   const pageNum = parseInt(page, 10);
  //   const limitNum = parseInt(limit, 10);

  //   // Calculate skip value for pagination
  //   const skip = (pageNum - 1) * limitNum;

  //   // Create case-insensitive search
  //   const query = { currency: new RegExp(currency, "i") };

  //   // Execute query with pagination
  //   const results = await PreloadedWallet.find(query)
  //     .skip(skip)
  //     .limit(limitNum)
  //     .sort({ createdAt: -1 });

  //   // Get total count for pagination
  //   const total = await PreloadedWallet.countDocuments(query);

  //   return {
  //     results,
  //     pagination: {
  //       page: pageNum,
  //       limit: limitNum,
  //       total,
  //       pages: Math.ceil(total / limitNum),
  //     },
  //   };
  // },

  async searchByCurrencyOrName(searchTerm, page, limit) {
    // Convert string parameters to numbers
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    // Calculate skip value for pagination
    const skip = (pageNum - 1) * limitNum;

    // Create a case-insensitive search query for both 'currency' and 'name' fields
    const query = {
      $or: [
        { currency: new RegExp(searchTerm, "i") },
        { name: new RegExp(searchTerm, "i") },
      ],
    };

    // Execute query with pagination
    const results = await PreloadedWallet.find(query)
      .skip(skip)
      .limit(limitNum)
      .sort({ createdAt: -1 });

    // Get total count for pagination
    const total = await PreloadedWallet.countDocuments(query);

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
   * Get preloaded wallet by ID
   * @param {String} preloadedWalletId - ID of the preloaded wallet
   * @returns {Object} - Preloaded wallet document
   */
  async getPreloadedWalletById(preloadedWalletId) {
    const preloadedWallet = await PreloadedWallet.findById(preloadedWalletId);

    if (!preloadedWallet) {
      throw new Error("Preloaded wallet not found");
    }

    return preloadedWallet;
  },

  /**
   * Get all preloaded wallets with optional filtering
   * @param {Object} filter - Filter criteria
   * @param {Number} page - Page number for pagination
   * @param {Number} limit - Number of items per page
   * @returns {Object} - Results and pagination info
   */
  async getAllPreloadedWallets(filter = {}, page, limit) {
    // Convert string parameters to numbers
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    // Calculate skip value for pagination
    const skip = (pageNum - 1) * limitNum;

    // Execute query with pagination
    const results = await PreloadedWallet.find(filter)
      .skip(skip)
      .limit(limitNum)
      .sort({ createdAt: -1 });

    // Get total count for pagination
    const total = await PreloadedWallet.countDocuments(filter);

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
   * Create a new preloaded wallet
   * @param {Object} walletData - Data for the new preloaded wallet
   * @returns {Object} - Created preloaded wallet
   */
  async createPreloadedWallet(walletData) {
    const preloadedWallet = new PreloadedWallet(walletData);
    await preloadedWallet.save();

    logger.info("New preloaded wallet created", {
      preloadedWalletId: preloadedWallet._id,
      currency: preloadedWallet.currency,
    });

    return preloadedWallet;
  },

  /**
   * Update a preloaded wallet using atomic operations
   * @param {String} preloadedWalletId - ID of the preloaded wallet to update
   * @param {Object} updateData - Data to update
   * @returns {Object} - Updated preloaded wallet
   */
  async updatePreloadedWallet(preloadedWalletId, updateData) {
    // Use findOneAndUpdate with { new: true } to get the updated document
    const preloadedWallet = await PreloadedWallet.findOneAndUpdate(
      { _id: preloadedWalletId },
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!preloadedWallet) {
      throw new Error("Preloaded wallet not found");
    }

    logger.info("Preloaded wallet updated", {
      preloadedWalletId,
      updatedFields: Object.keys(updateData).filter(
        (k) => updateData[k] !== undefined
      ),
    });

    return preloadedWallet;
  },

  /**
   * Delete a preloaded wallet
   * @param {String} preloadedWalletId - ID of the preloaded wallet to delete
   * @returns {Boolean} - True if deleted successfully
   */
  async deletePreloadedWallet(preloadedWalletId) {
    const result = await PreloadedWallet.deleteOne({ _id: preloadedWalletId });

    if (result.deletedCount === 0) {
      throw new Error("Preloaded wallet not found");
    }

    return true;
  },

  // Add these new methods to your existing preloadedWalletService

  /**
   * Find an available preloaded wallet for a specific currency
   * @param {String} currency - Currency to search for
   * @param {Object} session - Mongoose session for transaction
   * @returns {Object} - Available preloaded wallet or null
   */
  async findAvailableWalletForCurrency(currency, session = null) {
    const options = session ? { session } : {};

    // Find an available wallet that is active and not assigned
    const preloadedWallet = await PreloadedWallet.findOne(
      {
        currency: currency.toUpperCase(),
        status: "active",
        assigned: false,
      },
      null,
      options
    );

    if (!preloadedWallet) {
      logger.warn("No available preloaded wallet found", {
        currency: currency.toUpperCase(),
      });
      return null;
    }

    return preloadedWallet;
  },

  /**
   * Mark a preloaded wallet as used with atomic operation within a transaction
   * @param {String} preloadedWalletId - ID of the preloaded wallet
   * @param {String} userId - ID of the user who is using the wallet
   * @param {String} walletId - ID of the user's new wallet
   * @param {Object} session - Mongoose session for transaction
   * @returns {Object} - Updated preloaded wallet
   */
  async markAsUsed(preloadedWalletId, userId, walletId, session = null) {
    const options = session
      ? { session, new: true, runValidators: true }
      : { new: true, runValidators: true };

    // Use findOneAndUpdate with conditions to ensure atomicity
    const preloadedWallet = await PreloadedWallet.findOneAndUpdate(
      {
        _id: preloadedWalletId,
        status: "active", // Only update if active
        assigned: false, // Only update if not already assigned
      },
      {
        $set: {
          status: "assigned",
          assigned: true,
          assignedToUser: userId,
          assignedWallet: walletId,
          assignedAt: new Date(),
        },
      },
      options
    );

    if (!preloadedWallet) {
      // Check if wallet exists but is already used
      const existingWallet = await PreloadedWallet.findById(
        preloadedWalletId,
        null,
        { session }
      );

      if (!existingWallet) {
        throw new Error("Preloaded wallet not found");
      }

      if (existingWallet.assigned || existingWallet.status !== "active") {
        throw new Error("Preloaded wallet already in use");
      }

      // Should not reach here if our conditions are correct
      throw new Error("Failed to mark wallet as used");
    }

    logger.info("Preloaded wallet marked as used", {
      preloadedWalletId,
      userId,
      walletId,
    });

    return preloadedWallet;
  },

  /**
   * Get preloaded wallet by ID with session support for transactions
   * @param {String} preloadedWalletId - ID of the preloaded wallet
   * @param {Object} session - Mongoose session for transaction
   * @returns {Object} - Preloaded wallet document
   */
  async getPreloadedWalletById(preloadedWalletId, session = null) {
    const options = session ? { session } : {};

    const preloadedWallet = await PreloadedWallet.findById(
      preloadedWalletId,
      null,
      options
    );

    if (!preloadedWallet) {
      throw new Error("Preloaded wallet not found");
    }

    return preloadedWallet;
  },

  /**
   * Delete a preloaded wallet with a session
   * @param {string} preloadedWalletId - The ID of the preloaded wallet to delete
   * @param {Object} session - MongoDB session for transaction
   * @returns {Promise<void>}
   */
  async deletePreloadedWalletWithSession(preloadedWalletId, session) {
    const result = await PreloadedWallet.deleteOne(
      { _id: preloadedWalletId },
      { session }
    );

    if (result.deletedCount === 0) {
      throw new Error("Preloaded wallet not found");
    }

    return result;
  },
};

module.exports = preloadedWalletService;
