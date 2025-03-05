const Transaction = require("../models/Transaction");
const Account = require("../models/Account");
const Card = require("../models/Card");
const Wallet = require("../models/Wallet");
const { logger, transactionLogger } = require("../config/logger");
const apiResponse = require("../utils/apiResponse");
const config = require("../config/config");
const mongoose = require("mongoose");
const crypto = require("crypto");
/**
 * @desc    Get user accounts
 * @route   GET /api/accounts
 * @access  Private
 */
const getUserAccounts = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const accounts = await Account.find({ user: userId })
      .populate("transactions")
      .exec();

    res.status(200).json({
      status: "Success",
      success: true,
      data: {
        accounts,
      },
    });
  } catch (error) {
    logger.error("Get User Accounts:", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
      ip: req.ip,
      timestamp: new Date().toISOString(),
    });
    next(error);
  }
};

/**
 * @desc    Get user account by ID
 * @route   GET /api/accounts/:accountId
 * @access  Private
 */
const getUserAccountById = async (req, res, next) => {
  try {
    const { accountId } = req.params;
    const userId = req.user._id;
    const account = await Account.find({ _id: accountId, user: userId });

    if (!account || account.length === 0) {
      throw new CustomError(404, "Account not found");
    }

    res.status(200).json({
      status: "Success",
      success: true,
      data: {
        account,
      },
    });
  } catch (error) {
    logger.error("Get User Account:", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
      ip: req.ip,
      timestamp: new Date().toISOString(),
    });
    next(error);
  }
};

// Helper function to convert amounts with proper precision
const convertCurrency = async (amount, fromCurrency, toCurrency) => {
  if (fromCurrency === toCurrency) {
    return amount;
  }

  const rate = await getExchangeRate(fromCurrency, toCurrency);
  return mongoose.Types.Decimal128.fromString(
    (parseFloat(amount.toString()) * rate).toFixed(8)
  );
};

/**
 * @desc    Transfer funds between accounts (same or different currencies)
 * @route   POST /api/accounts/transfer
 * @access  Private
 */
// exports.transferBetweenAccounts = async (req, res, next) => {
//   // Start logging - capture initial request data
//   logger.info("Account transfer request initiated", {
//     userId: req.user._id,
//     requestId: req.id,
//     requestBody: {
//       type: req.body.type,
//       amount: req.body.amount,
//       sourceId: req.body.sourceId,
//       sourceType: req.body.sourceType,
//       sourceCurrency: req.body.sourceCurrency,
//       destinationId: req.body.destinationId,
//       destinationType: req.body.destinationType,
//       destinationCurrency: req.body.destinationCurrency,
//       description: req.body.description,
//       metadata: req.body.metadata,
//       narration: req.body.narration,

//       // fromAccountId: req.body.fromAccountId,
//       // toAccountId: req.body.toAccountId,
//       // amount: req.body.amount,
//       // description: req.body.description || "Account to account transfer",
//     },
//     timestamp: new Date().toISOString(),
//     ipAddress: req.ip,
//     userAgent: req.headers["user-agent"],
//   });

