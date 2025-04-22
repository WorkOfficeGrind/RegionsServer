const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const ms = require("ms");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const User = require("../models/User");
const Account = require("../models/Account");
const Transaction = require("../models/Transaction");
const { logger } = require("../config/logger");
const apiResponse = require("../utils/apiResponse");
const config = require("../config/config");
const {
  sendEmailChangeVerification,
  sendEmailChangeConfirmation,
  sendSecurityAlert,
  sendEmailChangeRejection,
} = require("../services/emailService");
const notificationService = require("../services/notificationService");

const profileUtils = {
  /**
   * Start a MongoDB transaction session
   * @param {string} userId - User ID
   * @param {string} requestId - Request ID
   * @returns {Promise<Object>} Session object and sessionActive flag
   */
  startSession: async (userId, requestId) => {
    logger.debug("Starting MongoDB transaction", { userId, requestId });
    const session = await mongoose.startSession();
    session.startTransaction();
    return { session, sessionActive: true };
  },

  /**
   * End a MongoDB transaction session (commit or abort)
   * @param {Object} session - MongoDB session
   * @param {boolean} sessionActive - Flag indicating if session is active
   * @param {boolean} success - Whether to commit or abort the transaction
   * @param {string} requestId - Request ID
   */
  endSession: async (session, sessionActive, success, requestId) => {
    if (sessionActive) {
      try {
        if (success) {
          await session.commitTransaction();
          logger.debug("Transaction committed successfully", { requestId });
        } else {
          await session.abortTransaction();
          logger.debug("Transaction aborted", { requestId });
        }
        session.endSession();
      } catch (sessionError) {
        logger.error("Error ending transaction", {
          requestId,
          error: sessionError.message,
        });
        // Try to abort if commit failed
        if (success) {
          try {
            await session.abortTransaction();
            session.endSession();
          } catch (error) {
            logger.error("Error aborting transaction after failed commit", {
              requestId,
              error: error.message,
            });
          }
        }
      }
    }
  },

  /**
   * Find user by ID using session
   * @param {string} userId - User ID
   * @param {Object} session - MongoDB session
   * @param {string} requestId - Request ID
   * @returns {Promise<Object>} User document or null
   */
  findUserById: async (userId, session, requestId) => {
    try {
      const user = await User.findById(userId).session(session);
      if (!user) {
        logger.warn("User not found", { userId, requestId });
      }
      return user;
    } catch (error) {
      logger.error("Error finding user", {
        userId,
        requestId,
        error: error.message,
      });
      return null;
    }
  },

  /**
   * Verify required ID images are present
   * @param {Object} cloudinaryFiles - Uploaded files
   * @param {boolean} requireProofOfAddress - Whether to require proof of address
   * @returns {boolean} True if all required files are present
   */
  verifyRequiredImages: (cloudinaryFiles, requireProofOfAddress = false) => {
    if (!cloudinaryFiles) return false;

    const hasIdImages =
      cloudinaryFiles.frontIdImage && cloudinaryFiles.backIdImage;

    if (requireProofOfAddress) {
      return hasIdImages && cloudinaryFiles.proofOfAddressImage;
    }

    return hasIdImages;
  },

  /**
   * Handle operation start logging
   * @param {string} operationType - Type of operation being performed
   * @param {Object} req - Express request object
   * @returns {Object} Operation metadata including start time
   */
  logOperationStart: (operationType, req) => {
    const requestStartTime = Date.now();
    const requestId = req.id;
    const userId = req.user?._id;

    logger.info(`${operationType} operation started`, {
      userId,
      requestId,
      endpoint: `${req.method} ${req.originalUrl}`,
      fieldsToUpdate: Object.keys(req.body).join(", "),
      hasVerificationFiles: req.cloudinaryFiles
        ? Object.keys(req.cloudinaryFiles).length > 0
        : false,
    });

    return { requestStartTime, requestId, userId };
  },

  /**
   * Log operation completion
   * @param {string} operationType - Type of operation performed
   * @param {Object} metadata - Operation metadata
   * @param {Object} additionalInfo - Additional information to log
   */
  logOperationComplete: (
    operationType,
    { requestStartTime, requestId, userId },
    additionalInfo = {}
  ) => {
    const processingTime = Date.now() - requestStartTime;
    logger.info(`${operationType} completed successfully`, {
      userId,
      requestId,
      processingTime: `${processingTime}ms`,
      ...additionalInfo,
    });
  },

  /**
   * Handle operation error
   * @param {string} operationType - Type of operation being performed
   * @param {Error} error - Error object
   * @param {Object} metadata - Operation metadata
   * @param {Object} session - MongoDB session
   * @param {boolean} sessionActive - Flag indicating if session is active
   * @param {Object} res - Express response object
   * @returns {Object} Error response
   */
  handleOperationError: async (
    operationType,
    error,
    { requestStartTime, requestId, userId },
    session,
    sessionActive,
    res
  ) => {
    logger.error(`${operationType} critical error`, {
      userId,
      requestId,
      error: error.message,
      stack: error.stack,
      errorName: error.name,
      errorCode: error.code,
      processingTime: `${Date.now() - requestStartTime}ms`,
    });

    // Ensure transaction is aborted if still active
    await profileUtils.endSession(session, sessionActive, false, requestId);

    return apiResponse.error(res, 500, `Error during ${operationType}`, {
      errorId: requestId,
    });
  },
};

