const mongoose = require("mongoose");
const { logger } = require("../config/logger");
const preloadedWalletService = require("../services/preloadedWallet");
const apiResponse = require("../utils/apiResponse");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const walletService = require("../services/walletService");
const waitlistService = require("../services/waitlistService");

/**
 * PreloadedWallet controller for handling preloaded wallet operations
 */
const preloadedWalletController = {
  /**
   * Search preloaded wallets by currency
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async searchByCurrency(req, res) {
    try {
      const { currency } = req.query;
      const { limit = 20, page = 1 } = req.query;

      // Validate currency parameter
      if (!currency) {
        return apiResponse.badRequest(
          res,
          "Bad Request",
          "Currency parameter is required"
        );
      }

      const result = await preloadedWalletService.searchByCurrencyOrName(
        currency,
        page,
        limit
      );

      logger.info("Preloaded wallets searched by currency", {
        currency,
        count: result.results.length,
        totalCount: result.pagination.total,
        requestId: req.id,
      });

      return apiResponse.success(
        res,
        200,
        "Success",
        "Preloaded wallets retrieved successfully",
        {
          preloadedWallets: result.results,
          pagination: result.pagination,
        }
      );
    } catch (error) {
      logger.error("Error searching preloaded wallets by currency", {
        currency: req.query.currency,
        error: error.message,
        stack: error.stack,
        requestId: req.id,
      });

      return apiResponse.error(
        res,
        500,
        "Error",
        "Error searching preloaded wallets"
      );
    }
  },

  /**
   * Get preloaded wallet by ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getPreloadedWalletById(req, res) {
    try {
      const { preloadedWalletId } = req.params;

      const preloadedWallet =
        await preloadedWalletService.getPreloadedWalletById(preloadedWalletId);

      return apiResponse.success(
        res,
        200,
        "Success",
        "Preloaded wallet retrieved successfully",
        {
          preloadedWallet,
        }
      );
    } catch (error) {
      logger.error("Error getting preloaded wallet by ID", {
        preloadedWalletId: req.params.preloadedWalletId,
        error: error.message,
        stack: error.stack,
        requestId: req.id,
      });

      if (error.message === "Preloaded wallet not found") {
        return apiResponse.notFound(
          res,
          "Not Found",
          "Preloaded wallet not found"
        );
      }

      return apiResponse.error(
        res,
        500,
        "Error",
        "Error retrieving preloaded wallet"
      );
    }
  },

  /**
   * Get all available preloaded wallets
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getAllPreloadedWallets(req, res) {
    try {
      const { limit = 20, page = 1, status } = req.query;

      // Build filter for status if provided
      const filter = {};
      if (status) filter.status = status;

      const result = await preloadedWalletService.getAllPreloadedWallets(
        filter,
        page,
        limit
      );

      logger.info("All preloaded wallets retrieved", {
        count: result.results.length,
        totalCount: result.pagination.total,
        requestId: req.id,
      });

      return apiResponse.success(
        res,
        200,
        "Success",
        "Preloaded wallets retrieved successfully",
        {
          preloadedWallets: result.results,
          pagination: result.pagination,
        }
      );
    } catch (error) {
      logger.error("Error retrieving all preloaded wallets", {
        error: error.message,
        stack: error.stack,
        requestId: req.id,
      });

      return apiResponse.error(
        res,
        500,
        "Error",
        "Error retrieving preloaded wallets"
      );
    }
  },

  /**
   * Create a new preloaded wallet
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async createPreloadedWallet(req, res) {
    // Start a MongoDB session for transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const walletData = req.body;

      // Validate required fields
      if (!walletData.currency || !walletData.address || !walletData.image) {
        return apiResponse.badRequest(
          res,
          "Bad Request",
          "Missing Requirements"
        );
      }

      const newWallet = await preloadedWalletService.createPreloadedWallet(
        walletData,
        session
      );

      // Commit the transaction
      await session.commitTransaction();
      session.endSession();

      logger.info("Preloaded wallet created", {
        walletId: newWallet.id,
        currency: newWallet.currency,
        requestId: req.id,
      });

      return apiResponse.created(
        res,
        "Created",
        "Preloaded wallet created successfully",
        { preloadedWallet: newWallet }
      );
    } catch (error) {
      // Abort transaction in case of error
      await session.abortTransaction();
      session.endSession();

      logger.error("Error creating preloaded wallet", {
        error: error.message,
        stack: error.stack,
        requestId: req.id,
      });

      // Handle validation errors or duplicate keys if applicable
      if (error.name === "ValidationError") {
        return apiResponse.badRequest(
          res,
          "Validation Error",
          "Invalid wallet data provided",
          "VALIDATION_ERROR",
          error.errors
        );
      }

      return apiResponse.error(
        res,
        500,
        "Error",
        "Error creating preloaded wallet"
      );
    }
  },

  /**
   * Update an existing preloaded wallet
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async updatePreloadedWallet(req, res) {
    try {
      const { preloadedWalletId } = req.params;
      const updateData = req.body;

      const updatedWallet = await preloadedWalletService.updatePreloadedWallet(
        preloadedWalletId,
        updateData
      );

      logger.info("Preloaded wallet updated", {
        walletId: preloadedWalletId,
        updates: Object.keys(updateData),
        requestId: req.id,
      });

      return apiResponse.updated(
        res,
        "Updated",
        "Preloaded wallet updated successfully",
        { preloadedWallet: updatedWallet }
      );
    } catch (error) {
      logger.error("Error updating preloaded wallet", {
        preloadedWalletId: req.params.preloadedWalletId,
        error: error.message,
        stack: error.stack,
        requestId: req.id,
      });

      if (error.message === "Preloaded wallet not found") {
        return apiResponse.notFound(
          res,
          "Not Found",
          "Preloaded wallet not found"
        );
      }

      if (error.name === "ValidationError") {
        return apiResponse.badRequest(
          res,
          "Validation Error",
          "Invalid wallet data provided",
          "VALIDATION_ERROR",
          error.errors
        );
      }

      return apiResponse.error(
        res,
        500,
        "Error",
        "Error updating preloaded wallet"
      );
    }
  },

  /**
   * Delete a preloaded wallet
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async deletePreloadedWallet(req, res) {
    try {
      const { preloadedWalletId } = req.params;

      await preloadedWalletService.deletePreloadedWallet(preloadedWalletId);

      logger.info("Preloaded wallet deleted", {
        walletId: preloadedWalletId,
        requestId: req.id,
      });

      return apiResponse.deleted(
        res,
        "Deleted",
        "Preloaded wallet deleted successfully"
      );
    } catch (error) {
      logger.error("Error deleting preloaded wallet", {
        preloadedWalletId: req.params.preloadedWalletId,
        error: error.message,
        stack: error.stack,
        requestId: req.id,
      });

      if (error.message === "Preloaded wallet not found") {
        return apiResponse.notFound(
          res,
          "Not Found",
          "Preloaded wallet not found"
        );
      }

      return apiResponse.error(
        res,
        500,
        "Error",
        "Error deleting preloaded wallet"
      );
    }
  },

  /**
   * Assign a preloaded wallet to the authenticated user
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async assignWalletToSelf(req, res) {
    // Start a MongoDB session for transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { currency } = req.body;
      const userId = req.user._id; // Assuming user is attached to req by auth middleware

      // Validate required currency
      if (!currency) {
        return apiResponse.badRequest(
          res,
          "Bad Request",
          "Currency parameter is required"
        );
      }

      // Find available preloaded wallet for the specified currency
      const preloadedWallet =
        await preloadedWalletService.findAvailableWalletForCurrency(
          currency.toUpperCase(),
          session
        );

      if (!preloadedWallet) {
        return apiResponse.notFound(
          res,
          "Not Found",
          `No available preloaded wallet found for ${currency.toUpperCase()}`
        );
      }

      // Create a new wallet for the user
      const newWallet = new Wallet({
        user: userId,
        currency: preloadedWallet.currency,
        address: preloadedWallet.address,
        balance: preloadedWallet.balance || 0,
        source: "preloaded",
        sourceWalletId: preloadedWallet._id,
        status: "active",
        image: preloadedWallet.image,
      });

      // Save the new wallet within the transaction
      await newWallet.save({ session });

      // Update the user document to include the new wallet
      await User.findByIdAndUpdate(
        userId,
        { $push: { wallets: newWallet._id } },
        { session, new: true }
      );

      // Delete the preloaded wallet instead of marking it as used
      await preloadedWalletService.deletePreloadedWalletWithSession(
        preloadedWallet._id,
        session
      );

      const userWallets = await walletService.getUserWallets(req.user._id);
      const userWalletApplications = await waitlistService.getUserWalletApplications(req.user._id);

      // Commit the transaction
      await session.commitTransaction();
      session.endSession();

      logger.info("Preloaded wallet assigned to user and deleted", {
        userId,
        walletId: newWallet._id,
        preloadedWalletId: preloadedWallet._id,
        currency: preloadedWallet.currency,
        requestId: req.id,
      });

      return apiResponse.success(
        res,
        200,
        "Success",
        "Wallet successfully assigned",
        {
          // wallet: {
          //   _id: newWallet._id,
          //   currency: newWallet.currency,
          //   address: newWallet.address,
          //   balance: newWallet.balance,
          //   status: newWallet.status,
          //   image: newWallet.image,
          // },
          wallets: userWallets,
          pendingWallets: userWalletApplications,
        }
      );
    } catch (error) {
      // Abort transaction in case of error
      await session.abortTransaction();
      session.endSession();

      logger.error("Error assigning wallet to user", {
        userId: req.user?._id,
        currency: req.body?.currency,
        error: error.message,
        stack: error.stack,
        requestId: req.id,
      });

      if (error.message === "Preloaded wallet already in use") {
        return apiResponse.conflict(
          res,
          "Conflict",
          "The selected wallet is already assigned to another user"
        );
      }

      return apiResponse.error(
        res,
        500,
        "Error",
        "Failed to assign wallet to user"
      );
    }
  },

  /**
   * Assign a specific preloaded wallet to the authenticated user
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async assignSpecificWalletToSelf(req, res) {
    // Start a MongoDB session for transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { preloadedWalletId } = req.params;
      const userId = req.user._id; // Assuming user is attached to req by auth middleware

      // Find the specific preloaded wallet
      const preloadedWallet =
        await preloadedWalletService.getPreloadedWalletById(
          preloadedWalletId,
          session
        );

      // Check if wallet is available
      if (preloadedWallet.status !== "active" || preloadedWallet.assigned) {
        return apiResponse.conflict(
          res,
          "Conflict",
          "The selected wallet is not available for assignment"
        );
      }

      // Create a new wallet for the user
      const newWallet = new Wallet({
        user: userId,
        currency: preloadedWallet.currency,
        address: preloadedWallet.address,
        balance: preloadedWallet.balance || 0,
        source: "preloaded",
        sourceWalletId: preloadedWallet._id,
        status: "active",
        image: preloadedWallet.image,
      });

      // Save the new wallet within the transaction
      await newWallet.save({ session });

      // Update the user document to include the new wallet
      await User.findByIdAndUpdate(
        userId,
        { $push: { wallets: newWallet._id } },
        { session, new: true }
      );

      // Delete the preloaded wallet instead of marking it as used
      await preloadedWalletService.deletePreloadedWalletWithSession(
        preloadedWallet._id,
        session
      );

      // Commit the transaction
      await session.commitTransaction();
      session.endSession();

      logger.info("Specific preloaded wallet assigned to user and deleted", {
        userId,
        walletId: newWallet._id,
        preloadedWalletId: preloadedWallet._id,
        currency: preloadedWallet.currency,
        requestId: req.id,
      });

      return apiResponse.success(
        res,
        200,
        "Success",
        "Wallet successfully assigned",
        {
          wallet: {
            _id: newWallet._id,
            currency: newWallet.currency,
            address: newWallet.address,
            balance: newWallet.balance,
            status: newWallet.status,
            image: newWallet.image,
          },
        }
      );
    } catch (error) {
      // Abort transaction in case of error
      await session.abortTransaction();
      session.endSession();

      logger.error("Error assigning specific wallet to user", {
        userId: req.user?._id,
        preloadedWalletId: req.params?.preloadedWalletId,
        error: error.message,
        stack: error.stack,
        requestId: req.id,
      });

      if (error.message === "Preloaded wallet not found") {
        return apiResponse.notFound(
          res,
          "Not Found",
          "Preloaded wallet not found"
        );
      }

      if (error.message === "Preloaded wallet already in use") {
        return apiResponse.conflict(
          res,
          "Conflict",
          "The selected wallet is already assigned to another user"
        );
      }

      return apiResponse.error(
        res,
        500,
        "Error",
        "Failed to assign wallet to user"
      );
    }
  },
};

module.exports = preloadedWalletController;
