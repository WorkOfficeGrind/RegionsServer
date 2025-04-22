const Transaction = require("../models/Transaction");
const Account = require("../models/Account");
const Card = require("../models/Card");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const { logger, transactionLogger } = require("../config/logger");
const apiResponse = require("../utils/apiResponse");
const config = require("../config/config");
const mongoose = require("mongoose");
const crypto = require("crypto");
const { toUSDrates, fromUSDrates } = require("../utils/constants");
const notificationService = require("../services/notificationService");

/**
 * @desc    Execute a currency conversion
 * @param {mongoose.Types.Decimal128} amount - Amount to convert
 * @param {string} fromCurrency - Source currency
 * @param {string} toCurrency - Destination currency
 * @returns {Promise<mongoose.Types.Decimal128>} - Converted amount
 */
const convertCurrency = async (amount, fromCurrency, toCurrency) => {
  // If currencies are the same, no conversion needed
  if (fromCurrency === toCurrency) {
    return amount;
  }

  // In a real-world scenario, you would call an external API or use a service
  // like CoinGecko, CoinMarketCap, or a forex API to get real-time exchange rates

  // For this implementation, using a simplified approach with hardcoded rates
  // You should replace this with a proper exchange rate service in production

  // Convert amount to USD first (as an intermediate currency)
  const toUSD = await convertToUSD(amount, fromCurrency);

  // If destination is USD, return the USD amount
  if (toCurrency === "USD") {
    return toUSD;
  }

  // Otherwise convert from USD to destination currency
  return await convertFromUSD(toUSD, toCurrency);
};

/**
 * @desc    Convert given amount to USD
 * @param {mongoose.Types.Decimal128} amount - Amount to convert
 * @param {string} currency - Source currency
 * @returns {Promise<mongoose.Types.Decimal128>} - Converted amount in USD
 */
const convertToUSD = async (amount, currency) => {
  if (currency === "USD") {
    return amount;
  }

  // Sample exchange rates to USD (these should come from an API in production)

  // Check if we have a rate for this currency
  if (!toUSDrates[currency]) {
    throw new Error(`Unsupported currency for conversion: ${currency}`);
  }

  // Convert to USD
  const amountFloat = parseFloat(amount.toString());
  const usdValue = amountFloat * toUSDrates[currency];

  return mongoose.Types.Decimal128.fromString(usdValue.toFixed(8));
};

/**
 * @desc    Convert USD amount to specified currency
 * @param {mongoose.Types.Decimal128} usdAmount - Amount in USD
 * @param {string} currency - Target currency
 * @returns {Promise<mongoose.Types.Decimal128>} - Converted amount
 */
const convertFromUSD = async (usdAmount, currency) => {
  if (currency === "USD") {
    return usdAmount;
  }

  // Sample exchange rates from USD (inverse of the rates in convertToUSD)

  // Check if we have a rate for this currency
  if (!fromUSDrates[currency]) {
    throw new Error(`Unsupported currency for conversion: ${currency}`);
  }

  // Convert from USD to target currency
  const usdFloat = parseFloat(usdAmount.toString());
  const convertedValue = usdFloat * fromUSDrates[currency];

  return mongoose.Types.Decimal128.fromString(convertedValue.toFixed(8));
};

/**
 * Generate a unique transaction reference
 * @returns {string} - Unique reference string
 */
const generateTransactionReference = (sourceType, destinationType) => {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000);
  return `${sourceType.substring(0, 1)}2${destinationType.substring(
    0,
    1
  )}-${timestamp}-${random}`;
};

/**
 * @desc    Transfer funds between accounts (same or different currencies)
 * @route   POST /api/accounts/transfer
 * @access  Private
 */
exports.transferBetweenAccounts = async (req, res) => {
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

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Source and destination accounts cannot be the same",
        "SAME_ACCOUNT_ERROR"
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

    // Find source based on type
    if (sourceType === "Account") {
      source = await Account.findOne({
        accountNumber: sourceId,
        user: req.user._id,
      })
        .populate("user")
        .session(session);
    } else if (sourceType === "Card") {
      source = await Card.findOne({
        number: sourceId,
        user: req.user._id,
      })
        .populate("user")
        .session(session);
    } else if (sourceType === "Wallet") {
      source = await Wallet.findOne({
        address: sourceId,
        user: req.user._id,
      })
        .populate("user")
        .session(session);
    }

    if (!source) {
      logger.warn("Source not found", {
        userId: req.user._id,
        requestId: req.id,
        sourceId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Source not found",
        "SOURCE_NOT_FOUND"
      );
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

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Insufficient funds in source",
        "INSUFFICIENT_FUNDS"
      );
    }

    // Find destination based on type
    if (destinationType === "Account") {
      destination = await Account.findOne({
        accountNumber: destinationId,
      })
        .populate("user")
        .session(session);
    } else if (destinationType === "Card") {
      destination = await Card.findOne({
        number: destinationId,
      })
        .populate("user")
        .session(session);
    } else if (destinationType === "Wallet") {
      destination = await Wallet.findOne({
        address: destinationId,
      })
        .populate("user")
        .session(session);
    }

    if (!destination) {
      logger.warn("Destination not found", {
        userId: req.user._id,
        requestId: req.id,
        destinationId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Destination account not found",
        "DESTINATION_NOT_FOUND"
      );
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

    // Generate entity names for reference
    const getEntityName = (entity, entityType) => {
      return entity.name || `Unknown ${entityType}`;
    };

    // Generate a shared reference for both transactions
    const sourceEntityName = getEntityName(source, sourceType);
    const destinationEntityName = getEntityName(destination, destinationType);

    const sharedReference = `ACTR FRM ${sourceEntityName} TO ${destinationEntityName}-${Date.now()}-${Math.floor(
      Math.random() * 1000
    )}`;

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
      source.balance = mongoose.Types.Decimal128.fromString(
        (
          parseFloat(source.balance.toString()) -
          parseFloat(decimalAmount.toString())
        ).toFixed(8)
      );
    }

    logger.debug("Updating Source balance", {
      userId: req.user._id,
      requestId: req.id,
      sourceId: source._id,
      oldBalance: oldSourceBalance,
      amountDeducted: decimalAmount.toString(),
      newBalance:
        sourceType === "Account"
          ? source.availableBalance.toString()
          : source.balance.toString(),
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
      destination.balance = mongoose.Types.Decimal128.fromString(
        (
          parseFloat(destination.balance.toString()) +
          parseFloat(convertedAmount.toString())
        ).toFixed(8)
      );
    }

    logger.debug("Updating Destination balance", {
      userId: req.user._id,
      requestId: req.id,
      destinationId: destination._id,
      oldBalance: oldDestinationBalance,
      amountAdded: convertedAmount.toString(),
      newBalance:
        destinationType === "Account"
          ? destination.availableBalance.toString()
          : destination.balance.toString(),
      timestamp: new Date().toISOString(),
    });

    await destination.save({ session });

    // Create Debit transaction for the source
    const debitTransaction = new Transaction({
      user: req.user._id,
      type: "debit",
      amount: decimalAmount,
      source: source._id,
      sourceType,
      sourceCurrency: source.currency,
      sourceUser: source.user._id,
      destination: destination._id,
      destinationType,
      destinationCurrency: destination.currency,
      beneficiary: destination.user._id,
      conversionRate:
        source.currency !== destination.currency
          ? parseFloat(convertedAmount.toString()) /
            parseFloat(decimalAmount.toString())
          : 1,
      description: description || "Account transfer (debit)",
      status: "completed",
      reference: sharedReference,
      metadata,
      narration,
      processedAt: new Date(),
    });

    // Create Credit transaction for the destination
    const creditTransaction = new Transaction({
      user: destination.user._id,
      type: "credit",
      amount: convertedAmount,
      source: source._id,
      sourceType,
      sourceCurrency: source.currency,
      sourceUser: source.user._id,
      destination: destination._id,
      destinationType,
      destinationCurrency: destination.currency,
      beneficiary: destination.user._id,
      conversionRate:
        source.currency !== destination.currency
          ? parseFloat(convertedAmount.toString()) /
            parseFloat(decimalAmount.toString())
          : 1,
      description: description || "Account transfer (credit)",
      status: "completed",
      reference: sharedReference,
      metadata,
      narration,
      processedAt: new Date(),
    });

    // Save both transactions within the same session
    await debitTransaction.save({ session });
    await creditTransaction.save({ session });

    logger.debug("Transactions created", {
      userId: req.user._id,
      requestId: req.id,
      debitTransactionId: debitTransaction._id,
      creditTransactionId: creditTransaction._id,
      sourceUserId: source.user._id,
      beneficiaryUserId: destination.user._id,
      reference: sharedReference,
      timestamp: new Date().toISOString(),
    });

    // Add transaction IDs to the respective accounts
    if (!source.transactions) {
      source.transactions = [];
    }
    source.transactions.push(debitTransaction._id);
    await source.save({ session });

    logger.debug("Added debit transaction to source", {
      userId: req.user._id,
      requestId: req.id,
      sourceId: source._id,
      transactionId: debitTransaction._id,
      timestamp: new Date().toISOString(),
    });

    if (!destination.transactions) {
      destination.transactions = [];
    }
    destination.transactions.push(creditTransaction._id);
    await destination.save({ session });

    logger.debug("Added credit transaction to destination", {
      userId: req.user._id,
      requestId: req.id,
      destinationId: destination._id,
      transactionId: creditTransaction._id,
      timestamp: new Date().toISOString(),
    });

    // Create notification for sender
    // await notificationService.createNotification(
    //   req.user._id,
    //   "Transfer Completed",
    //   `Your transfer of ${decimalAmount.toString()} ${
    //     source.currency
    //   } to ${destinationEntityName} has been completed.`,
    //   "transaction",
    //   {
    //     transactionId: debitTransaction._id,
    //     reference: sharedReference,
    //     type: "debit",
    //   },
    //   session
    // );

    // Create notification for recipient if it's a different user
    // if (source.user._id.toString() !== destination.user._id.toString()) {
    //   await notificationService.createNotification(
    //     destination.user._id,
    //     "Transfer Received",
    //     `You have received ${convertedAmount.toString()} ${
    //       destination.currency
    //     } from ${sourceEntityName}.`,
    //     "transaction",
    //     {
    //       transactionId: creditTransaction._id,
    //       reference: sharedReference,
    //       type: "credit",
    //     },
    //     session
    //   );
    // }

    logger.debug("Committing database transaction", {
      userId: req.user._id,
      requestId: req.id,
      reference: sharedReference,
      timestamp: new Date().toISOString(),
    });

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Transfer completed successfully", {
      userId: req.user._id,
      requestId: req.id,
      transactionReference: sharedReference,
      amount: decimalAmount.toString(),
      fromCurrency: source.currency,
      toCurrency: destination.currency,
      timestamp: new Date().toISOString(),
    });

    // Return both transactions in the response
    return apiResponse.success(
      res,
      200,
      "Transfer Successful",
      "Transfer completed successfully",
      {
        debitTransaction,
        creditTransaction,
        sourceType,
        destinationType,
        amount: decimalAmount.toString(),
        convertedAmount: convertedAmount.toString(),
        reference: sharedReference,
      }
    );
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

    return apiResponse.error(
      res,
      500,
      "Transfer Failed",
      "An error occurred while processing your transfer",
      "TRANSFER_ERROR"
    );
  }
};

/**
 * @desc    Transfer between wallets (same or different currencies)
 * @route   POST /api/wallets/transfer/wallet
 * @access  Private
 */
