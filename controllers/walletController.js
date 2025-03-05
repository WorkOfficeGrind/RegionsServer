const walletService = require("../services/walletService");
const transactionService = require("../services/transactionService");
const { logger } = require("../config/logger");
const apiResponse = require("../utils/apiResponse");

/**
 * Wallet controller for handling wallet operations
 */
const walletController = {
  /**
   * Get all wallets for the authenticated user
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getUserWallets(req, res) {
    try {
      const userId = req.user._id;

      const wallets = await walletService.getUserWallets(userId);

      logger.info("Retrieved user wallets", {
        userId,
        count: wallets.length,
        requestId: req.id,
      });

      return apiResponse.success(res, 200, "Wallets retrieved successfully", {
        wallets,
      });
    } catch (error) {
      logger.error("Error getting user wallets", {
        userId: req.user._id,
        error: error.message,
        stack: error.stack,
        requestId: req.id,
      });

      return apiResponse.error(res, 500, "Error retrieving wallets");
    }
  },

  /**
   * Get wallet by ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getWalletById(req, res) {
    try {
      const userId = req.user._id;
      const { walletId } = req.params;

      const wallet = await walletService.getWalletById(walletId, userId);

      return apiResponse.success(res, 200, "Wallet retrieved successfully", {
        wallet,
      });
    } catch (error) {
      logger.error("Error getting wallet by ID", {
        userId: req.user._id,
        walletId: req.params.walletId,
        error: error.message,
        stack: error.stack,
        requestId: req.id,
      });

      if (error.message === "Wallet not found") {
        return apiResponse.notFound(res, "Wallet not found");
      }

      return apiResponse.error(res, 500, "Error retrieving wallet");
    }
  },

  /**
   * Create a new wallet
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async createWallet(req, res) {
    try {
      const userId = req.user._id;
      const { currency, address, name } = req.body;

      const wallet = await walletService.createWallet({
        userId,
        currency,
        address,
        name,
      });

      logger.info("New wallet created", {
        userId,
        walletId: wallet._id,
        currency: wallet.currency,
        requestId: req.id,
      });

      return apiResponse.created(res, "Wallet created successfully", {
        wallet,
      });
    } catch (error) {
      logger.error("Error creating wallet", {
        userId: req.user._id,
        data: req.body,
        error: error.message,
        stack: error.stack,
        requestId: req.id,
      });

      if (error.message === "User not found") {
        return apiResponse.notFound(res, "User not found");
      }

      return apiResponse.error(res, 500, "Error creating wallet");
    }
  },

  /**
   * Update wallet (limited fields for regular users)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async updateWallet(req, res) {
    try {
      const userId = req.user._id;
      const { walletId } = req.params;
      const updateData = req.body;

      // Regular users can only update name and securitySettings
      const allowedFields = {
        name: updateData.name,
        securitySettings: updateData.securitySettings,
      };

      const wallet = await walletService.updateWallet(
        walletId,
        userId,
        allowedFields
      );

      logger.info("Wallet updated", {
        userId,
        walletId,
        updatedFields: Object.keys(allowedFields).filter(
          (k) => allowedFields[k] !== undefined
        ),
        requestId: req.id,
      });

      return apiResponse.success(res, 200, "Wallet updated successfully", {
        wallet,
      });
    } catch (error) {
      logger.error("Error updating wallet", {
        userId: req.user._id,
        walletId: req.params.walletId,
        data: req.body,
        error: error.message,
        stack: error.stack,
        requestId: req.id,
      });

      if (error.message === "Wallet not found") {
        return apiResponse.notFound(res, "Wallet not found");
      }

      return apiResponse.error(res, 500, "Error updating wallet");
    }
  },

  /**
   * Set wallet as default
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async setDefaultWallet(req, res) {
    try {
      const userId = req.user._id;
      const { walletId } = req.params;

      const wallet = await walletService.setDefaultWallet(walletId, userId);

      logger.info("Default wallet updated", {
        userId,
        walletId,
        requestId: req.id,
      });

      return apiResponse.success(
        res,
        200,
        "Default wallet updated successfully",
        { wallet }
      );
    } catch (error) {
      logger.error("Error setting default wallet", {
        userId: req.user._id,
        walletId: req.params.walletId,
        error: error.message,
        stack: error.stack,
        requestId: req.id,
      });

      if (error.message === "Wallet not found") {
        return apiResponse.notFound(res, "Wallet not found");
      }

      return apiResponse.error(res, 500, "Error setting default wallet");
    }
  },

  /**
   * Admin update wallet (all fields)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async adminUpdateWallet(req, res) {
    try {
      const { walletId } = req.params;
      const userId = req.user._id;

      // For admin updates, we allow updating any field provided
      const wallet = await walletService.adminUpdateWallet(
        walletId,
        userId,
        req.body
      );

      logger.info("Admin wallet update", {
        adminId: userId,
        walletId,
        updatedFields: Object.keys(req.body),
        requestId: req.id,
      });

      return apiResponse.success(res, 200, "Wallet updated successfully", {
        wallet,
      });
    } catch (error) {
      logger.error("Error in admin wallet update", {
        adminId: req.user._id,
        walletId: req.params.walletId,
        data: req.body,
        error: error.message,
        stack: error.stack,
        requestId: req.id,
      });

      if (error.message === "Wallet not found") {
        return apiResponse.notFound(res, "Wallet not found");
      }

      return apiResponse.error(res, 500, "Error updating wallet");
    }
  },

  /**
   * Withdraw funds from wallet (requires passcode)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async withdrawFunds(req, res) {
    try {
      const userId = req.user._id;
      const { walletId } = req.params;
      const { amount, targetType, targetId, description } = req.body;

      // Verify required fields
      if (!amount || !targetType || !targetId) {
        return apiResponse.badRequest(res, "Missing required fields");
      }

      // Validate amount
      if (isNaN(amount) || parseFloat(amount) <= 0) {
        return apiResponse.badRequest(res, "Invalid amount");
      }

      // Validate target type
      if (targetType !== "account" && targetType !== "card") {
        return apiResponse.badRequest(res, "Invalid target type");
      }

      // Process withdrawal
      const result = await transactionService.walletToAccountWithdrawal({
        userId,
        walletId,
        targetType,
        targetId,
        cryptoAmount: amount,
        description,
      });

      logger.info("Withdrawal processed successfully", {
        userId,
        walletId,
        amount,
        targetType,
        targetId,
        transactionId: result.walletTransaction._id,
        requestId: req.id,
      });

      return apiResponse.success(
        res,
        200,
        "Withdrawal processed successfully",
        {
          transaction: result.walletTransaction,
          remainingBalance: result.walletBalance,
        }
      );
    } catch (error) {
      logger.error("Error processing withdrawal", {
        userId: req.user._id,
        walletId: req.params.walletId,
        data: req.body,
        error: error.message,
        stack: error.stack,
        requestId: req.id,
      });

      if (error.message === "Insufficient funds in wallet") {
        return apiResponse.badRequest(res, "Insufficient funds in wallet");
      } else if (error.message.includes("not found")) {
        return apiResponse.notFound(res, error.message);
      }

      return apiResponse.error(res, 500, "Error processing withdrawal");
    }
  },

  /**
   * Transfer between wallets (requires passcode)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async transferBetweenWallets(req, res) {
    try {
      const userId = req.user._id;
      const { sourceWalletId, targetWalletId, amount, description } = req.body;

      // Verify required fields
      if (!sourceWalletId || !targetWalletId || !amount) {
        return apiResponse.badRequest(res, "Missing required fields");
      }

      // Validate amount
      if (isNaN(amount) || parseFloat(amount) <= 0) {
        return apiResponse.badRequest(res, "Invalid amount");
      }

      // Process transfer
      const result = await transactionService.walletToWalletTransfer({
        userId,
        sourceWalletId,
        targetWalletId,
        amount,
        description,
      });

      logger.info("Wallet transfer processed successfully", {
        userId,
        sourceWalletId,
        targetWalletId,
        amount,
        withdrawalTransactionId: result.withdrawalTransaction._id,
        depositTransactionId: result.depositTransaction._id,
        requestId: req.id,
      });

      return apiResponse.success(res, 200, "Transfer processed successfully", {
        withdrawalTransaction: result.withdrawalTransaction,
        depositTransaction: result.depositTransaction,
        sourceWalletBalance: result.sourceWalletBalance,
        targetWalletBalance: result.targetWalletBalance,
      });
    } catch (error) {
      logger.error("Error processing wallet transfer", {
        userId: req.user._id,
        data: req.body,
        error: error.message,
        stack: error.stack,
        requestId: req.id,
      });

      if (error.message === "Insufficient funds in source wallet") {
        return apiResponse.badRequest(
          res,
          "Insufficient funds in source wallet"
        );
      } else if (error.message.includes("not found")) {
        return apiResponse.notFound(res, error.message);
      }

      return apiResponse.error(res, 500, "Error processing transfer");
    }
  },

  /**
   * Get wallet transaction history
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getWalletTransactions(req, res) {
    try {
      const userId = req.user._id;
      const { walletId } = req.params;
      const { limit = 20, page = 1, type } = req.query;

      // Verify wallet exists and belongs to user
      const wallet = await walletService.getWalletById(walletId, userId);

      // Build filter
      const filter = { wallet: walletId, user: userId };
      if (type) filter.type = type;

      // Get transactions with pagination
      const transactions = await transactionService.getWalletTransactions(
        filter,
        page,
        limit
      );

      logger.info("Wallet transactions retrieved", {
        userId,
        walletId,
        transactionCount: transactions.results.length,
        totalCount: transactions.pagination.total,
        requestId: req.id,
      });

      return apiResponse.success(
        res,
        200,
        "Transactions retrieved successfully",
        {
          transactions: transactions.results,
          pagination: transactions.pagination,
        }
      );
    } catch (error) {
      logger.error("Error retrieving wallet transactions", {
        userId: req.user._id,
        walletId: req.params.walletId,
        error: error.message,
        stack: error.stack,
        requestId: req.id,
      });

      if (error.message === "Wallet not found") {
        return apiResponse.notFound(res, "Wallet not found");
      }

      return apiResponse.error(res, 500, "Error retrieving transactions");
    }
  },
};

module.exports = walletController;