/**
 * Get all transactions for a user with support for mobile-optimized infinite scrolling
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getAllTransactions = async (req, res) => {
  const metadata = profileUtils.logOperationStart(
    "Transactions retrieval",
    req
  );
  const { requestId, userId } = metadata;

  try {
    // Extract query parameters for filtering and pagination
    const {
      page = 0, // Match your React Native component which starts at page 0
      limit = 20, // Match your ITEMS_PER_PAGE constant
      status,
      type,
      sortBy = "createdAt",
      sortOrder = "desc",
      startDate,
      endDate,
      minAmount,
      maxAmount,
      sourceType,
      destinationType,
    } = req.query;

    // Calculate skip based on page for offset pagination
    // This matches your React Native component's approach
    const skip = parseInt(page) * parseInt(limit);

    logger.debug("Transaction query parameters", {
      userId,
      requestId,
      pagination: { page, limit, skip },
      filters: {
        status,
        type,
        startDate,
        endDate,
        minAmount,
        maxAmount,
        sourceType,
        destinationType,
      },
      sorting: { sortBy, sortOrder },
    });

    // Build query filters
    const query = { user: userId };

    // Apply date range filter if provided
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }

    // Apply status filter if provided
    if (status) {
      query.status = status;
    }

    // Apply transaction type filter if provided
    if (type) {
      query.type = type;
    }

    // Apply amount range filter if provided
    if (minAmount || maxAmount) {
      query.amount = {};
      if (minAmount) {
        query.amount.$gte = parseFloat(minAmount);
      }
      if (maxAmount) {
        query.amount.$lte = parseFloat(maxAmount);
      }
    }

    // Apply source type filter if provided
    if (sourceType) {
      query.sourceType = sourceType;
    }

    // Apply destination type filter if provided
    if (destinationType) {
      query.destinationType = destinationType;
    }

    // Build sort options
    const sort = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;

    // For pagination consistency, using limit and skip
    const pageSize = parseInt(limit);

    // Add one extra document to determine if there are more results
    // const Transaction = require("../models/Transaction");
    const transactions = await Transaction.find(query)
      .sort(sort)
      .skip(skip)
      .limit(pageSize + 1)
      // Populate source based on sourceType
      .populate({
        path: "source",
        select:
          "name bank type currency accountNumber routingNumber last4 brand address image",
        populate: [
          {
            path: "user",
            select: "firstName lastName email phone",
          },
        ],
      })
      // Populate destination based on destinationType
      .populate({
        path: "destination",
        select:
          "name bank type currency accountNumber routingNumber last4 brand address image",
        populate: [
          {
            path: "user",
            select: "firstName lastName email phone",
          },
        ],
      })
      // Populate fees, attachments, and user details
      //   .populate("fees")
      //   .populate("attachments")
      .populate({
        path: "user",
        select: "firstName lastName email phone",
      });

    // Check if there are more results
    const hasMore = transactions.length > pageSize;

    // Remove the extra item we used to check for more results
    const paginatedTransactions = hasMore
      ? transactions.slice(0, pageSize)
      : transactions;

    // Transform transaction data to match your mobile app's expected format
    const formattedTransactions = paginatedTransactions.map((transaction) => ({
      id: transaction._id.toString(),
      amount: transaction.amount,
      date: new Date(transaction.createdAt).toISOString().split("T")[0],
      description: transaction.description || `${transaction.type} transaction`,
      type: transaction.amount > 0 ? "income" : "expense",
      // Include other fields needed by your app
      status: transaction.status,
      sourceType: transaction.sourceType,
      destinationType: transaction.destinationType,
      // You can include additional fields for detailed views
      sourceName: transaction.sourceId?.name,
      destinationName: transaction.destinationId?.name,
      // Include any other fields needed by your frontend
    }));

    logger.info("Transactions retrieved successfully", {
      userId,
      requestId,
      count: formattedTransactions.length,
      hasMore,
      processingTime: `${Date.now() - metadata.requestStartTime}ms`,
    });

    profileUtils.logOperationComplete("Transactions retrieval", metadata, {
      transactionsCount: formattedTransactions.length,
      hasMoreTransactions: hasMore,
    });

    return apiResponse.success(
      res,
      200,
      "Transactions retrieved successfully",
      "Your transactions have been retrieved",
      {
        transactions: formattedTransactions,
        hasMore, // Matches exactly what your React Native component expects
      }
    );
  } catch (error) {
    return profileUtils.handleOperationError(
      "Transactions retrieval",
      error,
      metadata,
      null, // No session needed for read operations
      false,
      res
    );
  }
};

/**
 * Get transaction details by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getTransactionById = async (req, res) => {
  const metadata = profileUtils.logOperationStart(
    "Transaction details retrieval",
    req
  );
  const { requestId, userId } = metadata;

  try {
    const { transactionId } = req.params;

    if (!transactionId) {
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Transaction ID is required"
      );
    }

    const Transaction = require("../models/Transaction");
    const transaction = await Transaction.findOne({
      _id: transactionId,
      user: userId,
    })
      // Deep population of related entities
      .populate({
        path: "source",
        // select:
        //   "name bank type currency accountNumber routingNumber last4 brand address image",
        populate: [
          {
            path: "user",
            select: "fullName",
          },
        ],
      })
      .populate({
        path: "destination",
        // select:
        //   "name bank type currency accountNumber routingNumber last4 brand address image",
        populate: [
          {
            path: "user",
            select: "fullName",
          },
        ],
      })

      .populate({
        path: "user",
        select: "fullName",
      });

    if (!transaction) {
      logger.warn("Transaction not found", {
        userId,
        requestId,
        transactionId,
      });

      return apiResponse.notFound(
        res,
        "Not Found",
        "Transaction not found or does not belong to the user"
      );
    }

    // Format transaction for mobile display
    const formattedTransaction = {
      id: transaction._id.toString(),
      amount: transaction.amount,
      date: new Date(transaction.createdAt).toISOString().split("T")[0],
      description: transaction.description || `${transaction.type} transaction`,
      type: transaction.amount > 0 ? "income" : "expense",
      status: transaction.status,
      // Include detailed information for the transaction detail view
      reference: transaction.reference,
      source: {
        // id: transaction.source?._id.toString(),
        // name: transaction.source?.name,
        // type: transaction.sourceType,
        // details: transaction.source,
        ...transaction.source,
      },
      destination: {
        // id: transaction.destinationId?._id.toString(),
        // name: transaction.destinationId?.name,
        // type: transaction.destinationType,
        // details: transaction.destinationId,
        ...transaction.destination,
      },
      // fees: transaction.fees?.map((fee) => ({
      //   id: fee._id.toString(),
      //   amount: fee.amount,
      //   description: fee.description,
      //   type: fee.feeType?.name || "Fee",
      // })),
      // attachments: transaction.attachments?.map((attachment) => ({
      //   id: attachment._id.toString(),
      //   url: attachment.url,
      //   type: attachment.type,
      //   name: attachment.name,
      // })),
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
    };

    logger.info("Transaction details retrieved successfully", {
      userId,
      requestId,
      transactionId,
      processingTime: `${Date.now() - metadata.requestStartTime}ms`,
    });

    profileUtils.logOperationComplete(
      "Transaction details retrieval",
      metadata,
      {
        transactionId,
      }
    );

    return apiResponse.success(
      res,
      200,
      "Transaction details retrieved successfully",
      "Transaction details have been retrieved",
      { transaction }
      // { transaction: formattedTransaction }
    );
  } catch (error) {
    return profileUtils.handleOperationError(
      "Transaction details retrieval",
      error,
      metadata,
      null, // No session needed for read operations
      false,
      res
    );
  }
};

/**
 * Get all transactions by account ID with support for mobile-optimized infinite scrolling
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getTransactionsByAccountId = async (req, res) => {
  const metadata = profileUtils.logOperationStart(
    "Account transactions retrieval",
    req
  );
  const { requestId, userId } = metadata;

  try {
    const { accountId } = req.params;

    if (!accountId) {
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Account ID is required"
      );
    }

    // Extract query parameters for filtering and pagination
    // Changed default limit to 10 to match client-side implementation
    const {
      page = 1,
      limit, // FIXED: Set default to 10 to match frontend
      status,
      type,
      sortBy = "createdAt",
      sortOrder = "desc",
      startDate,
      endDate,
      minAmount,
      maxAmount,
    } = req.query;

    // Adjust page number for 1-based pagination in client to 0-based in database
    const adjustedPage = parseInt(page) - 1;
    const pageSize = parseInt(limit);
    const skip = adjustedPage * pageSize;

    logger.debug("Account transactions query parameters", {
      userId,
      requestId,
      accountId,
      pagination: { clientPage: page, adjustedPage, limit, skip },
      filters: {
        status,
        type,
        startDate,
        endDate,
        minAmount,
        maxAmount,
      },
      sorting: { sortBy, sortOrder },
    });

    const account = await Account.findOne({
      _id: accountId,
      user: userId,
    });

    if (!account) {
      logger.warn("Account not found or doesn't belong to user", {
        userId,
        requestId,
        accountId,
      });

      return apiResponse.notFound(
        res,
        "Not Found",
        "Account not found or doesn't belong to the user"
      );
    }

    // Build query filters for transactions
    const query = {
      user: userId,
      $or: [
        { source: accountId, sourceType: "Account" },
        { destination: accountId, destinationType: "Account" },
      ],
    };

    // Apply date range filter if provided
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }

    // Apply status filter if provided
    if (status) {
      query.status = status;
    }

    // Apply transaction type filter if provided
    if (type) {
      query.type = type;
    }

    // Apply amount range filter if provided
    if (minAmount || maxAmount) {
      query.amount = {};
      if (minAmount) {
        query.amount.$gte = parseFloat(minAmount);
      }
      if (maxAmount) {
        query.amount.$lte = parseFloat(maxAmount);
      }
    }

    // Build sort options
    const sort = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;

    // Add one extra document to determine if there are more results
    const transactions = await Transaction.find(query)
      .sort(sort)
      .skip(skip)
      .limit(pageSize + 1)
      // Populate source based on sourceType
      .populate({
        path: "source",
        select:
          "name bank type currency accountNumber routingNumber last4 brand address image",
      })
      // Populate destination based on destinationType
      .populate({
        path: "destination",
        select:
          "name bank type currency accountNumber routingNumber last4 brand address image",
      });

    // Check if there are more results
    const hasMore = transactions.length > pageSize;

    // Remove the extra item we used to check for more results
    const paginatedTransactions = hasMore
      ? transactions.slice(0, pageSize)
      : transactions;

    // Transform transaction data to match your mobile app's expected format
    const formattedTransactions = paginatedTransactions.map((transaction) => {
      // Determine if this is an incoming or outgoing transaction for this account
      const isIncoming =
        transaction.destination &&
        transaction.destination._id.toString() === accountId;

      // Determine the display name for the counterparty
      let counterpartyName = "Unknown";
      if (isIncoming && transaction.source) {
        counterpartyName =
          transaction.source.name ||
          (transaction.sourceType === "Account"
            ? "Account"
            : transaction.sourceType);
      } else if (!isIncoming && transaction.destination) {
        counterpartyName =
          transaction.destination.name ||
          (transaction.destinationType === "Account"
            ? "Account"
            : transaction.destinationType);
      }

      return {
        _id: transaction._id.toString(), // Changed from id to _id to match client-side expectations
        amount: transaction.amount,
        createdAt: transaction.createdAt, // Include createdAt for client-side date formatting
        description:
          transaction.description ||
          `${isIncoming ? "From" : "To"} ${counterpartyName}`,
        title: transaction.title || "", // Added title field for the client
        type: isIncoming ? "income" : "expense",
        status: transaction.status,
        reference: transaction.reference,
        category: transaction.category,
      };
    });

    logger.info("Account transactions retrieved successfully", {
      userId,
      requestId,
      accountId,
      count: formattedTransactions.length,
      hasMore,
      processingTime: `${Date.now() - metadata.requestStartTime}ms`,
    });

    profileUtils.logOperationComplete(
      "Account transactions retrieval",
      metadata,
      {
        accountId,
        transactionsCount: formattedTransactions.length,
        hasMoreTransactions: hasMore,
      }
    );

    // Return response in the format expected by the client
    return apiResponse.success(
      res,
      200,
      "Account transactions retrieved successfully",
      "Your account transactions have been retrieved",
      {
        transactions: formattedTransactions, // Changed to match client store structure
        hasMore, // Include hasMore flag for pagination
      }
    );
  } catch (error) {
    return profileUtils.handleOperationError(
      "Account transactions retrieval",
      error,
      metadata,
      null, // No session needed for read operations
      false,
      res
    );
  }
};

exports.updateTransactionsBySource = async (req, res) => {
  const { oldSource, newSource } = req.body;

  if (!oldSource || !newSource) {
    return res.status(400).json({
      message: "Both oldSource and newSource values are required.",
    });
  }

  try {
    const result = await Transaction.updateMany(
      { destination: oldSource },
      { $set: { destination: newSource } }
    );

    return res.status(200).json({
      message: `Updated ${result.modifiedCount} transaction(s) from source '${oldSource}' to '${newSource}'.`,
    });
  } catch (error) {
    console.error("Error updating transactions by source:", error);
    return res.status(500).json({
      message: "An error occurred while updating transactions.",
      error: error.message,
    });
  }
};