exports.transferWalletToWallet = async (req, res) => {
  // Start logging
  logger.info("Wallet-to-wallet transfer request initiated", {
    userId: req.user._id,
    requestId: req.id,
    requestBody: {
      amount: req.body.amount,
      sourceWalletId: req.body.sourceWalletId,
      sourceCurrency: req.body.sourceCurrency,
      destinationWalletId: req.body.destinationWalletId,
      destinationCurrency: req.body.destinationCurrency,
      description: req.body.description,
      metadata: req.body.metadata,
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
      amount,
      sourceWalletId,
      destinationWalletId,
      description,
      metadata,
    } = req.body;

    // Validate source and destination are different
    if (sourceWalletId === destinationWalletId) {
      logger.warn("Validation failed: Same source & destination wallets", {
        userId: req.user._id,
        requestId: req.id,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Invalid Request",
        "Source and destination wallets cannot be the same",
        "SAME_WALLET_ERROR"
      );
    }

    // Convert amount to Decimal128 for precise calculations
    const decimalAmount = mongoose.Types.Decimal128.fromString(
      amount.toString()
    );

    // Log wallet lookup
    logger.debug("Looking up wallets", {
      userId: req.user._id,
      requestId: req.id,
      sourceWalletId,
      destinationWalletId,
      timestamp: new Date().toISOString(),
    });

    // Find source wallet
    const sourceWallet = await Wallet.findOne({
      _id: sourceWalletId,
      user: req.user._id,
    })
      .populate("user")
      .session(session);

    if (!sourceWallet) {
      logger.warn("Source wallet not found", {
        userId: req.user._id,
        requestId: req.id,
        sourceWalletId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Invalid Request",
        "Source wallet not found",
        "SOURCE_WALLET_NOT_FOUND"
      );
    }

    // Check if source wallet has sufficient balance
    if (
      parseFloat(sourceWallet.balance.toString()) <
      parseFloat(decimalAmount.toString())
    ) {
      logger.warn("Insufficient funds in source wallet", {
        userId: req.user._id,
        requestId: req.id,
        sourceWalletId: sourceWallet._id,
        sourceBalance: sourceWallet.balance.toString(),
        transferAmount: decimalAmount.toString(),
        difference: (
          parseFloat(decimalAmount.toString()) -
          parseFloat(sourceWallet.balance.toString())
        ).toFixed(8),
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Insufficient Funds",
        "Insufficient funds in source wallet",
        "INSUFFICIENT_WALLET_FUNDS"
      );
    }

    // Check transaction limits
    const limitCheck = sourceWallet.checkTransactionLimits(
      parseFloat(decimalAmount.toString())
    );
    if (!limitCheck.allowed) {
      logger.warn("Transaction limit exceeded", {
        userId: req.user._id,
        requestId: req.id,
        sourceWalletId: sourceWallet._id,
        reason: limitCheck.reason,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Limit Exceeded",
        limitCheck.reason,
        "TRANSACTION_LIMIT_EXCEEDED"
      );
    }

    // Find destination wallet (no user restriction on destination)
    const destinationWallet = await Wallet.findOne({
      _id: destinationWalletId,
    })
      .populate("user")
      .session(session);

    if (!destinationWallet) {
      logger.warn("Destination wallet not found", {
        userId: req.user._id,
        requestId: req.id,
        destinationWalletId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Invalid Request",
        "Destination wallet not found",
        "DESTINATION_WALLET_NOT_FOUND"
      );
    }

    // Currency conversion check
    logger.debug("Currency conversion check", {
      userId: req.user._id,
      requestId: req.id,
      fromCurrency: sourceWallet.currency,
      toCurrency: destinationWallet.currency,
      beforeConversion: decimalAmount.toString(),
      timestamp: new Date().toISOString(),
    });

    // Convert amount to destination wallet currency if different
    const convertedAmount = await convertCurrency(
      decimalAmount,
      sourceWallet.currency,
      destinationWallet.currency
    );

    logger.debug("After currency conversion", {
      userId: req.user._id,
      requestId: req.id,
      fromCurrency: sourceWallet.currency,
      toCurrency: destinationWallet.currency,
      beforeConversion: decimalAmount.toString(),
      afterConversion: convertedAmount.toString(),
      conversionRate: (
        parseFloat(convertedAmount.toString()) /
        parseFloat(decimalAmount.toString())
      ).toFixed(8),
      timestamp: new Date().toISOString(),
    });

    // Generate a shared reference for transactions
    const sharedReference = generateTransactionReference("Wallet", "Wallet");

    // Store old balances for logging
    const oldSourceBalance = sourceWallet.balance.toString();
    const oldDestinationBalance = destinationWallet.balance.toString();

    // Deduct from source wallet
    sourceWallet.balance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(sourceWallet.balance.toString()) -
        parseFloat(decimalAmount.toString())
      ).toFixed(8)
    );

    logger.debug("Updating Source wallet balance", {
      userId: req.user._id,
      requestId: req.id,
      sourceWalletId: sourceWallet._id,
      oldBalance: oldSourceBalance,
      amountDeducted: decimalAmount.toString(),
      newBalance: sourceWallet.balance.toString(),
      timestamp: new Date().toISOString(),
    });

    await sourceWallet.save({ session });

    // Add to destination wallet
    destinationWallet.balance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(destinationWallet.balance.toString()) +
        parseFloat(convertedAmount.toString())
      ).toFixed(8)
    );

    logger.debug("Updating Destination wallet balance", {
      userId: req.user._id,
      requestId: req.id,
      destinationWalletId: destinationWallet._id,
      oldBalance: oldDestinationBalance,
      amountAdded: convertedAmount.toString(),
      newBalance: destinationWallet.balance.toString(),
      timestamp: new Date().toISOString(),
    });

    await destinationWallet.save({ session });

    // Calculate conversion rate
    const conversionRate =
      sourceWallet.currency !== destinationWallet.currency
        ? parseFloat(convertedAmount.toString()) /
          parseFloat(decimalAmount.toString())
        : 1;

    // Create WalletTransaction for source (debit)
    const debitTransaction = new WalletTransaction({
      user: req.user._id,
      type: "debit",
      amount: decimalAmount,
      currency: sourceWallet.currency,
      source: sourceWallet._id,
      sourceType: "Wallet",
      sourceCurrency: sourceWallet.currency,
      beneficiary: destinationWallet._id,
      beneficiaryType: "Wallet",
      beneficiaryCurrency: destinationWallet.currency,
      conversionRate,
      description: description || "Wallet to wallet transfer (sent)",
      status: "completed",
      reference: `${sharedReference}-OUT`,
      metadata,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      completedAt: new Date(),
    });

    // Create WalletTransaction for destination (credit)
    const creditTransaction = new WalletTransaction({
      user: destinationWallet.user._id,
      type: "credit",
      amount: convertedAmount,
      currency: destinationWallet.currency,
      source: sourceWallet._id,
      sourceType: "Wallet",
      sourceCurrency: sourceWallet.currency,
      beneficiary: destinationWallet._id,
      beneficiaryType: "Wallet",
      beneficiaryCurrency: destinationWallet.currency,
      conversionRate,
      description: description || "Wallet to wallet transfer (received)",
      status: "completed",
      reference: `${sharedReference}-IN`,
      metadata,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      completedAt: new Date(),
    });

    // Save transactions
    await debitTransaction.save({ session });
    await creditTransaction.save({ session });

    logger.debug("Transactions created", {
      userId: req.user._id,
      requestId: req.id,
      debitTransactionId: debitTransaction._id,
      creditTransactionId: creditTransaction._id,
      reference: sharedReference,
      timestamp: new Date().toISOString(),
    });

    // Update wallet transaction lists
    if (!sourceWallet.transactions) {
      sourceWallet.transactions = [];
    }
    sourceWallet.transactions.push(debitTransaction._id);
    sourceWallet.lastActivityAt = new Date();
    await sourceWallet.save({ session });

    if (!destinationWallet.transactions) {
      destinationWallet.transactions = [];
    }
    destinationWallet.transactions.push(creditTransaction._id);
    destinationWallet.lastActivityAt = new Date();
    await destinationWallet.save({ session });

    // Create notification for sender
    // await notificationService.createNotification(
    //   req.user._id,
    //   "Wallet Transfer Completed",
    //   `Your wallet transfer of ${decimalAmount.toString()} ${
    //     sourceWallet.currency
    //   } has been completed.`,
    //   "transaction",
    //   {
    //     transactionId: debitTransaction._id,
    //     reference: sharedReference,
    //     type: "debit",
    //   },
    //   session
    // );

    // // Create notification for recipient if it's a different user
    // if (
    //   sourceWallet.user._id.toString() !== destinationWallet.user._id.toString()
    // ) {
    //   await notificationService.createNotification(
    //     destinationWallet.user._id,
    //     "Wallet Transfer Received",
    //     `You have received ${convertedAmount.toString()} ${
    //       destinationWallet.currency
    //     } in your wallet ${
    //       destinationWallet.name || destinationWallet.address
    //     }.`,
    //     "transaction",
    //     {
    //       transactionId: creditTransaction._id,
    //       reference: sharedReference,
    //       type: "credit",
    //     },
    //     session
    //   );
    // }

    logger.debug("Committing database transaction", {
      userId: req.user._id,
      requestId: req.id,
      reference: sharedReference,
      timestamp: new Date().toISOString(),
    });

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Wallet to wallet transfer completed successfully", {
      userId: req.user._id,
      requestId: req.id,
      transactionReference: sharedReference,
      amount: decimalAmount.toString(),
      convertedAmount: convertedAmount.toString(),
      fromCurrency: sourceWallet.currency,
      toCurrency: destinationWallet.currency,
      timestamp: new Date().toISOString(),
    });

    // Return the transactions in the response
    return apiResponse.success(
      res,
      200,
      "Swap Successful",
      "Wallet to wallet swap completed successfully",
      {
        debitTransaction,
        creditTransaction,
        amount: decimalAmount.toString(),
        convertedAmount: convertedAmount.toString(),
        reference: sharedReference,
      }
    );
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

    logger.error("Wallet to wallet transfer failed:", {
      error: error.message,
      errorCode: error.code || error.statusCode,
      errorStack: error.stack,
      userId: req.user?._id,
      requestId: req.id,
      requestBody: req.body,
      timestamp: new Date().toISOString(),
    });

    return apiResponse.error(
      res,
      500,
      "Transfer Failed",
      "An error occurred during wallet to wallet transfer",
      "WALLET_TRANSFER_ERROR"
    );
  }
};

/**
 * @desc    Transfer from wallet to account
 * @route   POST /api/wallets/transfer/account
 * @access  Private
 */