//   // Start a database transaction
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     const {
//       type,
//       amount,
//       sourceId,
//       sourceType,
//       sourceCurrency,
//       destinationId,
//       destinationType,
//       destinationCurrency,
//       description,
//       metadata,
//       narration,
//     } = req.body;

//     if (sourceId === destinationId) {
//       logger.warn("Validation failed: Same source & destination", {
//         userId: req.user._id,
//         requestId: req.id,
//         timestamp: new Date().toISOString(),
//       });
//       return apiResponse.badRequest(
//         res,
//         `Source and destination accounts cannot be the same`
//       );
//     }

//     // Convert amount to Decimal128 for precise calculations
//     const decimalAmount = mongoose.Types.Decimal128.fromString(
//       amount.toString()
//     );

//     // Log account lookup attempt
//     logger.debug("Looking up accounts", {
//       userId: req.user._id,
//       requestId: req.id,
//       sourceId,
//       destinationId,
//       timestamp: new Date().toISOString(),
//     });

//     let source, destination, oldSourceBalance, oldDestinationBalance;

//     if (sourceType === "Account") {
//       source = await Account.findOne({
//         accountNumber: sourceId,
//         user: req.user._id,
//       }).session(session);
//     } else if (sourceType === "Card") {
//       source = await Card.findOne({
//         number: sourceId,
//         user: req.user._id,
//       }).session(session);
//     } else if (sourceType === "Wallet") {
//       source = await Wallet.findOne({
//         address: sourceId,
//         user: req.user._id,
//       }).session(session);
//     }

//     // Find the source account
//     // const sourceAccount = await Account.findOne({
//     //   accountNumber: sourceId,
//     //   user: req.user._id,
//     // }).session(session);

//     if (!source) {
//       logger.warn("Source not found", {
//         userId: req.user._id,
//         requestId: req.id,
//         fromAccountId,
//         timestamp: new Date().toISOString(),
//       });

//       return apiResponse.badRequest(res, `Source not found`);

//       // throw new CustomError(404, "Source not found");
//     }

//     // Check if source account has sufficient balance
//     if (
//       parseFloat(source.availableBalance.toString()) <
//       parseFloat(decimalAmount.toString())
//     ) {
//       logger.warn("Insufficient funds in source", {
//         userId: req.user._id,
//         requestId: req.id,
//         sourceId: source._id,
//         sourceBalance: source.availableBalance.toString(),
//         transferAmount: decimalAmount.toString(),
//         difference: (
//           parseFloat(decimalAmount.toString()) -
//           parseFloat(source.availableBalance.toString())
//         ).toFixed(8),
//         timestamp: new Date().toISOString(),
//       });

//       return apiResponse.badRequest(res, `Insufficient funds in source`);
//       // throw new CustomError(400, "Insufficient funds in source");
//     }

//     if (destinationType === "Account") {
//       destination = await Account.findOne({ accountNumber: destinationId });
//     } else if (destinationType === "Card") {
//       destination = await Card.findOne({ number: destinationId });
//     } else if (destinationType === "Wallet") {
//       destination = await Wallet.findOne({ address: destinationId });
//     }

//     if (!destination) {
//       logger.warn("Destination not found", {
//         userId: req.user._id,
//         requestId: req.id,
//         destinationId,
//         timestamp: new Date().toISOString(),
//       });
//       return apiResponse.badRequest(res, `Destination account not found`);

//       // throw new CustomError(404, "Destination account not found");
//     }

//     logger.debug("Currency conversion check", {
//       userId: req.user._id,
//       requestId: req.id,
//       fromCurrency: source.currency,
//       toCurrency: destination.currency,
//       beforeConversion: decimalAmount.toString(),
//       timestamp: new Date().toISOString(),
//     });

//     // Convert amount to destination account currency if different
//     const convertedAmount = await convertCurrency(
//       decimalAmount,
//       source.currency,
//       destination.currency
//     );

//     logger.debug("After currency conversion", {
//       userId: req.user._id,
//       requestId: req.id,
//       fromCurrency: source.currency,
//       toCurrency: destination.currency,
//       beforeConversion: decimalAmount.toString(),
//       afterConversion: convertedAmount.toString(),
//       conversionRate: (
//         parseFloat(convertedAmount.toString()) /
//         parseFloat(decimalAmount.toString())
//       ).toFixed(8),
//       timestamp: new Date().toISOString(),
//     });

//     // Deduct from source account
//     if (sourceType === "Account") {
//       oldSourceBalance = source.availableBalance.toString();

//       source.availableBalance = mongoose.Types.Decimal128.fromString(
//         (
//           parseFloat(source.availableBalance.toString()) -
//           parseFloat(decimalAmount.toString())
//         ).toFixed(8)
//       );
//     } else {
//       oldSourceBalance = source.balance.toString();

//       source.availableBalance = mongoose.Types.Decimal128.fromString(
//         (
//           parseFloat(source.balance.toString()) -
//           parseFloat(decimalAmount.toString())
//         ).toFixed(8)
//       );
//     }
//     // const oldSourceBalance = source.availableBalance.toString();

//     logger.debug("Updating Source balance", {
//       userId: req.user._id,
//       requestId: req.id,
//       sourceId: source._id,
//       oldBalance: oldSourceBalance,
//       amountDeducted: decimalAmount.toString(),
//       newBalance:
//         sourceType === "Account"
//           ? source.availableBalance.toString()
//           : // : sourceType === "Card"
//             // ? source.balance.toString()
//             source.balance.toString(),
//       timestamp: new Date().toISOString(),
//     });

//     await source.save({ session });

//     // Add to destination account
//     if (destinationType === "Account") {
//       oldDestinationBalance = destination.availableBalance.toString();

//       destination.availableBalance = mongoose.Types.Decimal128.fromString(
//         (
//           parseFloat(destination.availableBalance.toString()) +
//           parseFloat(convertedAmount.toString())
//         ).toFixed(8)
//       );
//     } else {
//       oldDestinationBalance = destination.balance.toString();

//       destination.availableBalance = mongoose.Types.Decimal128.fromString(
//         (
//           parseFloat(destination.balance.toString()) +
//           parseFloat(convertedAmount.toString())
//         ).toFixed(8)
//       );
//     }
//     // const oldDestinationBalance = destination.availableBalance.toString();

//     logger.debug("Updating Destination balance", {
//       userId: req.user._id,
//       requestId: req.id,
//       destinationId: destination._id,
//       oldBalance: oldDestinationBalance,
//       amountAdded: convertedAmount.toString(),
//       // newBalance: destination.availableBalance.toString(),
//       newBalance:
//         sourceType === "Account"
//           ? destination.availableBalance.toString()
//           : // : sourceType === "Card"
//             // ? destination.balance.toString()
//             destination.balance.toString(),
//       timestamp: new Date().toISOString(),
//     });

//     await destination.save({ session });

//     // Create transaction record
//     const reference = `ACTR-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
//     const transaction = new Transaction({
//       user: req.user._id,
//       type: "transfer",
//       amount: convertedAmount,
//       source:
//         sourceType === "Account"
//           ? source.accountNumber.toString()
//           : sourceType === "Card"
//           ? source.number.toString()
//           : source.address.toString(),
//       sourceType,
//       sourceCurrency: source.currency,
//       destination:
//         sourceType === "Account"
//           ? destination.accountNumber.toString()
//           : sourceType === "Card"
//           ? destination.number.toString()
//           : destination.address.toString(),
//       destinationType,
//       destinationCurrency: destination.currency,
//       conversionRate:
//         source.currency !== destination.currency
//           ? parseFloat(convertedAmount.toString()) /
//             parseFloat(decimalAmount.toString())
//           : 1,
//       description,
//       status: "completed",
//       reference,
//     });

//     logger.debug("Creating transaction record", {
//       userId: req.user._id,
//       requestId: req.id,
//       transactionReference: reference,
//       transactionDetails: {
//         user: req.user._id,
//         type: "transfer",
//         amount: convertedAmount,
//         sourceId: source._id,
//         sourceType,
//         sourceCurrency: source.currency,
//         destinationId: destination._id,
//         destinationType,
//         destinationCurrency: destination.currency,
//         conversionRate:
//           source.currency !== destination.currency
//             ? parseFloat(convertedAmount.toString()) /
//               parseFloat(decimalAmount.toString())
//             : 1,
//         description,
//         status: "completed",
//         reference,
//       },
//       timestamp: new Date().toISOString(),
//     });

//     await transaction.save({ session });

//     logger.debug("Committing database transaction", {
//       userId: req.user._id,
//       requestId: req.id,
//       reference,
//       timestamp: new Date().toISOString(),
//     });

//     // Commit transaction
//     await session.commitTransaction();
//     session.endSession();

//     logger.info("Transfer completed successfully", {
//       userId: req.user._id,
//       requestId: req.id,
//       transactionReference: reference,
//       amount: decimalAmount.toString(),
//       fromCurrency: source.currency,
//       toCurrency: destination.currency,
//       timestamp: new Date().toISOString(),
//     });

//     res.status(200).json({
//       status: "success",
//       message: "Transfer Successful",
//       reference,
//       success: true,
//       data: transaction,
//     });
//   } catch (error) {
//     // Abort transaction if error occurs
//     logger.error("Aborting database transaction due to error", {
//       userId: req.user?._id,
//       requestId: req.id,
//       errorMessage: error.message,
//       errorStack: error.stack,
//       timestamp: new Date().toISOString(),
//     });

//     await session.abortTransaction();
//     session.endSession();

//     logger.error("Transfer failed:", {
//       error: error.message,
//       errorCode: error.code || error.statusCode,
//       errorStack: error.stack,
//       userId: req.user?._id,
//       requestId: req.id,
//       requestBody: req.body,
//       timestamp: new Date().toISOString(),
//     });

//     next(error);
//   }
// };

exports.transferBetweenAccounts = async (req, res, next) => {
  // Start logging - capture initial request data
  logger.info("Account transfer request initiated", {
    userId: req.user._id,
    requestId: req.id,
    requestBody: {
      type: req.body.type,
      amount: req.body.amount,
      sourceId: req.body.sourceId,
      sourceType: req.body.sourceType,
      sourceCurrency: req.body.sourceCurrency,
      destinationId: req.body.destinationId,
      destinationType: req.body.destinationType,
      destinationCurrency: req.body.destinationCurrency,
      description: req.body.description,
      metadata: req.body.metadata,
      narration: req.body.narration,

      // fromAccountId: req.body.fromAccountId,
      // toAccountId: req.body.toAccountId,
      // amount: req.body.amount,
      // description: req.body.description || "Account to account transfer",
    },
    timestamp: new Date().toISOString(),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });

  // Start a database transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      type,
      amount,
      sourceId,
      sourceType,
      sourceCurrency,
      destinationId,
      destinationType,
      destinationCurrency,
      description,
      metadata,
      narration,
    } = req.body;

    if (sourceId === destinationId) {
      logger.warn("Validation failed: Same source & destination", {
        userId: req.user._id,
        requestId: req.id,
        timestamp: new Date().toISOString(),
      });
      return apiResponse.badRequest(
        res,
        `Source and destination accounts cannot be the same`
      );
    }

    // Convert amount to Decimal128 for precise calculations
    const decimalAmount = mongoose.Types.Decimal128.fromString(
      amount.toString()
    );

    // Log account lookup attempt
    logger.debug("Looking up accounts", {
      userId: req.user._id,
      requestId: req.id,
      sourceId,
      destinationId,
      timestamp: new Date().toISOString(),
    });

    let source, destination, oldSourceBalance, oldDestinationBalance;

    if (sourceType === "Account") {
      source = await Account.findOne({
        accountNumber: sourceId,
        user: req.user._id,
      }).session(session);
    } else if (sourceType === "Card") {
      source = await Card.findOne({
        number: sourceId,
        user: req.user._id,
      }).session(session);
    } else if (sourceType === "Wallet") {
      source = await Wallet.findOne({
        address: sourceId,
        user: req.user._id,
      }).session(session);
    }

    // Find the source account
    // const sourceAccount = await Account.findOne({
    //   accountNumber: sourceId,
    //   user: req.user._id,
    // }).session(session);

    if (!source) {
      logger.warn("Source not found", {
        userId: req.user._id,
        requestId: req.id,
        fromAccountId,
        timestamp: new Date().toISOString(),
      });

      return apiResponse.badRequest(res, `Source not found`);

      // throw new CustomError(404, "Source not found");
    }

    // Check if source account has sufficient balance
    if (
      parseFloat(source.availableBalance.toString()) <
      parseFloat(decimalAmount.toString())
    ) {
      logger.warn("Insufficient funds in source", {
        userId: req.user._id,
        requestId: req.id,
        sourceId: source._id,
        sourceBalance: source.availableBalance.toString(),
        transferAmount: decimalAmount.toString(),
        difference: (
          parseFloat(decimalAmount.toString()) -
          parseFloat(source.availableBalance.toString())
        ).toFixed(8),
        timestamp: new Date().toISOString(),
      });

      return apiResponse.badRequest(res, `Insufficient funds in source`);
      // throw new CustomError(400, "Insufficient funds in source");
    }

    if (destinationType === "Account") {
      destination = await Account.findOne({ accountNumber: destinationId });
    } else if (destinationType === "Card") {
      destination = await Card.findOne({ number: destinationId });
    } else if (destinationType === "Wallet") {
      destination = await Wallet.findOne({ address: destinationId });
    }

    if (!destination) {
      logger.warn("Destination not found", {
        userId: req.user._id,
        requestId: req.id,
        destinationId,
        timestamp: new Date().toISOString(),
      });
      return apiResponse.badRequest(res, `Destination account not found`);

      // throw new CustomError(404, "Destination account not found");
    }

    logger.debug("Currency conversion check", {
      userId: req.user._id,
      requestId: req.id,
      fromCurrency: source.currency,
      toCurrency: destination.currency,
      beforeConversion: decimalAmount.toString(),
      timestamp: new Date().toISOString(),
    });

    // Convert amount to destination account currency if different
    const convertedAmount = await convertCurrency(
      decimalAmount,
      source.currency,
      destination.currency
    );

    logger.debug("After currency conversion", {
      userId: req.user._id,
      requestId: req.id,
      fromCurrency: source.currency,
      toCurrency: destination.currency,
      beforeConversion: decimalAmount.toString(),
      afterConversion: convertedAmount.toString(),
      conversionRate: (
        parseFloat(convertedAmount.toString()) /
        parseFloat(decimalAmount.toString())
      ).toFixed(8),
      timestamp: new Date().toISOString(),
    });

    // Deduct from source account
    if (sourceType === "Account") {
      oldSourceBalance = source.availableBalance.toString();

      source.availableBalance = mongoose.Types.Decimal128.fromString(
        (
          parseFloat(source.availableBalance.toString()) -
          parseFloat(decimalAmount.toString())
        ).toFixed(8)
      );
    } else {
      oldSourceBalance = source.balance.toString();

      source.availableBalance = mongoose.Types.Decimal128.fromString(
        (
          parseFloat(source.balance.toString()) -
          parseFloat(decimalAmount.toString())
        ).toFixed(8)
      );
    }
    // const oldSourceBalance = source.availableBalance.toString();

    logger.debug("Updating Source balance", {
      userId: req.user._id,
      requestId: req.id,
      sourceId: source._id,
      oldBalance: oldSourceBalance,
      amountDeducted: decimalAmount.toString(),
      newBalance:
        sourceType === "Account"
          ? source.availableBalance.toString()
          : // : sourceType === "Card"
            // ? source.balance.toString()
            source.balance.toString(),
      timestamp: new Date().toISOString(),
    });

    await source.save({ session });

    // Add to destination account
    if (destinationType === "Account") {
      oldDestinationBalance = destination.availableBalance.toString();

      destination.availableBalance = mongoose.Types.Decimal128.fromString(
        (
          parseFloat(destination.availableBalance.toString()) +
          parseFloat(convertedAmount.toString())
        ).toFixed(8)
      );
    } else {
      oldDestinationBalance = destination.balance.toString();

      destination.availableBalance = mongoose.Types.Decimal128.fromString(
        (
          parseFloat(destination.balance.toString()) +
          parseFloat(convertedAmount.toString())
        ).toFixed(8)
      );
    }
    // const oldDestinationBalance = destination.availableBalance.toString();

    logger.debug("Updating Destination balance", {
      userId: req.user._id,
      requestId: req.id,
      destinationId: destination._id,
      oldBalance: oldDestinationBalance,
      amountAdded: convertedAmount.toString(),
      // newBalance: destination.availableBalance.toString(),
      newBalance:
        sourceType === "Account"
          ? destination.availableBalance.toString()
          : // : sourceType === "Card"
            // ? destination.balance.toString()
            destination.balance.toString(),
      timestamp: new Date().toISOString(),
    });

    await destination.save({ session });

    // Create transaction record
    const reference = `ACTR-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const transaction = new Transaction({
      user: req.user._id,
      type: "transfer",
      amount: convertedAmount,
      source:
        sourceType === "Account"
          ? source.accountNumber.toString()
          : sourceType === "Card"
          ? source.number.toString()
          : source.address.toString(),
      sourceType,
      sourceCurrency: source.currency,
      destination:
        sourceType === "Account"
          ? destination.accountNumber.toString()
          : sourceType === "Card"
          ? destination.number.toString()
          : destination.address.toString(),
      destinationType,
      destinationCurrency: destination.currency,
      conversionRate:
        source.currency !== destination.currency
          ? parseFloat(convertedAmount.toString()) /
            parseFloat(decimalAmount.toString())
          : 1,
      description,
      status: "completed",
      reference,
    });

    logger.debug("Creating transaction record", {
      userId: req.user._id,
      requestId: req.id,
      transactionReference: reference,
      transactionDetails: {
        user: req.user._id,
        type: "transfer",
        amount: convertedAmount,
        sourceId: source._id,
        sourceType,
        sourceCurrency: source.currency,
        destinationId: destination._id,
        destinationType,
        destinationCurrency: destination.currency,
        conversionRate:
          source.currency !== destination.currency
            ? parseFloat(convertedAmount.toString()) /
              parseFloat(decimalAmount.toString())
            : 1,
        description,
        status: "completed",
        reference,
      },
      timestamp: new Date().toISOString(),
    });

    await transaction.save({ session });

    // Add transaction ID to source transactions array
    if (!source.transactions) {
      source.transactions = [];
    }
    source.transactions.push(transaction._id);

    logger.debug("Adding transaction to source", {
      userId: req.user._id,
      requestId: req.id,
      sourceId: source._id,
      transactionId: transaction._id,
      timestamp: new Date().toISOString(),
    });

    await source.save({ session });

    // Add transaction ID to destination transactions array
    if (!destination.transactions) {
      destination.transactions = [];
    }
    destination.transactions.push(transaction._id);

    logger.debug("Adding transaction to destination", {
      userId: req.user._id,
      requestId: req.id,
      destinationId: destination._id,
      transactionId: transaction._id,
      timestamp: new Date().toISOString(),
    });

    await destination.save({ session });

    logger.debug("Committing database transaction", {
      userId: req.user._id,
      requestId: req.id,
      reference,
      timestamp: new Date().toISOString(),
    });

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Transfer completed successfully", {
      userId: req.user._id,
      requestId: req.id,
      transactionReference: reference,
      amount: decimalAmount.toString(),
      fromCurrency: source.currency,
      toCurrency: destination.currency,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      status: "success",
      message: "Transfer Successful",
      reference,
      success: true,
      data: transaction,
    });
  } catch (error) {
    // Abort transaction if error occurs
    logger.error("Aborting database transaction due to error", {
      userId: req.user?._id,
      requestId: req.id,
      errorMessage: error.message,
      errorStack: error.stack,
      timestamp: new Date().toISOString(),
    });

    await session.abortTransaction();
    session.endSession();

    logger.error("Transfer failed:", {
      error: error.message,
      errorCode: error.code || error.statusCode,
      errorStack: error.stack,
      userId: req.user?._id,
      requestId: req.id,
      requestBody: req.body,
      timestamp: new Date().toISOString(),
    });

    next(error);
  }
};

/**
 * @desc    Get account transactions
 * @route   GET /api/accounts/:accountId/transactions
 * @access  Private
 */
const getAccountTransactions = async (req, res, next) => {
  try {
    const { accountId } = req.params;
    const { page = 1, limit = 10, type } = req.query;

    // Ensure account belongs to user
    const account = await Account.findOne({
      _id: accountId,
      user: req.user._id,
    });

    if (!account) {
      throw new CustomError(404, "Account not found");
    }

    // Build query to find transactions involving this account
    const query = {
      user: req.user._id,
      $or: [
        { sourceId: accountId, sourceType: "account" },
        { destinationId: accountId, destinationType: "account" },
      ],
    };

    // Add type filter if provided
    if (type) {
      query.type = type;
    }

    // Execute query with pagination
    const options = {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      sort: { createdAt: -1 },
    };

    const transactions = await AccountTransaction.paginate(query, options);

    res.status(200).json({
      status: "Success",
      success: true,
      data: {
        transactions,
      },
    });
  } catch (error) {
    logger.error("Error fetching account transactions:", {
      error: error.message,
      userId: req.user?._id,
      requestId: req.id,
    });

    next(error);
  }
};

/**
 * @desc    Create a new account
 * @route   POST /api/accounts
 * @access  Private
 */
const createAccount = async (req, res, next) => {
  try {
    const { accountName, accountType, currency = "USD" } = req.body;

    if (!accountName || !accountType) {
      return res.status(400).json({
        success: false,
        error: "Account name and type are required.",
      });
    }

    const newAccount = new Account({
      accountName,
      accountType,
      currency,
      user: req.user._id,
      availableBalance: mongoose.Types.Decimal128.fromString("0.00"),
      isActive: true,
    });

    const savedAccount = await newAccount.save();

    res.status(201).json({
      status: "Success",
      success: true,
      data: {
        account: savedAccount,
      },
    });
  } catch (error) {
    logger.error("Create Account Error:", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
      ip: req.ip,
      timestamp: new Date().toISOString(),
    });
    next(error);
  }
};

/**
 * @desc    Update an existing account
 * @route   PUT /api/accounts/:accountId
 * @access  Private
 */
const updateAccount = async (req, res, next) => {
  try {
    const { accountId } = req.params;
    const updateData = req.body;

    // Prevent updating critical fields
    delete updateData.availableBalance;
    delete updateData.user;
    delete updateData.currency; // Typically wouldn't allow currency changes

    const updatedAccount = await Account.findOneAndUpdate(
      { _id: accountId, user: req.user._id },
      updateData,
      { new: true }
    );

    if (!updatedAccount) {
      throw new CustomError(404, "Account not found");
    }

    res.status(200).json({
      status: "Success",
      success: true,
      data: {
        account: updatedAccount,
      },
    });
  } catch (error) {
    logger.error("Update Account Error:", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
      ip: req.ip,
      timestamp: new Date().toISOString(),
    });
    next(error);
  }
};

/**
 * @desc    External account transfer
 * @route   POST /api/accounts/external-transfer
 * @access  Private
 */
const externalTransfer = async (req, res, next) => {
  // Start logging - capture initial request data
  logger.info("External transfer request initiated", {
    userId: req.user._id,
    requestId: req.id,
    requestBody: {
      type: req.body.type,
      amount: req.body.amount,
      sourceId: req.body.sourceId,
      sourceType: req.body.sourceType,
      sourceCurrency: req.body.sourceCurrency,
      destinationId: req.body.destinationId,
      destinationType: req.body.destinationType,
      destinationCurrency: req.body.destinationCurrency,
      description: req.body.description,
      metadata: req.body.metadata,
      narration: req.body.narration,
    },
    timestamp: new Date().toISOString(),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      type,
      amount,
      sourceId,
      sourceType,
      sourceCurrency,
      destinationId,
      destinationType,
      destinationCurrency,
      description = "External account transfer",
      metadata = {},
      narration,
    } = req.body;

    // Validate required fields
    if (
      !type ||
      !amount ||
      !sourceId ||
      !sourceType ||
      !destinationId ||
      !destinationType
    ) {
      logger.warn("Validation failed: Missing required fields", {
        userId: req.user._id,
        requestId: req.id,
        timestamp: new Date().toISOString(),
      });
      throw new CustomError(
        400,
        "Please provide all required transfer details"
      );
    }

    // Convert amount to Decimal128 for precise calculations
    const decimalAmount = mongoose.Types.Decimal128.fromString(
      amount.toString()
    );

    // Ensure that the source account belongs to the user if it's an account
    if (sourceType === "account") {
      const sourceAccount = await Account.findOne({
        _id: sourceId,
        user: req.user._id,
      }).session(session);

      if (!sourceAccount) {
        logger.warn("Source account not found or doesn't belong to user", {
          userId: req.user._id,
          requestId: req.id,
          sourceId,
          timestamp: new Date().toISOString(),
        });
        throw new CustomError(404, "Source account not found");
      }

      // Check if source account has sufficient balance
      if (
        parseFloat(sourceAccount.availableBalance.toString()) <
        parseFloat(decimalAmount.toString())
      ) {
        logger.warn("Insufficient funds in source account", {
          userId: req.user._id,
          requestId: req.id,
          sourceAccountId: sourceAccount._id,
          sourceAccountBalance: sourceAccount.availableBalance.toString(),
          transferAmount: decimalAmount.toString(),
          difference: (
            parseFloat(decimalAmount.toString()) -
            parseFloat(sourceAccount.availableBalance.toString())
          ).toFixed(8),
          timestamp: new Date().toISOString(),
        });
        throw new CustomError(400, "Insufficient funds in source account");
      }

      // Deduct from source account
      const oldFromAccountBalance = sourceAccount.availableBalance.toString();
      sourceAccount.availableBalance = mongoose.Types.Decimal128.fromString(
        (
          parseFloat(sourceAccount.availableBalance.toString()) -
          parseFloat(decimalAmount.toString())
        ).toFixed(8)
      );

      logger.debug("Updating source account balance", {
        userId: req.user._id,
        requestId: req.id,
        sourceAccountId: sourceAccount._id,
        oldBalance: oldFromAccountBalance,
        amountDeducted: decimalAmount.toString(),
        newBalance: sourceAccount.availableBalance.toString(),
        timestamp: new Date().toISOString(),
      });

      await sourceAccount.save({ session });
    }

    // For external transfers, we may not have direct access to update the destination
    // This would typically involve an API call to an external service
    // For this example, we'll just log the intent and create a transaction record

    logger.info("Processing external transfer to destination", {
      userId: req.user._id,
      requestId: req.id,
      destinationType,
      destinationId,
      destinationCurrency,
      amount: decimalAmount.toString(),
      timestamp: new Date().toISOString(),
    });

    // Here you would typically make an API call to an external service
    // to complete the transfer to the external destination

    // Create transaction record
    const reference = `EXT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const transaction = new AccountTransaction({
      user: req.user._id,
      type,
      amount: decimalAmount,
      currency: sourceCurrency || "USD",
      sourceId,
      sourceType,
      destinationId,
      destinationType,
      destinationCurrency: destinationCurrency || "USD",
      description,
      metadata,
      narration,
      status: "processing", // External transfers may need further processing
      reference,
    });

    logger.debug("Creating transaction record", {
      userId: req.user._id,
      requestId: req.id,
      transactionReference: reference,
      transactionDetails: {
        type,
        amount: decimalAmount.toString(),
        sourceCurrency,
        sourceId,
        sourceType,
        destinationId,
        destinationType,
        destinationCurrency,
        description,
        status: "processing",
      },
      timestamp: new Date().toISOString(),
    });

    await transaction.save({ session });

    logger.debug("Committing database transaction", {
      userId: req.user._id,
      requestId: req.id,
      reference,
      timestamp: new Date().toISOString(),
    });

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("External transfer initiated successfully", {
      userId: req.user._id,
      requestId: req.id,
      transactionReference: reference,
      amount: decimalAmount.toString(),
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      status: "success",
      message: "External transfer initiated successfully",
      reference,
      success: true,
      data: transaction,
    });
  } catch (error) {
    // Abort transaction if error occurs
    logger.error("Aborting database transaction due to error", {
      userId: req.user?._id,
      requestId: req.id,
      errorMessage: error.message,
      errorStack: error.stack,
      timestamp: new Date().toISOString(),
    });

    await session.abortTransaction();
    session.endSession();

    logger.error("External transfer failed:", {
      error: error.message,
      errorCode: error.code || error.statusCode,
      errorStack: error.stack,
      userId: req.user?._id,
      requestId: req.id,
      requestBody: req.body,
      timestamp: new Date().toISOString(),
    });

    next(error);
  }
};
