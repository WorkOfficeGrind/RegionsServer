const User = require("../models/User");
const { logger } = require("../config/logger");
const apiResponse = require("../utils/apiResponse");

/**
 * Update user profile
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updateProfile = async (req, res) => {
  try {
    const { firstName, lastName, phone, address, picture } = req.body;

    // Get current user
    const user = await User.findById(req.user._id);

    if (!user) {
      return apiResponse.notFound(res, "User not found");
    }

    // Update fields
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (firstName || lastName)
      user.fullName = `${firstName || user.firstName} ${
        lastName || user.lastName
      }`;
    if (phone) user.phone = phone;
    if (address) user.address = address;
    if (picture) user.picture = picture;

    // Save user
    await user.save();

    logger.info("User profile updated", {
      userId: user._id,
      requestId: req.id,
    });

    return apiResponse.updated(res, "Profile updated successfully", {
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
        phone: user.phone,
        address: user.address,
        picture: user.picture,
      },
    });
  } catch (error) {
    logger.error("Error updating user profile", {
      userId: req.user._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(res, 500, "Error updating profile");
  }
};

/**
 * Get user dashboard data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getDashboard = async (req, res) => {
  try {
    // Get user with populated data
    const user = await User.findById(req.user._id)
      .populate({
        path: "accounts",
        select: "type name bank availableBalance ledgerBalance status",
        match: { status: "active" },
      })
      .populate({
        path: "cards",
        select: "type name bank brand last4 availableBalance status",
        match: { status: "active" },
      })
      .populate({
        path: "wallets",
        select: "currency balance name status",
        match: { status: "active" },
      })
      .populate({
        path: "bills",
        select: "title customName amount dueDate status provider",
        match: { status: { $in: ["pending", "overdue"] } },
        options: { sort: { dueDate: 1 }, limit: 5 },
      });

    if (!user) {
      return apiResponse.notFound(res, "User not found");
    }

    // Get total balance across all accounts
    const totalAccountBalance = user.accounts.reduce(
      (total, account) => total + account.availableBalance,
      0
    );

    // Get total balance across all cards
    const totalCardBalance = user.cards.reduce(
      (total, card) => total + card.availableBalance,
      0
    );

    // Get upcoming bills
    const upcomingBills = user.bills.slice(0, 3);

    // Get user investments
    const investments = await user.populate({
      path: "investments",
      select: "plan investedAmount currentValue status",
      populate: {
        path: "plan",
        select: "name symbol roi",
      },
      match: { status: "active" },
      options: { limit: 5 },
    });

    // Calculate total invested and current value
    const totalInvested = investments.investments
      ? investments.investments.reduce(
          (total, inv) => total + inv.investedAmount,
          0
        )
      : 0;

    const totalInvestmentValue = investments.investments
      ? investments.investments.reduce(
          (total, inv) => total + inv.currentValue,
          0
        )
      : 0;

    // Get recent transactions
    const Transaction = require("../models/Transaction");
    const recentTransactions = await Transaction.find({
      user: req.user._id,
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("sourceId", "name bank type currency")
      .populate("destinationId", "name bank type currency");

    logger.info("User dashboard retrieved", {
      userId: user._id,
      requestId: req.id,
    });

    return apiResponse.success(
      res,
      200,
      "Dashboard data retrieved successfully",
      {
        accounts: {
          count: user.accounts.length,
          totalBalance: totalAccountBalance,
          list: user.accounts,
        },
        cards: {
          count: user.cards.length,
          totalBalance: totalCardBalance,
          list: user.cards,
        },
        wallets: {
          count: user.wallets.length,
          list: user.wallets,
        },
        bills: {
          upcoming: upcomingBills,
          count: user.bills.length,
        },
        investments: {
          totalInvested,
          totalValue: totalInvestmentValue,
          profit: totalInvestmentValue - totalInvested,
          list: investments.investments || [],
        },
        recentTransactions,
      }
    );
  } catch (error) {
    logger.error("Error retrieving dashboard data", {
      userId: req.user._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(res, 500, "Error retrieving dashboard data");
  }
};

/**
 * Get user KYC status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getKycStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("kycStatus");

    if (!user) {
      return apiResponse.notFound(res, "User not found");
    }

    return apiResponse.success(res, 200, "KYC status retrieved successfully", {
      kycStatus: user.kycStatus,
    });
  } catch (error) {
    logger.error("Error retrieving KYC status", {
      userId: req.user._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(res, 500, "Error retrieving KYC status");
  }
};

/**
 * Update user KYC information
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updateKyc = async (req, res) => {
  try {
    const { dateOfBirth, ssn, address } = req.body;

    const user = await User.findById(req.user._id);

    if (!user) {
      return apiResponse.notFound(res, "User not found");
    }

    // Store KYC information
    if (dateOfBirth) user.dateOfBirth = dateOfBirth;
    if (ssn) user.ssn = ssn;
    if (address) user.address = address;

    // Update KYC status if not already verified
    if (user.kycStatus !== "verified") {
      user.kycStatus = "pending";
    }

    await user.save();

    logger.info("User KYC information updated", {
      userId: user._id,
      kycStatus: user.kycStatus,
      requestId: req.id,
    });

    return apiResponse.updated(res, "KYC information updated successfully", {
      kycStatus: user.kycStatus,
    });
  } catch (error) {
    logger.error("Error updating KYC information", {
      userId: req.user._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(res, 500, "Error updating KYC information");
  }
};

/**
 * Get user activity log
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getActivityLog = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    // Aggregate device activity, login history, transaction history
    const Transaction = require("../models/Transaction");
    const RefreshToken = require("../models/RefreshToken");

    // Get recent logins
    const logins = await RefreshToken.find({
      user: req.user._id,
    })
      .sort({ issuedAt: -1 })
      .limit(10)
      .select("issuedAt ipAddress userAgent device");

    // Get transaction history
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const transactions = await Transaction.find({
      user: req.user._id,
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select("type amount status createdAt description reference");

    // Get count of transactions for pagination
    const total = await Transaction.countDocuments({
      user: req.user._id,
    });

    const totalPages = Math.ceil(total / parseInt(limit));

    logger.info("User activity log retrieved", {
      userId: req.user._id,
      requestId: req.id,
    });

    return apiResponse.success(
      res,
      200,
      "Activity log retrieved successfully",
      {
        logins,
        transactions,
      },
      apiResponse.paginationMeta(
        total,
        parseInt(page),
        parseInt(limit),
        totalPages
      )
    );
  } catch (error) {
    logger.error("Error retrieving activity log", {
      userId: req.user._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(res, 500, "Error retrieving activity log");
  }
};

/**
 * Enable MFA
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.enableMfa = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return apiResponse.notFound(res, "User not found");
    }

    // Check if MFA is already enabled
    if (user.mfaEnabled) {
      return apiResponse.badRequest(res, "MFA is already enabled");
    }

    // Generate MFA secret and QR code
    // This is simplified - in a real implementation, you would use a library like speakeasy
    const mfaSecret = Math.random().toString(36).substring(2, 15);

    // Store MFA secret temporarily in pendingUpdates
    user.pendingUpdates = {
      mfaSecret,
    };

    await user.save();

    logger.info("MFA setup initiated", {
      userId: user._id,
      requestId: req.id,
    });

    return apiResponse.success(res, 200, "MFA setup initiated", {
      mfaSecret,
    });
  } catch (error) {
    logger.error("Error enabling MFA", {
      userId: req.user._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(res, 500, "Error enabling MFA");
  }
};

/**
 * Verify MFA setup
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.verifyMfa = async (req, res) => {
  try {
    const { code } = req.body;

    const user = await User.findById(req.user._id);

    if (!user) {
      return apiResponse.notFound(res, "User not found");
    }

    // Check if MFA setup is in progress
    if (!user.pendingUpdates || !user.pendingUpdates.mfaSecret) {
      return apiResponse.badRequest(res, "MFA setup not initiated");
    }

    // Verify MFA code
    // In a real implementation, you would use a library like speakeasy to verify the code
    const isValid = code === "123456"; // Simplified example

    if (!isValid) {
      logger.warn("Invalid MFA verification code", {
        userId: user._id,
        requestId: req.id,
      });

      return apiResponse.badRequest(res, "Invalid verification code");
    }

    // Enable MFA
    user.mfaEnabled = true;
    // In a real implementation, you would store the MFA secret securely
    user.pendingUpdates = {};

    await user.save();

    logger.info("MFA enabled", {
      userId: user._id,
      requestId: req.id,
    });

    return apiResponse.success(res, 200, "MFA enabled successfully");
  } catch (error) {
    logger.error("Error verifying MFA", {
      userId: req.user._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(res, 500, "Error verifying MFA");
  }
};

/**
 * Disable MFA
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.disableMfa = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return apiResponse.notFound(res, "User not found");
    }

    // Check if MFA is already disabled
    if (!user.mfaEnabled) {
      return apiResponse.badRequest(res, "MFA is already disabled");
    }

    // Disable MFA
    user.mfaEnabled = false;

    await user.save();

    logger.info("MFA disabled", {
      userId: user._id,
      requestId: req.id,
    });

    return apiResponse.success(res, 200, "MFA disabled successfully");
  } catch (error) {
    logger.error("Error disabling MFA", {
      userId: req.user._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(res, 500, "Error disabling MFA");
  }
};