exports.transferWalletToAccount = async (req, res) => {
  // Start logging
  logger.info("Wallet-to-account transfer request initiated", {
    userId: req.user._id,
    requestId: req.id,
    requestBody: {
      amount: req.body.amount,
      sourceWalletId: req.body.sourceWalletId,
      sourceCurrency: req.body.sourceCurrency,
      destinationAccountId: req.body.destinationAccountId,
      description: req.body.description,
      metadata: req.body.metadata,
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
      amount,
      sourceWalletId,
      destinationAccountId,
      description,
      metadata,
    } = req.body;

    // Convert amount to Decimal128 for precise calculations
    const decimalAmount = mongoose.Types.Decimal128.fromString(
      amount.toString()
    );

    // Log lookup attempt
    logger.debug("Looking up wallet and account", {
      userId: req.user._id,
      requestId: req.id,
      sourceWalletId,
      destinationAccountId,
      timestamp: new Date().toISOString(),
    });

    // Find source wallet
    const sourceWallet = await Wallet.findOne({
      _id: sourceWalletId,
      user: req.user._id,
    })
      .populate("user")
      .session(session);

    if (!sourceWallet) {
      logger.warn("Source wallet not found", {
        userId: req.user._id,
        requestId: req.id,
        sourceWalletId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Invalid Request",
        "Source wallet not found",
        "SOURCE_WALLET_NOT_FOUND"
      );
    }

    // Check if source wallet has sufficient balance
    if (
      parseFloat(sourceWallet.balance.toString()) <
      parseFloat(decimalAmount.toString())
    ) {
      logger.warn("Insufficient funds in source wallet", {
        userId: req.user._id,
        requestId: req.id,
        sourceWalletId: sourceWallet._id,
        sourceBalance: sourceWallet.balance.toString(),
        transferAmount: decimalAmount.toString(),
        difference: (
          parseFloat(decimalAmount.toString()) -
          parseFloat(sourceWallet.balance.toString())
        ).toFixed(8),
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Insufficient Funds",
        "Insufficient funds in source wallet",
        "INSUFFICIENT_WALLET_FUNDS"
      );
    }

    // Check transaction limits
    const limitCheck = sourceWallet.checkTransactionLimits(
      parseFloat(decimalAmount.toString())
    );
    if (!limitCheck.allowed) {
      logger.warn("Transaction limit exceeded", {
        userId: req.user._id,
        requestId: req.id,
        sourceWalletId: sourceWallet._id,
        reason: limitCheck.reason,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Limit Exceeded",
        limitCheck.reason,
        "TRANSACTION_LIMIT_EXCEEDED"
      );
    }

    // Find destination account (notice we're looking for id not accountNumber here)
    const destinationAccount = await Account.findOne({
      _id: destinationAccountId,
    })
      .populate("user")
      .session(session);

    if (!destinationAccount) {
      logger.warn("Destination account not found", {
        userId: req.user._id,
        requestId: req.id,
        destinationAccountId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Invalid Request",
        "Destination account not found",
        "DESTINATION_ACCOUNT_NOT_FOUND"
      );
    }

    // Currency conversion check (accounts are always in USD)
    logger.debug("Currency conversion check", {
      userId: req.user._id,
      requestId: req.id,
      fromCurrency: sourceWallet.currency,
      toCurrency: "USD",
      beforeConversion: decimalAmount.toString(),
      timestamp: new Date().toISOString(),
    });

    // Convert amount to USD since accounts are in USD
    const convertedAmount = await convertCurrency(
      decimalAmount,
      sourceWallet.currency,
      "USD"
    );

    logger.debug("After currency conversion", {
      userId: req.user._id,
      requestId: req.id,
      fromCurrency: sourceWallet.currency,
      toCurrency: "USD",
      beforeConversion: decimalAmount.toString(),
      afterConversion: convertedAmount.toString(),
      conversionRate: (
        parseFloat(convertedAmount.toString()) /
        parseFloat(decimalAmount.toString())
      ).toFixed(8),
      timestamp: new Date().toISOString(),
    });

    // Generate a shared reference for transactions
    const sharedReference = generateTransactionReference("Wallet", "Account");

    // Store old balances for logging
    const oldSourceBalance = sourceWallet.balance.toString();
    const oldDestinationBalance =
      destinationAccount.availableBalance.toString();

    // Deduct from source wallet
    sourceWallet.balance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(sourceWallet.balance.toString()) -
        parseFloat(decimalAmount.toString())
      ).toFixed(8)
    );

    logger.debug("Updating Source wallet balance", {
      userId: req.user._id,
      requestId: req.id,
      sourceWalletId: sourceWallet._id,
      oldBalance: oldSourceBalance,
      amountDeducted: decimalAmount.toString(),
      newBalance: sourceWallet.balance.toString(),
      timestamp: new Date().toISOString(),
    });

    await sourceWallet.save({ session });

    // Add to destination account
    destinationAccount.availableBalance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(destinationAccount.availableBalance.toString()) +
        parseFloat(convertedAmount.toString())
      ).toFixed(8)
    );

    // Update ledger balance too
    destinationAccount.ledgerBalance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(destinationAccount.ledgerBalance.toString()) +
        parseFloat(convertedAmount.toString())
      ).toFixed(8)
    );

    logger.debug("Updating Destination account balance", {
      userId: req.user._id,
      requestId: req.id,
      destinationAccountId: destinationAccount._id,
      oldBalance: oldDestinationBalance,
      amountAdded: convertedAmount.toString(),
      newBalance: destinationAccount.availableBalance.toString(),
      timestamp: new Date().toISOString(),
    });

    await destinationAccount.save({ session });

    // Calculate conversion rate
    const conversionRate =
      sourceWallet.currency !== "USD"
        ? parseFloat(convertedAmount.toString()) /
          parseFloat(decimalAmount.toString())
        : 1;

    // Create WalletTransaction for source wallet (debit)
    const debitTransaction = new WalletTransaction({
      user: req.user._id,
      type: "debit",
      amount: decimalAmount,
      currency: sourceWallet.currency,
      source: sourceWallet._id,
      sourceType: "Wallet",
      sourceCurrency: sourceWallet.currency,
      sourceUser: sourceWallet.user._id,
      beneficiary: destinationAccount._id,
      beneficiaryType: "Account",
      beneficiaryCurrency: "USD",
      conversionRate,
      description: description || "Wallet to account transfer (debit)",
      status: "completed",
      reference: sharedReference,
      metadata,
      processedAt: new Date(),
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    // Create Transaction for destination account (credit)
    const creditTransaction = new Transaction({
      user: destinationAccount.user._id,
      type: "credit",
      amount: convertedAmount,
      source: sourceWallet._id,
      sourceType: "Wallet",
      sourceCurrency: sourceWallet.currency,
      sourceUser: sourceWallet.user._id,
      destination: destinationAccount._id,
      destinationType: "Account",
      destinationCurrency: "USD",
      beneficiary: destinationAccount.user._id,
      conversionRate,
      description: description || "Wallet to account transfer (credit)",
      status: "completed",
      reference: sharedReference,
      metadata,
      processedAt: new Date(),
    });

    // Save all transactions
    await debitTransaction.save({ session });
    await creditTransaction.save({ session });

    logger.debug("Transactions created", {
      userId: req.user._id,
      requestId: req.id,
      debitTransactionId: debitTransaction._id,
      creditTransactionId: creditTransaction._id,
      reference: sharedReference,
      timestamp: new Date().toISOString(),
    });

    // Update transaction lists
    if (!sourceWallet.transactions) {
      sourceWallet.transactions = [];
    }
    sourceWallet.transactions.push(debitTransaction._id);
    sourceWallet.lastActivityAt = new Date();
    await sourceWallet.save({ session });

    if (!destinationAccount.transactions) {
      destinationAccount.transactions = [];
    }
    destinationAccount.transactions.push(creditTransaction._id);
    await destinationAccount.save({ session });

    // Create notification for source wallet owner
    // await notificationService.createNotification(
    //   sourceWallet.user._id,
    //   "Wallet Withdrawal Completed",
    //   `Your withdrawal of ${decimalAmount.toString()} ${
    //     sourceWallet.currency
    //   } from your wallet to account has been completed.`,
    //   "transaction",
    //   {
    //     transactionId: debitTransaction._id,
    //     reference: sharedReference,
    //     type: "withdrawal",
    //   },
    //   session
    // );

    // // If destination account belongs to different user, create notification for them too
    // if (
    //   sourceWallet.user._id.toString() !==
    //   destinationAccount.user._id.toString()
    // ) {
    //   await notificationService.createNotification(
    //     destinationAccount.user._id,
    //     "Account Deposit Received",
    //     `You have received ${convertedAmount.toString()} USD in your account from wallet transfer.`,
    //     "transaction",
    //     {
    //       transactionId: creditTransaction._id,
    //       reference: sharedReference,
    //       type: "deposit",
    //     },
    //     session
    //   );
    // }

    logger.debug("Committing database transaction", {
      userId: req.user._id,
      requestId: req.id,
      reference: sharedReference,
      timestamp: new Date().toISOString(),
    });

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Wallet to account transfer completed successfully", {
      userId: req.user._id,
      requestId: req.id,
      transactionReference: sharedReference,
      amount: decimalAmount.toString(),
      convertedAmount: convertedAmount.toString(),
      fromCurrency: sourceWallet.currency,
      toCurrency: "USD",
      timestamp: new Date().toISOString(),
    });

    // Return the transactions in the response
    return apiResponse.success(
      res,
      200,
      "Withdrawal Successful",
      "Wallet to account withdrawal completed successfully",
      {
        debitTransaction,
        creditTransaction,
        amount: decimalAmount.toString(),
        convertedAmount: convertedAmount.toString(),
        reference: sharedReference,
      }
    );
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

    logger.error("Wallet to account transfer failed:", {
      error: error.message,
      errorCode: error.code || error.statusCode,
      errorStack: error.stack,
      userId: req.user?._id,
      requestId: req.id,
      requestBody: req.body,
      timestamp: new Date().toISOString(),
    });

    return apiResponse.error(
      res,
      500,
      "Transfer Failed",
      "An error occurred during wallet to account transfer",
      "WALLET_TO_ACCOUNT_ERROR"
    );
  }
};

/**
 * @desc    Transfer from wallet to card
 * @route   POST /api/wallets/transfer/card
 * @access  Private
 */
