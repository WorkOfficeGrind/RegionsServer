const mongoose = require("mongoose");
const walletService = require("../services/walletService");
const transactionService = require("../services/transactionService");
const { logger } = require("../config/logger");
const apiResponse = require("../utils/apiResponse");
const waitlistService = require("../services/waitlistService");

/**
 * waitlist controller for handling wallet operations
 */
const waitlistController = {
  /**
   * Get all wallet applications for the authenticated user
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getUserWallets(req, res) {
    // Start a MongoDB session for consistent reads
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const userId = req.user._id;

      const wallets = await waitlistService.getUserWalletApplications(
        userId,
        session
      );

      // Commit the transaction
      await session.commitTransaction();
      session.endSession();

      logger.info("Retrieved user wallets", {
        userId,
        count: wallets.length,
        requestId: req.id,
      });

      return apiResponse.success(res, 200, "Wallets retrieved successfully", {
        wallets,
      });
    } catch (error) {
      // Abort transaction in case of error
      await session.abortTransaction();
      session.endSession();

      logger.error("Error getting user wallets", {
        userId: req.user._id,
        error: error.message,
        stack: error.stack,
        requestId: req.id,
      });

      return apiResponse.error(res, 500, "Error retrieving wallets");
    }
  },
};

module.exports = waitlistController;
