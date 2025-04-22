const mongoose = require("mongoose");
const { logger } = require("../config/logger");
const preloadedWalletService = require("../services/preloadedWallet");
const apiResponse = require("../utils/apiResponse");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const walletService = require("../services/walletService");
const waitlistService = require("../services/waitlistService");
const notificationService = require("../services/notificationService");

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
          "Currency parameter is required",
          "MISSING_CURRENCY"
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
        "Search Successful",
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
        "Search Failed",
        "Error searching preloaded wallets",
        "SEARCH_ERROR"
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

      // Validate ID parameter
      if (!preloadedWalletId) {
        return apiResponse.badRequest(
          res,
          "Bad Request",
          "Preloaded wallet ID is required",
          "MISSING_WALLET_ID"
        );
      }

      const preloadedWallet =
        await preloadedWalletService.getPreloadedWalletById(preloadedWalletId);

      logger.info("Preloaded wallet retrieved by ID", {
        preloadedWalletId,
        currency: preloadedWallet.currency,
        requestId: req.id,
      });

      return apiResponse.success(
        res,
        200,
        "Wallet Retrieved",
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
          "Preloaded wallet not found",
          "WALLET_NOT_FOUND"
        );
      }

      return apiResponse.error(
        res,
        500,
        "Retrieval Failed",
        "Error retrieving preloaded wallet",
        "RETRIEVAL_ERROR"
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
        filter: status ? { status } : "none",
        requestId: req.id,
      });

      return apiResponse.success(
        res,
        200,
        "Wallets Retrieved",
        "Preloaded wallets retrieved successfully",
        {
          preloadedWallets: result.results,
          pagination: result.pagination,
        }
      );
    } catch (error) {
      logger.error("Error retrieving all preloaded wallets", {
        filter: req.query.status ? { status: req.query.status } : "none",
        error: error.message,
        stack: error.stack,
        requestId: req.id,
      });

      return apiResponse.error(
        res,
        500,
        "Retrieval Failed",
        "Error retrieving preloaded wallets",
        "LIST_ERROR"
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
          "Missing required fields: currency, address, and image are required",
          "MISSING_REQUIRED_FIELDS"
        );
      }

      const newWallet = await preloadedWalletService.createPreloadedWallet(
        walletData,
        session
      );

      // Create admin notification about new wallet creation
      if (req.user && req.user._id) {
        await notificationService.createNotification(
          req.user._id,
          "New Preloaded Wallet Created",
          `Created a new ${walletData.currency} preloaded wallet successfully.`,
          "system",
          { walletId: newWallet._id, currency: newWallet.currency },
          session
        );
      }

      // Commit the transaction
      await session.commitTransaction();
      session.endSession();

      logger.info("Preloaded wallet created", {
        walletId: newWallet._id,
        currency: newWallet.currency,
        createdBy: req.user?._id || "system",
        requestId: req.id,
      });

      return apiResponse.created(
        res,
        "Wallet Created",
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

      // Handle validation errors or duplicate keys
      if (error.name === "ValidationError") {
        return apiResponse.badRequest(
          res,
          "Validation Error",
          "Invalid wallet data provided",
          "VALIDATION_ERROR",
          error.errors
        );
      }

      // Handle duplicate key errors
      if (error.code === 11000) {
        return apiResponse.conflict(
          res,
          "Conflict",
          "A wallet with this address already exists",
          "DUPLICATE_WALLET"
        );
      }

      return apiResponse.error(
        res,
        500,
        "Creation Failed",
        "Error creating preloaded wallet",
        "CREATION_ERROR"
      );
    }
  },

  /**
   * Update an existing preloaded wallet
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async updatePreloadedWallet(req, res) {
    // Start a MongoDB session for transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { preloadedWalletId } = req.params;
      const updateData = req.body;

      // Validate ID parameter
      if (!preloadedWalletId) {
        await session.abortTransaction();
        session.endSession();

        return apiResponse.badRequest(
          res,
          "Bad Request",
          "Preloaded wallet ID is required",
          "MISSING_WALLET_ID"
        );
      }

      const updatedWallet = await preloadedWalletService.updatePreloadedWallet(
        preloadedWalletId,
        updateData,
        session
      );

      // Create admin notification about wallet update
      if (req.user && req.user._id) {
        await notificationService.createNotification(
          req.user._id,
          "Preloaded Wallet Updated",
          `Updated ${updatedWallet.currency} preloaded wallet successfully.`,
          "system",
          {
            walletId: updatedWallet._id,
            currency: updatedWallet.currency,
            updatedFields: Object.keys(updateData),
          },
          session
        );
      }

      // Commit the transaction
      await session.commitTransaction();
      session.endSession();

      logger.info("Preloaded wallet updated", {
        walletId: preloadedWalletId,
        updatedBy: req.user?._id || "system",
        updates: Object.keys(updateData),
        requestId: req.id,
      });

      return apiResponse.success(
        res,
        200,
        "Wallet Updated",
        "Preloaded wallet updated successfully",
        { preloadedWallet: updatedWallet }
      );
    } catch (error) {
      // Abort transaction in case of error
      await session.abortTransaction();
      session.endSession();

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
          "Preloaded wallet not found",
          "WALLET_NOT_FOUND"
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

      // Handle duplicate key errors for unique fields
      if (error.code === 11000) {
        return apiResponse.conflict(
          res,
          "Conflict",
          "A wallet with these details already exists",
          "DUPLICATE_WALLET"
        );
      }

      return apiResponse.error(
        res,
        500,
        "Update Failed",
        "Error updating preloaded wallet",
        "UPDATE_ERROR"
      );
    }
  },

  /**
   * Delete a preloaded wallet
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async deletePreloadedWallet(req, res) {
    // Start a MongoDB session for transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { preloadedWalletId } = req.params;

      // Validate ID parameter
      if (!preloadedWalletId) {
        await session.abortTransaction();
        session.endSession();

        return apiResponse.badRequest(
          res,
          "Bad Request",
          "Preloaded wallet ID is required",
          "MISSING_WALLET_ID"
        );
      }

      // Get wallet details before deletion for notification
      const walletToDelete =
        await preloadedWalletService.getPreloadedWalletById(
          preloadedWalletId,
          session
        );

      await preloadedWalletService.deletePreloadedWalletWithSession(
        preloadedWalletId,
        session
      );

      // Create admin notification about wallet deletion
      if (req.user && req.user._id) {
        await notificationService.createNotification(
          req.user._id,
          "Preloaded Wallet Deleted",
          `Deleted ${walletToDelete.currency} preloaded wallet successfully.`,
          "system",
          {
            walletId: preloadedWalletId,
            currency: walletToDelete.currency,
          },
          session
        );
      }

      // Commit the transaction
      await session.commitTransaction();
      session.endSession();

      logger.info("Preloaded wallet deleted", {
        walletId: preloadedWalletId,
        currency: walletToDelete.currency,
        deletedBy: req.user?._id || "system",
        requestId: req.id,
      });

      return apiResponse.success(
        res,
        200,
        "Wallet Deleted",
        "Preloaded wallet deleted successfully"
      );
    } catch (error) {
      // Abort transaction in case of error
      await session.abortTransaction();
      session.endSession();

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
          "Preloaded wallet not found",
          "WALLET_NOT_FOUND"
        );
      }

      return apiResponse.error(
        res,
        500,
        "Deletion Failed",
        "Error deleting preloaded wallet",
        "DELETION_ERROR"
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
      const userId = req.user._id;

      // Validate required currency
      if (!currency) {
        await session.abortTransaction();
        session.endSession();

        return apiResponse.badRequest(
          res,
          "Bad Request",
          "Currency parameter is required",
          "MISSING_CURRENCY"
        );
      }

      // Find available preloaded wallet for the specified currency
      const preloadedWallet =
        await preloadedWalletService.findAvailableWalletForCurrency(
          currency.toUpperCase(),
          session
        );

      if (!preloadedWallet) {
        await session.abortTransaction();
        session.endSession();

        return apiResponse.notFound(
          res,
          "Not Found",
          `No available preloaded wallet found for ${currency.toUpperCase()}`,
          "NO_AVAILABLE_WALLET"
        );
      }

      // Generate wallet name (based on existing count)
      const userWallets = await Wallet.find({
        user: userId,
        currency: preloadedWallet.currency,
      });
      const walletName = `${preloadedWallet.currency} Wallet ${String(
        userWallets.length + 1
      ).padStart(2, "0")}`;

      // Create a new wallet for the user
      const newWallet = new Wallet({
        user: userId,
        currency: preloadedWallet.currency,
        address: preloadedWallet.address,
        balance: preloadedWallet.balance || 0,
        ledgerBalance: preloadedWallet.balance || 0,
        name: walletName,
        source: "preloaded",
        sourceWalletId: preloadedWallet._id,
        status: "active",
        image: preloadedWallet.image,
        type: "crypto",
        securitySettings: {
          transferLimit: {
            daily: 5000,
            singleTransaction: 2000,
          },
          requireConfirmation: true,
          twoFactorEnabled: false,
        },
      });

      // Save the new wallet within the transaction
      await newWallet.save({ session });

      // Update the user document to include the new wallet
      await User.findByIdAndUpdate(
        userId,
        { $push: { wallets: newWallet._id } },
        { session, new: true }
      );

      // Delete the preloaded wallet
      await preloadedWalletService.deletePreloadedWalletWithSession(
        preloadedWallet._id,
        session
      );

      // Get updated user wallets and applications
      const userWalletsAfterAssignment = await walletService.getUserWallets(
        userId
      );
      const userWalletApplications =
        await waitlistService.getUserWalletApplications(userId);

      // Create notification for the user
      await notificationService.createNotification(
        userId,
        "New Wallet Assigned",
        `A new ${preloadedWallet.currency} wallet has been assigned to your account.`,
        "system",
        {
          walletId: newWallet._id,
          currency: preloadedWallet.currency,
          address: newWallet.address,
        },
        session
      );

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
        "Wallet Assigned",
        `${preloadedWallet.currency} wallet successfully assigned to your account`,
        {
          wallets: userWalletsAfterAssignment,
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
          "The selected wallet is already assigned to another user",
          "WALLET_ALREADY_ASSIGNED"
        );
      }

      return apiResponse.error(
        res,
        500,
        "Assignment Failed",
        "Failed to assign wallet to user",
        "ASSIGNMENT_ERROR"
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
      const userId = req.user._id;

      // Validate ID parameter
      if (!preloadedWalletId) {
        await session.abortTransaction();
        session.endSession();

        return apiResponse.badRequest(
          res,
          "Bad Request",
          "Preloaded wallet ID is required",
          "MISSING_WALLET_ID"
        );
      }

      // Find the specific preloaded wallet
      const preloadedWallet =
        await preloadedWalletService.getPreloadedWalletById(
          preloadedWalletId,
          session
        );

      // Check if wallet is available
      if (preloadedWallet.status !== "active" || preloadedWallet.assigned) {
        await session.abortTransaction();
        session.endSession();

        return apiResponse.conflict(
          res,
          "Conflict",
          "The selected wallet is not available for assignment",
          "WALLET_UNAVAILABLE"
        );
      }

      // Generate wallet name (based on existing count)
      const userWallets = await Wallet.find({
        user: userId,
        currency: preloadedWallet.currency,
      });
      const walletName = `${preloadedWallet.currency} Wallet ${String(
        userWallets.length + 1
      ).padStart(2, "0")}`;

      // Create a new wallet for the user
      const newWallet = new Wallet({
        user: userId,
        currency: preloadedWallet.currency,
        address: preloadedWallet.address,
        balance: preloadedWallet.balance || 0,
        ledgerBalance: preloadedWallet.balance || 0,
        name: walletName,
        source: "preloaded",
        sourceWalletId: preloadedWallet._id,
        status: "active",
        image: preloadedWallet.image,
        type: "crypto",
        securitySettings: {
          transferLimit: {
            daily: 5000,
            singleTransaction: 2000,
          },
          requireConfirmation: true,
          twoFactorEnabled: false,
        },
      });

      // Save the new wallet within the transaction
      await newWallet.save({ session });

      // Update the user document to include the new wallet
      await User.findByIdAndUpdate(
        userId,
        { $push: { wallets: newWallet._id } },
        { session, new: true }
      );

      // Delete the preloaded wallet
      await preloadedWalletService.deletePreloadedWalletWithSession(
        preloadedWallet._id,
        session
      );

      // Get updated user wallets and applications
      const userWalletsAfterAssignment = await walletService.getUserWallets(
        userId
      );
      const userWalletApplications =
        await waitlistService.getUserWalletApplications(userId);

      // Create notification for the user
      await notificationService.createNotification(
        userId,
        "New Wallet Assigned",
        `A new ${preloadedWallet.currency} wallet has been assigned to your account.`,
        "system",
        {
          walletId: newWallet._id,
          currency: preloadedWallet.currency,
          address: newWallet.address,
        },
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
        "Wallet Assigned",
        `${preloadedWallet.currency} wallet successfully assigned to your account`,
        {
          wallet: {
            _id: newWallet._id,
            currency: newWallet.currency,
            name: newWallet.name,
            address: newWallet.address,
            balance: newWallet.balance,
            status: newWallet.status,
            image: newWallet.image,
          },
          wallets: userWalletsAfterAssignment,
          pendingWallets: userWalletApplications,
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
          "Preloaded wallet not found",
          "WALLET_NOT_FOUND"
        );
      }

      if (error.message === "Preloaded wallet already in use") {
        return apiResponse.conflict(
          res,
          "Conflict",
          "The selected wallet is already assigned to another user",
          "WALLET_ALREADY_ASSIGNED"
        );
      }

      return apiResponse.error(
        res,
        500,
        "Assignment Failed",
        "Failed to assign wallet to user",
        "ASSIGNMENT_ERROR"
      );
    }
  },
};

module.exports = preloadedWalletController;