exports.transferWalletToCard = async (req, res) => {
  // Start logging
  logger.info("Wallet-to-card transfer request initiated", {
    userId: req.user._id,
    requestId: req.id,
    requestBody: {
      amount: req.body.amount,
      sourceWalletId: req.body.sourceWalletId,
      sourceCurrency: req.body.sourceCurrency,
      destinationCardId: req.body.destinationCardId,
      description: req.body.description,
      metadata: req.body.metadata,
    },
    timestamp: new Date().toISOString(),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });

  // Start a database transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { amount, sourceWalletId, destinationCardId, description, metadata } =
      req.body;

    // Convert amount to Decimal128 for precise calculations
    const decimalAmount = mongoose.Types.Decimal128.fromString(
      amount.toString()
    );

    // Log lookup attempt
    logger.debug("Looking up wallet and card", {
      userId: req.user._id,
      requestId: req.id,
      sourceWalletId,
      destinationCardId,
      timestamp: new Date().toISOString(),
    });

    // Find source wallet
    const sourceWallet = await Wallet.findOne({
      _id: sourceWalletId,
      user: req.user._id,
    })
      .populate("user")
      .session(session);

    if (!sourceWallet) {
      logger.warn("Source wallet not found", {
        userId: req.user._id,
        requestId: req.id,
        sourceWalletId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Invalid Request",
        "Source wallet not found",
        "SOURCE_WALLET_NOT_FOUND"
      );
    }

    // Check if source wallet has sufficient balance
    if (
      parseFloat(sourceWallet.balance.toString()) <
      parseFloat(decimalAmount.toString())
    ) {
      logger.warn("Insufficient funds in source wallet", {
        userId: req.user._id,
        requestId: req.id,
        sourceWalletId: sourceWallet._id,
        sourceBalance: sourceWallet.balance.toString(),
        transferAmount: decimalAmount.toString(),
        difference: (
          parseFloat(decimalAmount.toString()) -
          parseFloat(sourceWallet.balance.toString())
        ).toFixed(8),
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Insufficient Funds",
        "Insufficient funds in source wallet",
        "INSUFFICIENT_WALLET_FUNDS"
      );
    }

    // Check transaction limits
    const limitCheck = sourceWallet.checkTransactionLimits(
      parseFloat(decimalAmount.toString())
    );
    if (!limitCheck.allowed) {
      logger.warn("Transaction limit exceeded", {
        userId: req.user._id,
        requestId: req.id,
        sourceWalletId: sourceWallet._id,
        reason: limitCheck.reason,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Limit Exceeded",
        limitCheck.reason,
        "TRANSACTION_LIMIT_EXCEEDED"
      );
    }

    // Find destination card (using _id)
    const destinationCard = await Card.findOne({
      _id: destinationCardId,
    })
      .populate("user")
      .session(session);

    if (!destinationCard) {
      logger.warn("Destination card not found", {
        userId: req.user._id,
        requestId: req.id,
        destinationCardId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Invalid Request",
        "Destination card not found",
        "DESTINATION_CARD_NOT_FOUND"
      );
    }

    // Check if the card is valid for receiving funds
    if (destinationCard.status !== "active") {
      logger.warn("Destination card is not active", {
        userId: req.user._id,
        requestId: req.id,
        destinationCardId: destinationCard._id,
        cardStatus: destinationCard.status,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Card Error",
        `Destination card is ${destinationCard.status}`,
        "CARD_NOT_ACTIVE"
      );
    }

    if (destinationCard.isExpired) {
      logger.warn("Destination card is expired", {
        userId: req.user._id,
        requestId: req.id,
        destinationCardId: destinationCard._id,
        expiryDate: destinationCard.expiryDate,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Card Error",
        "Destination card is expired",
        "CARD_EXPIRED"
      );
    }

    // Currency conversion check (cards are always in USD)
    logger.debug("Currency conversion check", {
      userId: req.user._id,
      requestId: req.id,
      fromCurrency: sourceWallet.currency,
      toCurrency: "USD",
      beforeConversion: decimalAmount.toString(),
      timestamp: new Date().toISOString(),
    });

    // Convert amount to USD since cards are in USD
    const convertedAmount = await convertCurrency(
      decimalAmount,
      sourceWallet.currency,
      "USD"
    );

    logger.debug("After currency conversion", {
      userId: req.user._id,
      requestId: req.id,
      fromCurrency: sourceWallet.currency,
      toCurrency: "USD",
      beforeConversion: decimalAmount.toString(),
      afterConversion: convertedAmount.toString(),
      conversionRate: (
        parseFloat(convertedAmount.toString()) /
        parseFloat(decimalAmount.toString())
      ).toFixed(8),
      timestamp: new Date().toISOString(),
    });

    // Generate a shared reference for transactions
    const sharedReference = generateTransactionReference("Wallet", "Card");

    // Store old balances for logging
    const oldSourceBalance = sourceWallet.balance.toString();
    // For cards, we need to check which balance field to use based on type
    const isDebitCard =
      destinationCard.type === "debit" || destinationCard.type === "prepaid";
    const oldDestinationBalance = isDebitCard
      ? destinationCard.availableBalance.toString()
      : destinationCard.ledgerBalance.toString();

    // Deduct from source wallet
    sourceWallet.balance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(sourceWallet.balance.toString()) -
        parseFloat(decimalAmount.toString())
      ).toFixed(8)
    );

    logger.debug("Updating Source wallet balance", {
      userId: req.user._id,
      requestId: req.id,
      sourceWalletId: sourceWallet._id,
      oldBalance: oldSourceBalance,
      amountDeducted: decimalAmount.toString(),
      newBalance: sourceWallet.balance.toString(),
      timestamp: new Date().toISOString(),
    });

    await sourceWallet.save({ session });

    // Add to destination card
    // The logic depends on the card type
    if (isDebitCard) {
      destinationCard.availableBalance = mongoose.Types.Decimal128.fromString(
        (
          parseFloat(destinationCard.availableBalance.toString()) +
          parseFloat(convertedAmount.toString())
        ).toFixed(8)
      );

      // Also update ledger balance for debit cards
      destinationCard.ledgerBalance = mongoose.Types.Decimal128.fromString(
        (
          parseFloat(destinationCard.ledgerBalance.toString()) +
          parseFloat(convertedAmount.toString())
        ).toFixed(8)
      );
    } else {
      // For credit cards, we're paying down the balance (reducing it)
      destinationCard.ledgerBalance = mongoose.Types.Decimal128.fromString(
        Math.max(
          0,
          parseFloat(destinationCard.ledgerBalance.toString()) -
            parseFloat(convertedAmount.toString())
        ).toFixed(8)
      );
    }

    // Update last used time
    destinationCard.lastUsedAt = new Date();

    logger.debug("Updating Destination card balance", {
      userId: req.user._id,
      requestId: req.id,
      destinationCardId: destinationCard._id,
      cardType: destinationCard.type,
      oldBalance: oldDestinationBalance,
      amountProcessed: convertedAmount.toString(),
      newBalance: isDebitCard
        ? destinationCard.availableBalance.toString()
        : destinationCard.ledgerBalance.toString(),
      timestamp: new Date().toISOString(),
    });

    await destinationCard.save({ session });

    // Calculate conversion rate
    const conversionRate =
      sourceWallet.currency !== "USD"
        ? parseFloat(convertedAmount.toString()) /
          parseFloat(decimalAmount.toString())
        : 1;

    // Create WalletTransaction for source (outgoing)
    const debitTransaction = new WalletTransaction({
      user: req.user._id,
      type: "debit",
      amount: decimalAmount,
      currency: sourceWallet.currency,
      source: sourceWallet._id,
      sourceType: "Wallet",
      sourceCurrency: sourceWallet.currency,
      beneficiary: destinationCard._id,
      beneficiaryType: "Card",
      beneficiaryCurrency: "USD",
      conversionRate,
      description: description || "Wallet to card transfer",
      status: "completed",
      reference: sharedReference,
      metadata,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      completedAt: new Date(),
    });

    // Create Transaction for destination card (credit)
    const creditTransaction = new Transaction({
      user: destinationCard.user._id,
      type: "credit",
      amount: convertedAmount,
      source: sourceWallet._id,
      sourceType: "Wallet",
      sourceCurrency: sourceWallet.currency,
      sourceUser: sourceWallet.user._id,
      destination: destinationCard._id,
      destinationType: "Card",
      destinationCurrency: "USD",
      beneficiary: destinationCard.user._id,
      conversionRate,
      description:
        description ||
        `Wallet to ${isDebitCard ? "debit" : "credit"} card transfer (credit)`,
      status: "completed",
      reference: sharedReference,
      metadata,
      processedAt: new Date(),
    });

    // Save all transactions
    await debitTransaction.save({ session });
    await creditTransaction.save({ session });

    logger.debug("Transactions created", {
      userId: req.user._id,
      requestId: req.id,
      debitTransactionId: debitTransaction._id,
      creditTransactionId: creditTransaction._id,
      reference: sharedReference,
      timestamp: new Date().toISOString(),
    });

    // Update transaction lists
    if (!sourceWallet.transactions) {
      sourceWallet.transactions = [];
    }
    sourceWallet.transactions.push(debitTransaction._id);
    sourceWallet.lastActivityAt = new Date();
    await sourceWallet.save({ session });

    if (!destinationCard.transactions) {
      destinationCard.transactions = [];
    }
    destinationCard.transactions.push(creditTransaction._id);
    await destinationCard.save({ session });

    // Create notification for the wallet owner
    // await notificationService.createNotification(
    //   sourceWallet.user._id,
    //   "Wallet to Card Transfer Completed",
    //   `Your transfer of ${decimalAmount.toString()} ${
    //     sourceWallet.currency
    //   } from wallet to ${
    //     isDebitCard ? "debit" : "credit"
    //   } card has been completed.`,
    //   "transaction",
    //   {
    //     transactionId: debitTransaction._id,
    //     reference: sharedReference,
    //     type: "wallet_to_card",
    //   },
    //   session
    // );

    // // If destination card belongs to a different user, notify them too
    // if (
    //   sourceWallet.user._id.toString() !== destinationCard.user._id.toString()
    // ) {
    //   const notificationMessage = isDebitCard
    //     ? `You have received ${convertedAmount.toString()} USD on your debit card ending in ${
    //         destinationCard.last4
    //       }.`
    //     : `Your credit card ending in ${
    //         destinationCard.last4
    //       } has been paid ${convertedAmount.toString()} USD from a wallet transfer.`;

    //   await notificationService.createNotification(
    //     destinationCard.user._id,
    //     isDebitCard ? "Card Deposit Received" : "Credit Card Payment Received",
    //     notificationMessage,
    //     "transaction",
    //     {
    //       transactionId: creditTransaction._id,
    //       reference: sharedReference,
    //       type: "card_deposit",
    //     },
    //     session
    //   );
    // }

    logger.debug("Committing database transaction", {
      userId: req.user._id,
      requestId: req.id,
      reference: sharedReference,
      timestamp: new Date().toISOString(),
    });

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Wallet to card transfer completed successfully", {
      userId: req.user._id,
      requestId: req.id,
      transactionReference: sharedReference,
      amount: decimalAmount.toString(),
      convertedAmount: convertedAmount.toString(),
      fromCurrency: sourceWallet.currency,
      toCurrency: "USD",
      timestamp: new Date().toISOString(),
    });

    // Return the transactions in the response
    return apiResponse.success(
      res,
      200,
      "Transfer Successful",
      "Wallet to card transfer completed successfully",
      {
        debitTransaction,
        creditTransaction,
        amount: decimalAmount.toString(),
        convertedAmount: convertedAmount.toString(),
        reference: sharedReference,
      }
    );
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

    logger.error("Wallet to card transfer failed:", {
      error: error.message,
      errorCode: error.code || error.statusCode,
      errorStack: error.stack,
      userId: req.user?._id,
      requestId: req.id,
      requestBody: req.body,
      timestamp: new Date().toISOString(),
    });

    return apiResponse.error(
      res,
      500,
      "Transfer Failed",
      "An error occurred during wallet to card transfer",
      "WALLET_TO_CARD_ERROR"
    );
  }
};

/**
 * @desc    Transfer from account to account
 * @route   POST /api/account/transfer/account
 * @access  Private
 */
exports.transferAccountToAccount = async (req, res) => {
  // Start logging
  logger.info("Account-to-account transfer request initiated", {
    userId: req.user._id,
    requestId: req.id,
    requestBody: {
      amount: req.body.amount,
      sourceAccountId: req.body.sourceAccountId,
      destinationAccountId: req.body.destinationAccountId,
      description: req.body.description,
      metadata: req.body.metadata,
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
      amount,
      sourceAccountId,
      destinationAccountId,
      description,
      metadata,
    } = req.body;

    // Check if source and destination are the same
    if (sourceAccountId === destinationAccountId) {
      logger.warn("Same source and destination account", {
        userId: req.user._id,
        requestId: req.id,
        sourceAccountId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Invalid Request",
        "Source and destination accounts cannot be the same",
        "SAME_ACCOUNT_ERROR"
      );
    }

    // Convert amount to Decimal128 for precise calculations
    const decimalAmount = mongoose.Types.Decimal128.fromString(
      amount.toString()
    );

    // Log lookup attempt
    logger.debug("Looking up source and destination accounts", {
      userId: req.user._id,
      requestId: req.id,
      sourceAccountId,
      destinationAccountId,
      timestamp: new Date().toISOString(),
    });

    // Find source account
    const sourceAccount = await Account.findOne({
      _id: sourceAccountId,
      user: req.user._id,
    })
      .populate("user")
      .session(session);

    if (!sourceAccount) {
      logger.warn("Source account not found", {
        userId: req.user._id,
        requestId: req.id,
        sourceAccountId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Invalid Request",
        "Source account not found or does not belong to you",
        "SOURCE_ACCOUNT_NOT_FOUND"
      );
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
        sourceBalance: sourceAccount.availableBalance.toString(),
        transferAmount: decimalAmount.toString(),
        difference: (
          parseFloat(decimalAmount.toString()) -
          parseFloat(sourceAccount.availableBalance.toString())
        ).toFixed(8),
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Insufficient Funds",
        "Insufficient funds in source account",
        "INSUFFICIENT_ACCOUNT_FUNDS"
      );
    }

    // Find destination account
    const destinationAccount = await Account.findOne({
      _id: destinationAccountId,
    })
      .populate("user")
      .session(session);

    if (!destinationAccount) {
      logger.warn("Destination account not found", {
        userId: req.user._id,
        requestId: req.id,
        destinationAccountId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Invalid Request",
        "Destination account not found",
        "DESTINATION_ACCOUNT_NOT_FOUND"
      );
    }

    // Generate a shared reference for transactions
    const sharedReference = generateTransactionReference("Account", "Account");

    // Store old balances for logging
    const oldSourceBalance = sourceAccount.availableBalance.toString();
    const oldDestinationBalance =
      destinationAccount.availableBalance.toString();

    // Deduct from source account
    sourceAccount.availableBalance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(sourceAccount.availableBalance.toString()) -
        parseFloat(decimalAmount.toString())
      ).toFixed(8)
    );

    // Update ledger balance too
    sourceAccount.ledgerBalance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(sourceAccount.ledgerBalance.toString()) -
        parseFloat(decimalAmount.toString())
      ).toFixed(8)
    );

    logger.debug("Updating Source account balance", {
      userId: req.user._id,
      requestId: req.id,
      sourceAccountId: sourceAccount._id,
      oldBalance: oldSourceBalance,
      amountDeducted: decimalAmount.toString(),
      newBalance: sourceAccount.availableBalance.toString(),
      timestamp: new Date().toISOString(),
    });

    await sourceAccount.save({ session });

    // Add to destination account
    destinationAccount.availableBalance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(destinationAccount.availableBalance.toString()) +
        parseFloat(decimalAmount.toString())
      ).toFixed(8)
    );

    // Update ledger balance too
    destinationAccount.ledgerBalance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(destinationAccount.ledgerBalance.toString()) +
        parseFloat(decimalAmount.toString())
      ).toFixed(8)
    );

    logger.debug("Updating Destination account balance", {
      userId: req.user._id,
      requestId: req.id,
      destinationAccountId: destinationAccount._id,
      oldBalance: oldDestinationBalance,
      amountAdded: decimalAmount.toString(),
      newBalance: destinationAccount.availableBalance.toString(),
      timestamp: new Date().toISOString(),
    });

    await destinationAccount.save({ session });

    // Create Transaction records for general ledger
    const debitTransaction = new Transaction({
      user: req.user._id,
      type: "debit",
      amount: decimalAmount,
      source: sourceAccount._id,
      sourceType: "Account",
      sourceCurrency: "USD",
      sourceUser: sourceAccount.user._id,
      destination: destinationAccount._id,
      destinationType: "Account",
      destinationCurrency: "USD",
      beneficiary: destinationAccount.user._id,
      conversionRate: 1,
      description: description || "Account to account transfer (debit)",
      status: "completed",
      reference: sharedReference,
      metadata,
      processedAt: new Date(),
    });

    const creditTransaction = new Transaction({
      user: destinationAccount.user._id,
      type: "credit",
      amount: decimalAmount,
      source: sourceAccount._id,
      sourceType: "Account",
      sourceCurrency: "USD",
      sourceUser: sourceAccount.user._id,
      destination: destinationAccount._id,
      destinationType: "Account",
      destinationCurrency: "USD",
      beneficiary: destinationAccount.user._id,
      conversionRate: 1,
      description: description || "Account to account transfer (credit)",
      status: "completed",
      reference: sharedReference,
      metadata,
      processedAt: new Date(),
    });

    // Save all transactions
    await debitTransaction.save({ session });
    await creditTransaction.save({ session });

    logger.debug("Transactions created", {
      userId: req.user._id,
      requestId: req.id,
      debitTransactionId: debitTransaction._id,
      creditTransactionId: creditTransaction._id,
      reference: sharedReference,
      timestamp: new Date().toISOString(),
    });

    // Update transaction lists
    if (!sourceAccount.transactions) {
      sourceAccount.transactions = [];
    }
    sourceAccount.transactions.push(debitTransaction._id);
    await sourceAccount.save({ session });

    if (!destinationAccount.transactions) {
      destinationAccount.transactions = [];
    }
    destinationAccount.transactions.push(creditTransaction._id);
    await destinationAccount.save({ session });

    // Create notification for source account owner
    // await notificationService.createNotification(
    //   sourceAccount.user._id,
    //   "Account Transfer Completed",
    //   `Your transfer of $${decimalAmount.toString()} from account ${
    //     sourceAccount.name || sourceAccount.accountNumber
    //   } has been completed.`,
    //   "transaction",
    //   {
    //     transactionId: debitTransaction._id,
    //     reference: sharedReference,
    //     type: "account_transfer",
    //   },
    //   session
    // );

    // // If destination account belongs to different user, create notification for them too
    // if (
    //   sourceAccount.user._id.toString() !==
    //   destinationAccount.user._id.toString()
    // ) {
    //   await notificationService.createNotification(
    //     destinationAccount.user._id,
    //     "Account Deposit Received",
    //     `You have received $${decimalAmount.toString()} in your account ${
    //       destinationAccount.name || destinationAccount.accountNumber
    //     }.`,
    //     "transaction",
    //     {
    //       transactionId: creditTransaction._id,
    //       reference: sharedReference,
    //       type: "account_deposit",
    //     },
    //     session
    //   );
    // }

    logger.debug("Committing database transaction", {
      userId: req.user._id,
      requestId: req.id,
      reference: sharedReference,
      timestamp: new Date().toISOString(),
    });

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Account to account transfer completed successfully", {
      userId: req.user._id,
      requestId: req.id,
      transactionReference: sharedReference,
      amount: decimalAmount.toString(),
      timestamp: new Date().toISOString(),
    });

    // Return the transactions in the response
    return apiResponse.success(
      res,
      200,
      "Transfer Successful",
      "Account to account transfer completed successfully",
      {
        debitTransaction,
        creditTransaction,
        amount: decimalAmount.toString(),
        reference: sharedReference,
      }
    );
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

    logger.error("Account to account transfer failed:", {
      error: error.message,
      errorCode: error.code || error.statusCode,
      errorStack: error.stack,
      userId: req.user?._id,
      requestId: req.id,
      requestBody: req.body,
      timestamp: new Date().toISOString(),
    });

    return apiResponse.error(
      res,
      500,
      "Transfer Failed",
      "An error occurred during account to account transfer",
      "ACCOUNT_TRANSFER_ERROR"
    );
  }
};

/**
 * @desc    Transfer from account to card
 * @route   POST /api/account/transfer/card
 * @access  Private
 */
exports.transferAccountToCard = async (req, res) => {
  // Start logging
  logger.info("Account-to-card transfer request initiated", {
    userId: req.user._id,
    requestId: req.id,
    requestBody: {
      amount: req.body.amount,
      sourceAccountId: req.body.sourceAccountId,
      destinationCardId: req.body.destinationCardId,
      description: req.body.description,
      metadata: req.body.metadata,
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
      amount,
      sourceAccountId,
      destinationCardId,
      description,
      metadata,
    } = req.body;

    // Convert amount to Decimal128 for precise calculations
    const decimalAmount = mongoose.Types.Decimal128.fromString(
      amount.toString()
    );

    // Log lookup attempt
    logger.debug("Looking up source account and destination card", {
      userId: req.user._id,
      requestId: req.id,
      sourceAccountId,
      destinationCardId,
      timestamp: new Date().toISOString(),
    });

    // Find source account
    const sourceAccount = await Account.findOne({
      _id: sourceAccountId,
      user: req.user._id,
    })
      .populate("user")
      .session(session);

    if (!sourceAccount) {
      logger.warn("Source account not found", {
        userId: req.user._id,
        requestId: req.id,
        sourceAccountId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Invalid Request",
        "Source account not found or does not belong to you",
        "SOURCE_ACCOUNT_NOT_FOUND"
      );
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
        sourceBalance: sourceAccount.availableBalance.toString(),
        transferAmount: decimalAmount.toString(),
        difference: (
          parseFloat(decimalAmount.toString()) -
          parseFloat(sourceAccount.availableBalance.toString())
        ).toFixed(8),
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Insufficient Funds",
        "Insufficient funds in source account",
        "INSUFFICIENT_ACCOUNT_FUNDS"
      );
    }

    // Find destination card
    const destinationCard = await Card.findOne({
      _id: destinationCardId,
    })
      .populate("user")
      .session(session);

    if (!destinationCard) {
      logger.warn("Destination card not found", {
        userId: req.user._id,
        requestId: req.id,
        destinationCardId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Invalid Request",
        "Destination card not found",
        "DESTINATION_CARD_NOT_FOUND"
      );
    }

    // Check if card is active
    if (destinationCard.status !== "active") {
      logger.warn("Destination card is not active", {
        userId: req.user._id,
        requestId: req.id,
        destinationCardId: destinationCard._id,
        cardStatus: destinationCard.status,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Card Error",
        `Destination card is ${destinationCard.status}`,
        "CARD_NOT_ACTIVE"
      );
    }

    // Check if card is expired
    if (destinationCard.isExpired) {
      logger.warn("Destination card is expired", {
        userId: req.user._id,
        requestId: req.id,
        destinationCardId: destinationCard._id,
        expiryDate: destinationCard.expiryDate,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Card Error",
        "Destination card is expired",
        "CARD_EXPIRED"
      );
    }

    // Generate a shared reference for transactions
    const sharedReference = generateTransactionReference("Account", "Card");

    // Store old balances for logging
    const oldSourceBalance = sourceAccount.availableBalance.toString();

    // For cards, we need to check which balance field to use based on type
    const isDebitCard =
      destinationCard.type === "debit" || destinationCard.type === "prepaid";
    const oldDestinationBalance = isDebitCard
      ? destinationCard.availableBalance.toString()
      : destinationCard.ledgerBalance.toString();

    // Deduct from source account
    sourceAccount.availableBalance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(sourceAccount.availableBalance.toString()) -
        parseFloat(decimalAmount.toString())
      ).toFixed(8)
    );

    // Update ledger balance too
    sourceAccount.ledgerBalance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(sourceAccount.ledgerBalance.toString()) -
        parseFloat(decimalAmount.toString())
      ).toFixed(8)
    );

    logger.debug("Updating Source account balance", {
      userId: req.user._id,
      requestId: req.id,
      sourceAccountId: sourceAccount._id,
      oldBalance: oldSourceBalance,
      amountDeducted: decimalAmount.toString(),
      newBalance: sourceAccount.availableBalance.toString(),
      timestamp: new Date().toISOString(),
    });

    await sourceAccount.save({ session });

    // Add to destination card based on card type
    if (isDebitCard) {
      destinationCard.availableBalance = mongoose.Types.Decimal128.fromString(
        (
          parseFloat(destinationCard.availableBalance.toString()) +
          parseFloat(decimalAmount.toString())
        ).toFixed(8)
      );

      // Update ledger balance too
      destinationCard.ledgerBalance = mongoose.Types.Decimal128.fromString(
        (
          parseFloat(destinationCard.ledgerBalance.toString()) +
          parseFloat(decimalAmount.toString())
        ).toFixed(8)
      );
    } else {
      // For credit cards, we're paying down the balance (reducing it)
      destinationCard.ledgerBalance = mongoose.Types.Decimal128.fromString(
        Math.max(
          0,
          parseFloat(destinationCard.ledgerBalance.toString()) -
            parseFloat(decimalAmount.toString())
        ).toFixed(8)
      );
    }

    // Update last used time
    destinationCard.lastUsedAt = new Date();

    logger.debug("Updating Destination card balance", {
      userId: req.user._id,
      requestId: req.id,
      destinationCardId: destinationCard._id,
      cardType: destinationCard.type,
      oldBalance: oldDestinationBalance,
      amountProcessed: decimalAmount.toString(),
      newBalance: isDebitCard
        ? destinationCard.availableBalance.toString()
        : destinationCard.ledgerBalance.toString(),
      timestamp: new Date().toISOString(),
    });

    await destinationCard.save({ session });

    // Create Transaction records for general ledger
    const debitTransaction = new Transaction({
      user: req.user._id,
      type: "debit",
      amount: decimalAmount,
      source: sourceAccount._id,
      sourceType: "Account",
      sourceCurrency: "USD",
      sourceUser: sourceAccount.user._id,
      destination: destinationCard._id,
      destinationType: "Card",
      destinationCurrency: "USD",
      beneficiary: destinationCard.user._id,
      conversionRate: 1,
      description:
        description ||
        `Account to ${isDebitCard ? "debit" : "credit"} card transfer (debit)`,
      status: "completed",
      reference: sharedReference,
      metadata,
      processedAt: new Date(),
    });

    const creditTransaction = new Transaction({
      user: destinationCard.user._id,
      type: "credit",
      amount: decimalAmount,
      source: sourceAccount._id,
      sourceType: "Account",
      sourceCurrency: "USD",
      sourceUser: sourceAccount.user._id,
      destination: destinationCard._id,
      destinationType: "Card",
      destinationCurrency: "USD",
      beneficiary: destinationCard.user._id,
      conversionRate: 1,
      description:
        description ||
        `Account to ${isDebitCard ? "debit" : "credit"} card transfer (credit)`,
      status: "completed",
      reference: sharedReference,
      metadata,
      processedAt: new Date(),
    });

    // Save all transactions
    await debitTransaction.save({ session });
    await creditTransaction.save({ session });

    logger.debug("Transactions created", {
      userId: req.user._id,
      requestId: req.id,
      debitTransactionId: debitTransaction._id,
      creditTransactionId: creditTransaction._id,
      reference: sharedReference,
      timestamp: new Date().toISOString(),
    });

    // Update transaction lists
    if (!sourceAccount.transactions) {
      sourceAccount.transactions = [];
    }
    sourceAccount.transactions.push(debitTransaction._id);
    await sourceAccount.save({ session });

    if (!destinationCard.transactions) {
      destinationCard.transactions = [];
    }
    destinationCard.transactions.push(creditTransaction._id);
    await destinationCard.save({ session });

    // Create notification for account owner
    const notificationTitle = isDebitCard
      ? "Card Funding Completed"
      : "Credit Card Payment Completed";
    const notificationMessage = isDebitCard
      ? `Your transfer of $${decimalAmount.toString()} from account to card ending in ${
          destinationCard.last4
        } has been completed.`
      : `Your payment of $${decimalAmount.toString()} from account to credit card ending in ${
          destinationCard.last4
        } has been completed.`;

    // await notificationService.createNotification(
    //   sourceAccount.user._id,
    //   notificationTitle,
    //   notificationMessage,
    //   "transaction",
    //   {
    //     transactionId: debitTransaction._id,
    //     reference: sharedReference,
    //     type: isDebitCard ? "card_funding" : "card_payment",
    //   },
    //   session
    // );

    // // If card belongs to different user, notify them too
    // if (
    //   sourceAccount.user._id.toString() !== destinationCard.user._id.toString()
    // ) {
    //   const recipientTitle = isDebitCard
    //     ? "Card Deposit Received"
    //     : "Credit Card Payment Received";
    //   const recipientMessage = isDebitCard
    //     ? `Your card ending in ${
    //         destinationCard.last4
    //       } has been funded with $${decimalAmount.toString()}.`
    //     : `A payment of $${decimalAmount.toString()} has been made to your credit card ending in ${
    //         destinationCard.last4
    //       }.`;

    //   await notificationService.createNotification(
    //     destinationCard.user._id,
    //     recipientTitle,
    //     recipientMessage,
    //     "transaction",
    //     {
    //       transactionId: creditTransaction._id,
    //       reference: sharedReference,
    //       type: isDebitCard ? "card_deposit" : "card_payment_received",
    //     },
    //     session
    //   );
    // }

    logger.debug("Committing database transaction", {
      userId: req.user._id,
      requestId: req.id,
      reference: sharedReference,
      timestamp: new Date().toISOString(),
    });

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Account to card transfer completed successfully", {
      userId: req.user._id,
      requestId: req.id,
      transactionReference: sharedReference,
      amount: decimalAmount.toString(),
      timestamp: new Date().toISOString(),
    });

    // Return the transactions in the response
    return apiResponse.success(
      res,
      200,
      "Transfer Successful",
      "Account to card transfer completed successfully",
      {
        debitTransaction,
        creditTransaction,
        amount: decimalAmount.toString(),
        reference: sharedReference,
      }
    );
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

    logger.error("Account to card transfer failed:", {
      error: error.message,
      errorCode: error.code || error.statusCode,
      errorStack: error.stack,
      userId: req.user?._id,
      requestId: req.id,
      requestBody: req.body,
      timestamp: new Date().toISOString(),
    });

    return apiResponse.error(
      res,
      500,
      "Transfer Failed",
      "An error occurred during account to card transfer",
      "ACCOUNT_TO_CARD_ERROR"
    );
  }
};

/**
 * @desc    Transfer from account to wallet
 * @route   POST /api/account/transfer/wallet
 * @access  Private
 */
exports.transferAccountToWallet = async (req, res) => {
  // Start logging
  logger.info("Account-to-wallet transfer request initiated", {
    userId: req.user._id,
    requestId: req.id,
    requestBody: {
      amount: req.body.amount,
      sourceAccountId: req.body.sourceAccountId,
      sourceCurrency: req.body.sourceCurrency,
      destinationWalletId: req.body.destinationWalletId,
      description: req.body.description,
      metadata: req.body.metadata,
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
      amount,
      sourceAccountId,
      destinationWalletId,
      description,
      metadata,
    } = req.body;

    // Convert amount to Decimal128 for precise calculations
    const decimalAmount = mongoose.Types.Decimal128.fromString(
      amount.toString()
    );

    // Log lookup attempt
    logger.debug("Looking up account and wallet", {
      userId: req.user._id,
      requestId: req.id,
      sourceAccountId,
      destinationWalletId,
      timestamp: new Date().toISOString(),
    });

    // Find source account
    const sourceAccount = await Account.findOne({
      _id: sourceAccountId,
      user: req.user._id,
    })
      .populate("user")
      .session(session);

    if (!sourceAccount) {
      logger.warn("Source account not found", {
        userId: req.user._id,
        requestId: req.id,
        sourceAccountId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Invalid Request",
        "Source account not found or does not belong to you",
        "SOURCE_ACCOUNT_NOT_FOUND"
      );
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
        sourceBalance: sourceAccount.availableBalance.toString(),
        transferAmount: decimalAmount.toString(),
        difference: (
          parseFloat(decimalAmount.toString()) -
          parseFloat(sourceAccount.availableBalance.toString())
        ).toFixed(8),
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Insufficient Funds",
        "Insufficient funds in source account",
        "INSUFFICIENT_ACCOUNT_FUNDS"
      );
    }

    // Find destination wallet
    const destinationWallet = await Wallet.findOne({
      _id: destinationWalletId,
    })
      .populate("user")
      .session(session);

    if (!destinationWallet) {
      logger.warn("Destination wallet not found", {
        userId: req.user._id,
        requestId: req.id,
        destinationWalletId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Invalid Request",
        "Destination wallet not found",
        "DESTINATION_WALLET_NOT_FOUND"
      );
    }

    // Check if wallet is active
    if (destinationWallet.status !== "active") {
      logger.warn("Destination wallet is not active", {
        userId: req.user._id,
        requestId: req.id,
        destinationWalletId: destinationWallet._id,
        walletStatus: destinationWallet.status,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Wallet Error",
        `Destination wallet is ${destinationWallet.status}`,
        "WALLET_NOT_ACTIVE"
      );
    }

    // Currency conversion check (accounts are always in USD)
    logger.debug("Currency conversion check", {
      userId: req.user._id,
      requestId: req.id,
      fromCurrency: "USD",
      toCurrency: destinationWallet.currency,
      beforeConversion: decimalAmount.toString(),
      timestamp: new Date().toISOString(),
    });

    // Convert amount to wallet's currency from USD
    const convertedAmount = await convertCurrency(
      decimalAmount,
      "USD",
      destinationWallet.currency
    );

    logger.debug("After currency conversion", {
      userId: req.user._id,
      requestId: req.id,
      fromCurrency: "USD",
      toCurrency: destinationWallet.currency,
      beforeConversion: decimalAmount.toString(),
      afterConversion: convertedAmount.toString(),
      conversionRate: (
        parseFloat(convertedAmount.toString()) /
        parseFloat(decimalAmount.toString())
      ).toFixed(8),
      timestamp: new Date().toISOString(),
    });

    // Generate a shared reference for transactions
    const sharedReference = generateTransactionReference("Account", "Wallet");

    // Store old balances for logging
    const oldSourceBalance = sourceAccount.availableBalance.toString();
    const oldDestinationBalance = destinationWallet.balance.toString();

    // Deduct from source account
    sourceAccount.availableBalance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(sourceAccount.availableBalance.toString()) -
        parseFloat(decimalAmount.toString())
      ).toFixed(8)
    );

    // Update ledger balance too
    sourceAccount.ledgerBalance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(sourceAccount.ledgerBalance.toString()) -
        parseFloat(decimalAmount.toString())
      ).toFixed(8)
    );

    logger.debug("Updating Source account balance", {
      userId: req.user._id,
      requestId: req.id,
      sourceAccountId: sourceAccount._id,
      oldBalance: oldSourceBalance,
      amountDeducted: decimalAmount.toString(),
      newBalance: sourceAccount.availableBalance.toString(),
      timestamp: new Date().toISOString(),
    });

    await sourceAccount.save({ session });

    // Add to destination wallet
    destinationWallet.balance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(destinationWallet.balance.toString()) +
        parseFloat(convertedAmount.toString())
      ).toFixed(8)
    );

    // Update ledger balance too
    destinationWallet.ledgerBalance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(destinationWallet.ledgerBalance.toString()) +
        parseFloat(convertedAmount.toString())
      ).toFixed(8)
    );

    logger.debug("Updating Destination wallet balance", {
      userId: req.user._id,
      requestId: req.id,
      destinationWalletId: destinationWallet._id,
      oldBalance: oldDestinationBalance,
      amountAdded: convertedAmount.toString(),
      newBalance: destinationWallet.balance.toString(),
      timestamp: new Date().toISOString(),
    });

    await destinationWallet.save({ session });

    // Calculate conversion rate
    const conversionRate =
      destinationWallet.currency !== "USD"
        ? parseFloat(convertedAmount.toString()) /
          parseFloat(decimalAmount.toString())
        : 1;

    // Create Transaction for source account (debit)
    const debitTransaction = new Transaction({
      user: req.user._id,
      type: "debit",
      amount: decimalAmount,
      source: sourceAccount._id,
      sourceType: "Account",
      sourceCurrency: "USD",
      sourceUser: sourceAccount.user._id,
      destination: destinationWallet._id,
      destinationType: "Wallet",
      destinationCurrency: destinationWallet.currency,
      beneficiary: destinationWallet.user._id,
      conversionRate,
      description: description || "Account to wallet transfer (debit)",
      status: "completed",
      reference: sharedReference,
      metadata,
      processedAt: new Date(),
    });

    // Create WalletTransaction for destination wallet (credit)
    const creditTransaction = new WalletTransaction({
      user: destinationWallet.user._id,
      type: "credit",
      amount: convertedAmount,
      currency: destinationWallet.currency,
      source: sourceAccount._id,
      sourceType: "Account",
      sourceCurrency: "USD",
      beneficiary: destinationWallet._id,
      beneficiaryType: "Wallet",
      beneficiaryCurrency: destinationWallet.currency,
      conversionRate,
      description: description || "Account to wallet transfer (credit)",
      status: "completed",
      reference: sharedReference,
      metadata,
      processedAt: new Date(),
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    // Save all transactions
    await debitTransaction.save({ session });
    await creditTransaction.save({ session });

    logger.debug("Transactions created", {
      userId: req.user._id,
      requestId: req.id,
      debitTransactionId: debitTransaction._id,
      creditTransactionId: creditTransaction._id,
      reference: sharedReference,
      timestamp: new Date().toISOString(),
    });

    // Update transaction lists
    if (!sourceAccount.transactions) {
      sourceAccount.transactions = [];
    }
    sourceAccount.transactions.push(debitTransaction._id);
    await sourceAccount.save({ session });

    if (!destinationWallet.transactions) {
      destinationWallet.transactions = [];
    }
    destinationWallet.transactions.push(creditTransaction._id);
    destinationWallet.lastActivityAt = new Date();
    await destinationWallet.save({ session });

    // Create notification for source account owner
    // await notificationService.createNotification(
    //   sourceAccount.user._id,
    //   "Wallet Funding Completed",
    //   `Your transfer of $${decimalAmount.toString()} from account to wallet has been completed.`,
    //   "transaction",
    //   {
    //     transactionId: debitTransaction._id,
    //     reference: sharedReference,
    //     type: "wallet_funding",
    //   },
    //   session
    // );

    // // If destination wallet belongs to different user, notify them too
    // if (
    //   sourceAccount.user._id.toString() !==
    //   destinationWallet.user._id.toString()
    // ) {
    //   await notificationService.createNotification(
    //     destinationWallet.user._id,
    //     "Wallet Deposit Received",
    //     `You have received ${convertedAmount.toString()} ${
    //       destinationWallet.currency
    //     } in your wallet ${
    //       destinationWallet.name || destinationWallet.address
    //     }.`,
    //     "transaction",
    //     {
    //       transactionId: creditTransaction._id,
    //       reference: sharedReference,
    //       type: "wallet_deposit",
    //     },
    //     session
    //   );
    // }

    logger.debug("Committing database transaction", {
      userId: req.user._id,
      requestId: req.id,
      reference: sharedReference,
      timestamp: new Date().toISOString(),
    });

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Account to wallet transfer completed successfully", {
      userId: req.user._id,
      requestId: req.id,
      transactionReference: sharedReference,
      amount: decimalAmount.toString(),
      convertedAmount: convertedAmount.toString(),
      fromCurrency: "USD",
      toCurrency: destinationWallet.currency,
      timestamp: new Date().toISOString(),
    });

    // Return the transactions in the response
    return apiResponse.success(
      res,
      200,
      "Deposit Successful",
      "Account to wallet deposit completed successfully",
      {
        debitTransaction,
        creditTransaction,
        amount: decimalAmount.toString(),
        convertedAmount: convertedAmount.toString(),
        reference: sharedReference,
      }
    );
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

    logger.error("Account to wallet transfer failed:", {
      error: error.message,
      errorCode: error.code || error.statusCode,
      errorStack: error.stack,
      userId: req.user?._id,
      requestId: req.id,
      requestBody: req.body,
      timestamp: new Date().toISOString(),
    });

    return apiResponse.error(
      res,
      500,
      "Transfer Failed",
      "An error occurred during account to wallet transfer",
      "ACCOUNT_TO_WALLET_ERROR"
    );
  }
};

/**
 * @desc    Transfer from card to card
 * @route   POST /api/card/transfer/card
 * @access  Private
 */
exports.transferCardToCard = async (req, res) => {
  // Start logging
  logger.info("Card-to-card transfer request initiated", {
    userId: req.user._id,
    requestId: req.id,
    requestBody: {
      amount: req.body.amount,
      sourceCardId: req.body.sourceCardId,
      destinationCardId: req.body.destinationCardId,
      description: req.body.description,
      metadata: req.body.metadata,
    },
    timestamp: new Date().toISOString(),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });

  // Start a database transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { amount, sourceCardId, destinationCardId, description, metadata } =
      req.body;

    // Check if source and destination are the same
    if (sourceCardId === destinationCardId) {
      logger.warn("Same source and destination card", {
        userId: req.user._id,
        requestId: req.id,
        sourceCardId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Invalid Request",
        "Source and destination cards cannot be the same",
        "SAME_CARD_ERROR"
      );
    }

    // Convert amount to Decimal128 for precise calculations
    const decimalAmount = mongoose.Types.Decimal128.fromString(
      amount.toString()
    );

    // Log lookup attempt
    logger.debug("Looking up source and destination cards", {
      userId: req.user._id,
      requestId: req.id,
      sourceCardId,
      destinationCardId,
      timestamp: new Date().toISOString(),
    });

    // Find source card
    const sourceCard = await Card.findOne({
      _id: sourceCardId,
      user: req.user._id,
    })
      .populate("user")
      .session(session);

    if (!sourceCard) {
      logger.warn("Source card not found", {
        userId: req.user._id,
        requestId: req.id,
        sourceCardId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Invalid Request",
        "Source card not found or does not belong to you",
        "SOURCE_CARD_NOT_FOUND"
      );
    }

    // Check if source card is active
    if (sourceCard.status !== "active") {
      logger.warn("Source card is not active", {
        userId: req.user._id,
        requestId: req.id,
        sourceCardId: sourceCard._id,
        cardStatus: sourceCard.status,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Card Error",
        `Source card is ${sourceCard.status}`,
        "SOURCE_CARD_NOT_ACTIVE"
      );
    }

    // Check if source card is expired
    if (sourceCard.isExpired) {
      logger.warn("Source card is expired", {
        userId: req.user._id,
        requestId: req.id,
        sourceCardId: sourceCard._id,
        expiryDate: sourceCard.expiryDate,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Card Error",
        "Source card is expired",
        "SOURCE_CARD_EXPIRED"
      );
    }

    // Check if source card has sufficient balance
    if (
      parseFloat(sourceCard.availableBalance.toString()) <
      parseFloat(decimalAmount.toString())
    ) {
      logger.warn("Insufficient funds in source card", {
        userId: req.user._id,
        requestId: req.id,
        sourceCardId: sourceCard._id,
        sourceBalance: sourceCard.availableBalance.toString(),
        transferAmount: decimalAmount.toString(),
        difference: (
          parseFloat(decimalAmount.toString()) -
          parseFloat(sourceCard.availableBalance.toString())
        ).toFixed(8),
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Insufficient Funds",
        "Insufficient funds in source card",
        "INSUFFICIENT_CARD_FUNDS"
      );
    }

    // Check transaction limits
    const limitCheck = sourceCard.validateTransaction(
      parseFloat(decimalAmount.toString())
    );
    if (!limitCheck.allowed) {
      logger.warn("Transaction limit exceeded", {
        userId: req.user._id,
        requestId: req.id,
        sourceCardId: sourceCard._id,
        reason: limitCheck.reason,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Limit Exceeded",
        limitCheck.reason,
        "TRANSACTION_LIMIT_EXCEEDED"
      );
    }

    // Find destination card
    const destinationCard = await Card.findOne({
      _id: destinationCardId,
    })
      .populate("user")
      .session(session);

    if (!destinationCard) {
      logger.warn("Destination card not found", {
        userId: req.user._id,
        requestId: req.id,
        destinationCardId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Invalid Request",
        "Destination card not found",
        "DESTINATION_CARD_NOT_FOUND"
      );
    }

    // Check if destination card is active
    if (destinationCard.status !== "active") {
      logger.warn("Destination card is not active", {
        userId: req.user._id,
        requestId: req.id,
        destinationCardId: destinationCard._id,
        cardStatus: destinationCard.status,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Card Error",
        `Destination card is ${destinationCard.status}`,
        "DESTINATION_CARD_NOT_ACTIVE"
      );
    }

    // Check if destination card is expired
    if (destinationCard.isExpired) {
      logger.warn("Destination card is expired", {
        userId: req.user._id,
        requestId: req.id,
        destinationCardId: destinationCard._id,
        expiryDate: destinationCard.expiryDate,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Card Error",
        "Destination card is expired",
        "DESTINATION_CARD_EXPIRED"
      );
    }

    // Generate a shared reference for transactions
    const sharedReference = generateTransactionReference("Card", "Card");

    // Store old balances for logging
    const oldSourceBalance = sourceCard.availableBalance.toString();
    const oldDestinationBalance = destinationCard.availableBalance.toString();

    // Check if the destination is a credit card
    const isDestinationCreditCard = destinationCard.type === "credit";

    // Deduct from source card
    sourceCard.availableBalance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(sourceCard.availableBalance.toString()) -
        parseFloat(decimalAmount.toString())
      ).toFixed(8)
    );

    // Update ledger balance too
    sourceCard.ledgerBalance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(sourceCard.ledgerBalance.toString()) -
        parseFloat(decimalAmount.toString())
      ).toFixed(8)
    );

    logger.debug("Updating Source card balance", {
      userId: req.user._id,
      requestId: req.id,
      sourceCardId: sourceCard._id,
      oldBalance: oldSourceBalance,
      amountDeducted: decimalAmount.toString(),
      newBalance: sourceCard.availableBalance.toString(),
      timestamp: new Date().toISOString(),
    });

    await sourceCard.save({ session });

    // Add to destination card or pay down credit card balance
    if (isDestinationCreditCard) {
      // For credit cards, we're paying down the balance (reducing it)
      destinationCard.ledgerBalance = mongoose.Types.Decimal128.fromString(
        Math.max(
          0,
          parseFloat(destinationCard.ledgerBalance.toString()) -
            parseFloat(decimalAmount.toString())
        ).toFixed(8)
      );
    } else {
      // For debit/prepaid cards, add to the balance
      destinationCard.availableBalance = mongoose.Types.Decimal128.fromString(
        (
          parseFloat(destinationCard.availableBalance.toString()) +
          parseFloat(decimalAmount.toString())
        ).toFixed(8)
      );

      // Update ledger balance too
      destinationCard.ledgerBalance = mongoose.Types.Decimal128.fromString(
        (
          parseFloat(destinationCard.ledgerBalance.toString()) +
          parseFloat(decimalAmount.toString())
        ).toFixed(8)
      );
    }

    logger.debug("Updating Destination card balance", {
      userId: req.user._id,
      requestId: req.id,
      destinationCardId: destinationCard._id,
      oldBalance: oldDestinationBalance,
      amountProcessed: decimalAmount.toString(),
      newBalance: isDestinationCreditCard
        ? destinationCard.ledgerBalance.toString()
        : destinationCard.availableBalance.toString(),
      timestamp: new Date().toISOString(),
    });

    // Update last used timestamp
    sourceCard.lastUsedAt = new Date();
    destinationCard.lastUsedAt = new Date();

    await destinationCard.save({ session });

    // Create Transaction records for general ledger
    const debitTransaction = new Transaction({
      user: req.user._id,
      type: "debit",
      amount: decimalAmount,
      source: sourceCard._id,
      sourceType: "Card",
      sourceCurrency: "USD",
      sourceUser: sourceCard.user._id,
      destination: destinationCard._id,
      destinationType: "Card",
      destinationCurrency: "USD",
      beneficiary: destinationCard.user._id,
      conversionRate: 1,
      description:
        description ||
        `Card to ${
          isDestinationCreditCard ? "credit" : "debit"
        } card transfer (debit)`,
      status: "completed",
      reference: sharedReference,
      metadata,
      processedAt: new Date(),
    });

    const creditTransaction = new Transaction({
      user: destinationCard.user._id,
      type: "credit",
      amount: decimalAmount,
      source: sourceCard._id,
      sourceType: "Card",
      sourceCurrency: "USD",
      sourceUser: sourceCard.user._id,
      destination: destinationCard._id,
      destinationType: "Card",
      destinationCurrency: "USD",
      beneficiary: destinationCard.user._id,
      conversionRate: 1,
      description:
        description ||
        `Card to ${
          isDestinationCreditCard ? "credit" : "debit"
        } card transfer (credit)`,
      status: "completed",
      reference: sharedReference,
      metadata,
      processedAt: new Date(),
    });

    // Save all transactions
    await debitTransaction.save({ session });
    await creditTransaction.save({ session });

    logger.debug("Transactions created", {
      userId: req.user._id,
      requestId: req.id,
      debitTransactionId: debitTransaction._id,
      creditTransactionId: creditTransaction._id,
      reference: sharedReference,
      timestamp: new Date().toISOString(),
    });

    // Update transaction lists
    if (!sourceCard.transactions) {
      sourceCard.transactions = [];
    }
    sourceCard.transactions.push(debitTransaction._id);
    await sourceCard.save({ session });

    if (!destinationCard.transactions) {
      destinationCard.transactions = [];
    }
    destinationCard.transactions.push(creditTransaction._id);
    await destinationCard.save({ session });

    // Create notification for source card owner
    const notificationTitle = isDestinationCreditCard
      ? "Credit Card Payment Completed"
      : "Card Transfer Completed";

    const notificationMessage = isDestinationCreditCard
      ? `Your payment of $${decimalAmount.toString()} from card ending in ${
          sourceCard.last4
        } to credit card ending in ${destinationCard.last4} has been completed.`
      : `Your transfer of $${decimalAmount.toString()} from card ending in ${
          sourceCard.last4
        } to card ending in ${destinationCard.last4} has been completed.`;

    // await notificationService.createNotification(
    //   sourceCard.user._id,
    //   notificationTitle,
    //   notificationMessage,
    //   "transaction",
    //   {
    //     transactionId: debitTransaction._id,
    //     reference: sharedReference,
    //     type: isDestinationCreditCard ? "credit_card_payment" : "card_transfer",
    //   },
    //   session
    // );

    // // If destination card belongs to different user, notify them too
    // if (
    //   sourceCard.user._id.toString() !== destinationCard.user._id.toString()
    // ) {
    //   const recipientTitle = isDestinationCreditCard
    //     ? "Credit Card Payment Received"
    //     : "Card Deposit Received";

    //   const recipientMessage = isDestinationCreditCard
    //     ? `A payment of $${decimalAmount.toString()} has been made to your credit card ending in ${
    //         destinationCard.last4
    //       }.`
    //     : `You have received $${decimalAmount.toString()} on your card ending in ${
    //         destinationCard.last4
    //       }.`;

    //   await notificationService.createNotification(
    //     destinationCard.user._id,
    //     recipientTitle,
    //     recipientMessage,
    //     "transaction",
    //     {
    //       transactionId: creditTransaction._id,
    //       reference: sharedReference,
    //       type: isDestinationCreditCard
    //         ? "credit_payment_received"
    //         : "card_deposit",
    //     },
    //     session
    //   );
    // }

    logger.debug("Committing database transaction", {
      userId: req.user._id,
      requestId: req.id,
      reference: sharedReference,
      timestamp: new Date().toISOString(),
    });

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Card to card transfer completed successfully", {
      userId: req.user._id,
      requestId: req.id,
      transactionReference: sharedReference,
      amount: decimalAmount.toString(),
      timestamp: new Date().toISOString(),
    });

    // Return the transactions in the response
    return apiResponse.success(
      res,
      200,
      "Transfer Successful",
      "Card to card transfer completed successfully",
      {
        debitTransaction,
        creditTransaction,
        amount: decimalAmount.toString(),
        reference: sharedReference,
      }
    );
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

    logger.error("Card to card transfer failed:", {
      error: error.message,
      errorCode: error.code || error.statusCode,
      errorStack: error.stack,
      userId: req.user?._id,
      requestId: req.id,
      requestBody: req.body,
      timestamp: new Date().toISOString(),
    });

    return apiResponse.error(
      res,
      500,
      "Transfer Failed",
      "An error occurred during card to card transfer",
      "CARD_TO_CARD_ERROR"
    );
  }
};

/**
 * @desc    Transfer from card to account
 * @route   POST /api/card/transfer/account
 * @access  Private
 */
exports.transferCardToAccount = async (req, res) => {
  // Start logging
  logger.info("Card-to-account transfer request initiated", {
    userId: req.user._id,
    requestId: req.id,
    requestBody: {
      amount: req.body.amount,
      sourceCardId: req.body.sourceCardId,
      destinationAccountId: req.body.destinationAccountId,
      description: req.body.description,
      metadata: req.body.metadata,
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
      amount,
      sourceCardId,
      destinationAccountId,
      description,
      metadata,
    } = req.body;

    // Convert amount to Decimal128 for precise calculations
    const decimalAmount = mongoose.Types.Decimal128.fromString(
      amount.toString()
    );

    // Log lookup attempt
    logger.debug("Looking up source card and destination account", {
      userId: req.user._id,
      requestId: req.id,
      sourceCardId,
      destinationAccountId,
      timestamp: new Date().toISOString(),
    });

    // Find source card
    const sourceCard = await Card.findOne({
      _id: sourceCardId,
      user: req.user._id,
    })
      .populate("user")
      .session(session);

    if (!sourceCard) {
      logger.warn("Source card not found", {
        userId: req.user._id,
        requestId: req.id,
        sourceCardId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Invalid Request",
        "Source card not found or does not belong to you",
        "SOURCE_CARD_NOT_FOUND"
      );
    }

    // Check if source card is active
    if (sourceCard.status !== "active") {
      logger.warn("Source card is not active", {
        userId: req.user._id,
        requestId: req.id,
        sourceCardId: sourceCard._id,
        cardStatus: sourceCard.status,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Card Error",
        `Source card is ${sourceCard.status}`,
        "SOURCE_CARD_NOT_ACTIVE"
      );
    }

    // Check if source card is expired
    if (sourceCard.isExpired) {
      logger.warn("Source card is expired", {
        userId: req.user._id,
        requestId: req.id,
        sourceCardId: sourceCard._id,
        expiryDate: sourceCard.expiryDate,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Card Error",
        "Source card is expired",
        "SOURCE_CARD_EXPIRED"
      );
    }

    // Check if source card has sufficient balance
    if (
      parseFloat(sourceCard.availableBalance.toString()) <
      parseFloat(decimalAmount.toString())
    ) {
      logger.warn("Insufficient funds in source card", {
        userId: req.user._id,
        requestId: req.id,
        sourceCardId: sourceCard._id,
        sourceBalance: sourceCard.availableBalance.toString(),
        transferAmount: decimalAmount.toString(),
        difference: (
          parseFloat(decimalAmount.toString()) -
          parseFloat(sourceCard.availableBalance.toString())
        ).toFixed(8),
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Insufficient Funds",
        "Insufficient funds in source card",
        "INSUFFICIENT_CARD_FUNDS"
      );
    }

    // Check transaction limits
    const limitCheck = sourceCard.validateTransaction(
      parseFloat(decimalAmount.toString())
    );
    if (!limitCheck.allowed) {
      logger.warn("Transaction limit exceeded", {
        userId: req.user._id,
        requestId: req.id,
        sourceCardId: sourceCard._id,
        reason: limitCheck.reason,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Limit Exceeded",
        limitCheck.reason,
        "TRANSACTION_LIMIT_EXCEEDED"
      );
    }

    // Find destination account
    const destinationAccount = await Account.findOne({
      _id: destinationAccountId,
    })
      .populate("user")
      .session(session);

    if (!destinationAccount) {
      logger.warn("Destination account not found", {
        userId: req.user._id,
        requestId: req.id,
        destinationAccountId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Invalid Request",
        "Destination account not found",
        "DESTINATION_ACCOUNT_NOT_FOUND"
      );
    }

    // Generate a shared reference for transactions
    const sharedReference = generateTransactionReference("Card", "Account");

    // Store old balances for logging
    const oldSourceBalance = sourceCard.availableBalance.toString();
    const oldDestinationBalance =
      destinationAccount.availableBalance.toString();

    // Deduct from source card
    sourceCard.availableBalance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(sourceCard.availableBalance.toString()) -
        parseFloat(decimalAmount.toString())
      ).toFixed(8)
    );

    // Update ledger balance too
    sourceCard.ledgerBalance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(sourceCard.ledgerBalance.toString()) -
        parseFloat(decimalAmount.toString())
      ).toFixed(8)
    );

    logger.debug("Updating Source card balance", {
      userId: req.user._id,
      requestId: req.id,
      sourceCardId: sourceCard._id,
      oldBalance: oldSourceBalance,
      amountDeducted: decimalAmount.toString(),
      newBalance: sourceCard.availableBalance.toString(),
      timestamp: new Date().toISOString(),
    });

    await sourceCard.save({ session });

    // Add to destination account
    destinationAccount.availableBalance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(destinationAccount.availableBalance.toString()) +
        parseFloat(decimalAmount.toString())
      ).toFixed(8)
    );

    // Update ledger balance too
    destinationAccount.ledgerBalance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(destinationAccount.ledgerBalance.toString()) +
        parseFloat(decimalAmount.toString())
      ).toFixed(8)
    );

    logger.debug("Updating Destination account balance", {
      userId: req.user._id,
      requestId: req.id,
      destinationAccountId: destinationAccount._id,
      oldBalance: oldDestinationBalance,
      amountAdded: decimalAmount.toString(),
      newBalance: destinationAccount.availableBalance.toString(),
      timestamp: new Date().toISOString(),
    });

    await destinationAccount.save({ session });

    // Update card last used timestamp
    sourceCard.lastUsedAt = new Date();
    await sourceCard.save({ session });

    // Create Transaction records for general ledger
    const debitTransaction = new Transaction({
      user: req.user._id,
      type: "debit",
      amount: decimalAmount,
      source: sourceCard._id,
      sourceType: "Card",
      sourceCurrency: "USD",
      sourceUser: sourceCard.user._id,
      destination: destinationAccount._id,
      destinationType: "Account",
      destinationCurrency: "USD",
      beneficiary: destinationAccount.user._id,
      conversionRate: 1,
      description: description || "Card to account transfer (debit)",
      status: "completed",
      reference: sharedReference,
      metadata,
      processedAt: new Date(),
    });

    const creditTransaction = new Transaction({
      user: destinationAccount.user._id,
      type: "credit",
      amount: decimalAmount,
      source: sourceCard._id,
      sourceType: "Card",
      sourceCurrency: "USD",
      sourceUser: sourceCard.user._id,
      destination: destinationAccount._id,
      destinationType: "Account",
      destinationCurrency: "USD",
      beneficiary: destinationAccount.user._id,
      conversionRate: 1,
      description: description || "Card to account transfer (credit)",
      status: "completed",
      reference: sharedReference,
      metadata,
      processedAt: new Date(),
    });

    // Save all transactions
    await debitTransaction.save({ session });
    await creditTransaction.save({ session });

    logger.debug("Transactions created", {
      userId: req.user._id,
      requestId: req.id,
      debitTransactionId: debitTransaction._id,
      creditTransactionId: creditTransaction._id,
      reference: sharedReference,
      timestamp: new Date().toISOString(),
    });

    // Update transaction lists
    if (!sourceCard.transactions) {
      sourceCard.transactions = [];
    }
    sourceCard.transactions.push(debitTransaction._id);
    await sourceCard.save({ session });

    if (!destinationAccount.transactions) {
      destinationAccount.transactions = [];
    }
    destinationAccount.transactions.push(creditTransaction._id);
    await destinationAccount.save({ session });

    // Create notification for the card owner
    // await notificationService.createNotification(
    //   sourceCard.user._id,
    //   "Card to Account Transfer Completed",
    //   `Your transfer of $${decimalAmount.toString()} from card ending in ${
    //     sourceCard.last4
    //   } to account has been completed.`,
    //   "transaction",
    //   {
    //     transactionId: debitTransaction._id,
    //     reference: sharedReference,
    //     type: "card_to_account",
    //   },
    //   session
    // );

    // // If destination account belongs to a different user, notify them too
    // if (
    //   sourceCard.user._id.toString() !== destinationAccount.user._id.toString()
    // ) {
    //   await notificationService.createNotification(
    //     destinationAccount.user._id,
    //     "Account Deposit Received",
    //     `You have received $${decimalAmount.toString()} in your account ${
    //       destinationAccount.name || destinationAccount.accountNumber
    //     }.`,
    //     "transaction",
    //     {
    //       transactionId: creditTransaction._id,
    //       reference: sharedReference,
    //       type: "account_deposit",
    //     },
    //     session
    //   );
    // }

    logger.debug("Committing database transaction", {
      userId: req.user._id,
      requestId: req.id,
      reference: sharedReference,
      timestamp: new Date().toISOString(),
    });

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Card to account transfer completed successfully", {
      userId: req.user._id,
      requestId: req.id,
      transactionReference: sharedReference,
      amount: decimalAmount.toString(),
      timestamp: new Date().toISOString(),
    });

    // Return the transactions in the response
    return apiResponse.success(
      res,
      200,
      "Transfer Successful",
      "Card to account transfer completed successfully",
      {
        debitTransaction,
        creditTransaction,
        amount: decimalAmount.toString(),
        reference: sharedReference,
      }
    );
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

    logger.error("Card to account transfer failed:", {
      error: error.message,
      errorCode: error.code || error.statusCode,
      errorStack: error.stack,
      userId: req.user?._id,
      requestId: req.id,
      requestBody: req.body,
      timestamp: new Date().toISOString(),
    });

    return apiResponse.error(
      res,
      500,
      "Transfer Failed",
      "An error occurred during card to account transfer",
      "CARD_TO_ACCOUNT_ERROR"
    );
  }
};

/**
 * @desc    Transfer from card to wallet
 * @route   POST /api/card/transfer/wallet
 * @access  Privatef
 */
exports.transferCardToWallet = async (req, res) => {
  // Start logging
  logger.info("Card-to-wallet transfer request initiated", {
    userId: req.user._id,
    requestId: req.id,
    requestBody: {
      amount: req.body.amount,
      sourceCardId: req.body.sourceCardId,
      destinationWalletId: req.body.destinationWalletId,
      description: req.body.description,
      metadata: req.body.metadata,
    },
    timestamp: new Date().toISOString(),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });

  // Start a database transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { amount, sourceCardId, destinationWalletId, description, metadata } =
      req.body;

    // Convert amount to Decimal128 for precise calculations
    const decimalAmount = mongoose.Types.Decimal128.fromString(
      amount.toString()
    );

    // Log lookup attempt
    logger.debug("Looking up source card and destination wallet", {
      userId: req.user._id,
      requestId: req.id,
      sourceCardId,
      destinationWalletId,
      timestamp: new Date().toISOString(),
    });

    // Find source card
    const sourceCard = await Card.findOne({
      _id: sourceCardId,
      user: req.user._id,
    })
      .populate("user")
      .session(session);

    if (!sourceCard) {
      logger.warn("Source card not found", {
        userId: req.user._id,
        requestId: req.id,
        sourceCardId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Invalid Request",
        "Source card not found or does not belong to you",
        "SOURCE_CARD_NOT_FOUND"
      );
    }

    // Check if card is active
    if (sourceCard.status !== "active") {
      logger.warn("Source card is not active", {
        userId: req.user._id,
        requestId: req.id,
        sourceCardId: sourceCard._id,
        cardStatus: sourceCard.status,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Card Error",
        `Card is ${sourceCard.status}`,
        "CARD_NOT_ACTIVE"
      );
    }

    // Check if card is expired
    if (sourceCard.isExpired) {
      logger.warn("Source card is expired", {
        userId: req.user._id,
        requestId: req.id,
        sourceCardId: sourceCard._id,
        expiryDate: sourceCard.expiryDate,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Card Error",
        "Source card is expired",
        "CARD_EXPIRED"
      );
    }

    // Check if source card has sufficient balance
    if (
      parseFloat(sourceCard.availableBalance.toString()) <
      parseFloat(decimalAmount.toString())
    ) {
      logger.warn("Insufficient funds in source card", {
        userId: req.user._id,
        requestId: req.id,
        sourceCardId: sourceCard._id,
        sourceBalance: sourceCard.availableBalance.toString(),
        transferAmount: decimalAmount.toString(),
        difference: (
          parseFloat(decimalAmount.toString()) -
          parseFloat(sourceCard.availableBalance.toString())
        ).toFixed(8),
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Insufficient Funds",
        "Insufficient funds in source card",
        "INSUFFICIENT_CARD_FUNDS"
      );
    }

    // Check transaction limits
    const limitCheck = sourceCard.validateTransaction(
      parseFloat(decimalAmount.toString())
    );
    if (!limitCheck.allowed) {
      logger.warn("Transaction limit exceeded", {
        userId: req.user._id,
        requestId: req.id,
        sourceCardId: sourceCard._id,
        reason: limitCheck.reason,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Limit Exceeded",
        limitCheck.reason,
        "TRANSACTION_LIMIT_EXCEEDED"
      );
    }

    // Find destination wallet
    const destinationWallet = await Wallet.findOne({
      _id: destinationWalletId,
    })
      .populate("user")
      .session(session);

    if (!destinationWallet) {
      logger.warn("Destination wallet not found", {
        userId: req.user._id,
        requestId: req.id,
        destinationWalletId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Invalid Request",
        "Destination wallet not found",
        "DESTINATION_WALLET_NOT_FOUND"
      );
    }

    // Check if wallet is active
    if (destinationWallet.status !== "active") {
      logger.warn("Destination wallet is not active", {
        userId: req.user._id,
        requestId: req.id,
        destinationWalletId: destinationWallet._id,
        walletStatus: destinationWallet.status,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Wallet Error",
        `Wallet is ${destinationWallet.status}`,
        "WALLET_NOT_ACTIVE"
      );
    }

    // Currency conversion check (cards are in USD, wallet may be in different currency)
    logger.debug("Currency conversion check", {
      userId: req.user._id,
      requestId: req.id,
      fromCurrency: "USD",
      toCurrency: destinationWallet.currency,
      beforeConversion: decimalAmount.toString(),
      timestamp: new Date().toISOString(),
    });

    // Convert amount from USD to wallet currency
    const convertedAmount = await convertCurrency(
      decimalAmount,
      "USD",
      destinationWallet.currency
    );

    logger.debug("After currency conversion", {
      userId: req.user._id,
      requestId: req.id,
      fromCurrency: "USD",
      toCurrency: destinationWallet.currency,
      beforeConversion: decimalAmount.toString(),
      afterConversion: convertedAmount.toString(),
      conversionRate: (
        parseFloat(convertedAmount.toString()) /
        parseFloat(decimalAmount.toString())
      ).toFixed(8),
      timestamp: new Date().toISOString(),
    });

    // Generate a shared reference for transactions
    const sharedReference = generateTransactionReference("Card", "Wallet");

    // Store old balances for logging
    const oldSourceBalance = sourceCard.availableBalance.toString();
    const oldDestinationBalance = destinationWallet.balance.toString();

    // Deduct from source card
    sourceCard.availableBalance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(sourceCard.availableBalance.toString()) -
        parseFloat(decimalAmount.toString())
      ).toFixed(8)
    );

    // Update ledger balance too
    sourceCard.ledgerBalance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(sourceCard.ledgerBalance.toString()) -
        parseFloat(decimalAmount.toString())
      ).toFixed(8)
    );

    logger.debug("Updating Source card balance", {
      userId: req.user._id,
      requestId: req.id,
      sourceCardId: sourceCard._id,
      oldBalance: oldSourceBalance,
      amountDeducted: decimalAmount.toString(),
      newBalance: sourceCard.availableBalance.toString(),
      timestamp: new Date().toISOString(),
    });

    await sourceCard.save({ session });

    // Add to destination wallet
    destinationWallet.balance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(destinationWallet.balance.toString()) +
        parseFloat(convertedAmount.toString())
      ).toFixed(8)
    );

    // Update ledger balance too
    destinationWallet.ledgerBalance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(destinationWallet.ledgerBalance.toString()) +
        parseFloat(convertedAmount.toString())
      ).toFixed(8)
    );

    logger.debug("Updating Destination wallet balance", {
      userId: req.user._id,
      requestId: req.id,
      destinationWalletId: destinationWallet._id,
      oldBalance: oldDestinationBalance,
      amountAdded: convertedAmount.toString(),
      newBalance: destinationWallet.balance.toString(),
      timestamp: new Date().toISOString(),
    });

    await destinationWallet.save({ session });

    // Update last used timestamp for card
    sourceCard.lastUsedAt = new Date();
    await sourceCard.save({ session });

    // Update last activity timestamp for wallet
    destinationWallet.lastActivityAt = new Date();
    await destinationWallet.save({ session });

    // Calculate conversion rate
    const conversionRate =
      destinationWallet.currency !== "USD"
        ? parseFloat(convertedAmount.toString()) /
          parseFloat(decimalAmount.toString())
        : 1;

    // Create Transaction for card (debit)
    const debitTransaction = new Transaction({
      user: req.user._id,
      type: "debit",
      amount: decimalAmount,
      source: sourceCard._id,
      sourceType: "Card",
      sourceCurrency: "USD",
      sourceUser: sourceCard.user._id,
      destination: destinationWallet._id,
      destinationType: "Wallet",
      destinationCurrency: destinationWallet.currency,
      beneficiary: destinationWallet.user._id,
      conversionRate,
      description: description || "Card to wallet transfer (debit)",
      status: "completed",
      reference: sharedReference,
      metadata,
      processedAt: new Date(),
    });

    // Create WalletTransaction for wallet (credit)
    const creditTransaction = new WalletTransaction({
      user: destinationWallet.user._id,
      type: "credit",
      amount: convertedAmount,
      currency: destinationWallet.currency,
      source: sourceCard._id,
      sourceType: "Card",
      sourceCurrency: "USD",
      beneficiary: destinationWallet._id,
      beneficiaryType: "Wallet",
      beneficiaryCurrency: destinationWallet.currency,
      conversionRate,
      description: description || "Card to wallet transfer (credit)",
      status: "completed",
      reference: sharedReference,
      metadata,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      completedAt: new Date(),
    });

    // Save all transactions
    await debitTransaction.save({ session });
    await creditTransaction.save({ session });

    logger.debug("Transactions created", {
      userId: req.user._id,
      requestId: req.id,
      debitTransactionId: debitTransaction._id,
      creditTransactionId: creditTransaction._id,
      reference: sharedReference,
      timestamp: new Date().toISOString(),
    });

    // Update transaction lists
    if (!sourceCard.transactions) {
      sourceCard.transactions = [];
    }
    sourceCard.transactions.push(debitTransaction._id);
    await sourceCard.save({ session });

    if (!destinationWallet.transactions) {
      destinationWallet.transactions = [];
    }
    destinationWallet.transactions.push(creditTransaction._id);
    await destinationWallet.save({ session });

    // Create notification for card owner
    // await notificationService.createNotification(
    //   sourceCard.user._id,
    //   "Card to Wallet Transfer Completed",
    //   `Your transfer of $${decimalAmount.toString()} from card ending in ${
    //     sourceCard.last4
    //   } to wallet has been completed.`,
    //   "transaction",
    //   {
    //     transactionId: debitTransaction._id,
    //     reference: sharedReference,
    //     type: "card_to_wallet",
    //   },
    //   session
    // );

    // // If destination wallet belongs to different user, notify them too
    // if (
    //   sourceCard.user._id.toString() !== destinationWallet.user._id.toString()
    // ) {
    //   await notificationService.createNotification(
    //     destinationWallet.user._id,
    //     "Wallet Deposit Received",
    //     `You have received ${convertedAmount.toString()} ${
    //       destinationWallet.currency
    //     } in your wallet ${
    //       destinationWallet.name || destinationWallet.address
    //     }.`,
    //     "transaction",
    //     {
    //       transactionId: creditTransaction._id,
    //       reference: sharedReference,
    //       type: "wallet_deposit",
    //     },
    //     session
    //   );
    // }

    logger.debug("Committing database transaction", {
      userId: req.user._id,
      requestId: req.id,
      reference: sharedReference,
      timestamp: new Date().toISOString(),
    });

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Card to wallet transfer completed successfully", {
      userId: req.user._id,
      requestId: req.id,
      transactionReference: sharedReference,
      amount: decimalAmount.toString(),
      convertedAmount: convertedAmount.toString(),
      fromCurrency: "USD",
      toCurrency: destinationWallet.currency,
      timestamp: new Date().toISOString(),
    });

    // Return the transactions in the response
    return apiResponse.success(
      res,
      200,
      "Transfer Successful",
      "Card to wallet transfer completed successfully",
      {
        debitTransaction,
        creditTransaction,
        amount: decimalAmount.toString(),
        convertedAmount: convertedAmount.toString(),
        reference: sharedReference,
      }
    );
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

    logger.error("Card to wallet transfer failed:", {
      error: error.message,
      errorCode: error.code || error.statusCode,
      errorStack: error.stack,
      userId: req.user?._id,
      requestId: req.id,
      requestBody: req.body,
      timestamp: new Date().toISOString(),
    });

    return apiResponse.error(
      res,
      500,
      "Transfer Failed",
      "An error occurred during card to wallet transfer",
      "CARD_TO_WALLET_ERROR"
    );
  }
};
