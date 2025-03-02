const mongoose = require("mongoose");
const PreloadedWallet = require("../models/preloadedWallet");
const Wallet = require("../models/wallet");
const WalletTransaction = require("../models/walletTransaction");
const User = require("../models/user");
const Account = require("../models/account");
const Card = require("../models/card");
const CustomError = require("../utils/customError");
const logger = require("../utils/logger");
const { getExchangeRate } = require("../services/currencyExchange");

// Create a new preloaded Wallet
const createPreloadedWallet = async (req, res) => {
  try {
    const { currency, address } = req.body;
    if (!currency || !address) {
      return res.status(400).json({
        success: false,
        error: "Currency and address are required.",
      });
    }
    const newAccount = new PreloadedWallet({ currency, address });
    const savedAccount = await newAccount.save();
    res.status(201).json({ success: true, account: savedAccount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Update an existing preloaded Wallet
const updatePreloadedWallet = async (req, res) => {
  try {
    const accountId = req.params.id;
    const updateData = req.body;
    const updatedAccount = await PreloadedWallet.findByIdAndUpdate(
      accountId,
      updateData,
      { new: true }
    );
    if (!updatedAccount) {
      return res
        .status(404)
        .json({ success: false, error: "Preloaded account not found." });
    }
    res.status(200).json({ success: true, account: updatedAccount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Delete a preloaded Wallet
const deletePreloadedWallet = async (req, res) => {
  try {
    const accountId = req.params.id;
    const deletedAccount = await PreloadedWallet.findByIdAndDelete(accountId);
    if (!deletedAccount) {
      return res
        .status(404)
        .json({ success: false, error: "Preloaded account not found." });
    }
    res.status(200).json({
      success: true,
      message: "Preloaded account deleted successfully.",
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

const getUserWallets = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const wallets = await Wallet.find({ user: userId });

    res.status(200).json({
      status: "Success",
      success: true,
      data: {
        wallets,
      },
    });
  } catch (error) {
    logger.error("Get User Wallets:", {
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
 * @desc    Withdraw funds from wallet to account or card
 * @route   POST /api/wallets/withdraw
 * @access  Private
 */
const withdrawFromWallet = async (req, res, next) => {
  // Start logging - capture initial request data
  logger.info("Withdrawal request initiated", {
    userId: req.user?._id,
    requestId: req.id,
    requestBody: {
      walletId: req.body.walletId,
      amount: req.body.amount,
      toAccount: req.body.toAccount ? req.body.toAccount : undefined,
      toCard: req.body.toCard ? req.body.toCard : undefined,
      currency: req.body.currency,
      description: req.body.description || "Wallet withdrawal",
    },
    timestamp: new Date().toISOString(),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      walletId,
      amount,
      toAccount,
      toCard,
      currency,
      description = "Wallet withdrawal",
    } = req.body;

    // Log data validation step
    if (!walletId || !amount) {
      logger.warn("Validation failed: Missing required fields", {
        userId: req.user?._id,
        requestId: req.id,
        missingFields: !walletId ? "walletId" : !amount ? "amount" : null,
        timestamp: new Date().toISOString(),
      });
      throw new CustomError(400, "Please provide wallet ID and amount");
    }

    if (!toAccount && !toCard) {
      logger.warn("Validation failed: Missing destination", {
        userId: req.user?._id,
        requestId: req.id,
        timestamp: new Date().toISOString(),
      });
      throw new CustomError(400, "Please provide destination account or card");
    }

    if (toAccount && toCard) {
      logger.warn("Validation failed: Multiple destinations", {
        userId: req.user?._id,
        requestId: req.id,
        timestamp: new Date().toISOString(),
        destinations: { toAccount, toCard },
      });
      throw new CustomError(
        400,
        "Please provide either account OR card, not both"
      );
    }

    // Convert amount to Decimal128 for precise calculations
    const decimalAmount = mongoose.Types.Decimal128.fromString(
      amount.toString()
    );

    // Log wallet lookup attempt
    logger.debug("Looking up wallet", {
      userId: req.user?._id,
      requestId: req.id,
      walletId,
      timestamp: new Date().toISOString(),
    });

    // Find the wallet and ensure sufficient funds
    const wallet = await Wallet.findOne({
      _id: walletId,
      user: req.user._id,
    }).session(session);

    if (!wallet) {
      logger.warn("Wallet not found", {
        userId: req.user?._id,
        requestId: req.id,
        walletId,
        timestamp: new Date().toISOString(),
      });
      throw new CustomError(404, "Wallet not found");
    }

    // Log wallet details for balance check
    logger.debug("Wallet found - checking balance", {
      userId: req.user?._id,
      requestId: req.id,
      walletId,
      walletBalance: wallet.balance.toString(),
      withdrawalAmount: decimalAmount.toString(),
      walletCurrency: wallet.currency,
      timestamp: new Date().toISOString(),
    });

    // Check if wallet has sufficient balance
    if (
      parseFloat(wallet.balance.toString()) <
      parseFloat(decimalAmount.toString())
    ) {
      logger.warn("Insufficient funds", {
        userId: req.user?._id,
        requestId: req.id,
        walletId,
        walletBalance: wallet.balance.toString(),
        withdrawalAmount: decimalAmount.toString(),
        walletCurrency: wallet.currency,
        difference: (
          parseFloat(decimalAmount.toString()) -
          parseFloat(wallet.balance.toString())
        ).toFixed(8),
        timestamp: new Date().toISOString(),
      });
      throw new CustomError(400, "Insufficient funds in wallet");
    }

    let destinationId, destinationType, destinationCurrency;

    // Handle account withdrawal
    if (toAccount) {
      logger.debug("Processing account withdrawal", {
        userId: req.user?._id,
        requestId: req.id,
        accountId: toAccount,
        timestamp: new Date().toISOString(),
      });

      const account = await Account.findOne({
        _id: toAccount,
        user: req.user._id,
      }).session(session);

      if (!account) {
        logger.warn("Account not found", {
          userId: req.user?._id,
          requestId: req.id,
          accountId: toAccount,
          timestamp: new Date().toISOString(),
        });
        throw new CustomError(404, "Account not found");
      }

      destinationId = account._id;
      destinationType = "account";
      destinationCurrency = "USD"; // Always use USD as the target currency

      // Log currency conversion if needed
      logger.debug("Currency conversion check", {
        userId: req.user?._id,
        requestId: req.id,
        fromCurrency: wallet.currency,
        toCurrency: "USD", // Always USD
        beforeConversion: decimalAmount.toString(),
        timestamp: new Date().toISOString(),
      });

      // Convert amount to USD (always the target currency)
      const convertedAmount = await convertCurrency(
        decimalAmount,
        wallet.currency,
        "USD"
      );

      logger.debug("After currency conversion", {
        userId: req.user?._id,
        requestId: req.id,
        fromCurrency: wallet.currency,
        toCurrency: account.currency,
        beforeConversion: decimalAmount.toString(),
        afterConversion: convertedAmount.toString(),
        conversionRate: (
          parseFloat(convertedAmount.toString()) /
          parseFloat(decimalAmount.toString())
        ).toFixed(8),
        timestamp: new Date().toISOString(),
      });

      // Update account balance
      const oldAccountBalance = account.availableBalance.toString();
      account.availableBalance = mongoose.Types.Decimal128.fromString(
        (
          parseFloat(account.availableBalance.toString()) +
          parseFloat(convertedAmount.toString())
        ).toFixed(8)
      );

      logger.debug("Updating account balance", {
        userId: req.user?._id,
        requestId: req.id,
        accountId: account._id,
        oldBalance: oldAccountBalance,
        amountAdded: convertedAmount.toString(),
        newBalance: account.availableBalance.toString(),
        timestamp: new Date().toISOString(),
      });

      await account.save({ session });
    }

    // Handle card withdrawal
    if (toCard) {
      logger.debug("Processing card withdrawal", {
        userId: req.user?._id,
        requestId: req.id,
        cardId: toCard,
        timestamp: new Date().toISOString(),
      });

      const card = await Card.findOne({
        _id: toCard,
        user: req.user._id,
      }).session(session);

      if (!card) {
        logger.warn("Card not found", {
          userId: req.user?._id,
          requestId: req.id,
          cardId: toCard,
          timestamp: new Date().toISOString(),
        });
        throw new CustomError(404, "Card not found");
      }

      destinationId = card._id;
      destinationType = "card";
      destinationCurrency = "USD"; // Always use USD as the target currency

      // Log currency conversion if needed
      logger.debug("Currency conversion check", {
        userId: req.user?._id,
        requestId: req.id,
        fromCurrency: wallet.currency,
        toCurrency: "USD", // Always USD
        beforeConversion: decimalAmount.toString(),
        timestamp: new Date().toISOString(),
      });

      // Convert amount to USD (always the target currency)
      const convertedAmount = await convertCurrency(
        decimalAmount,
        wallet.currency,
        "USD"
      );

      logger.debug("After currency conversion", {
        userId: req.user?._id,
        requestId: req.id,
        fromCurrency: wallet.currency,
        toCurrency: card.currency,
        beforeConversion: decimalAmount.toString(),
        afterConversion: convertedAmount.toString(),
        conversionRate: (
          parseFloat(convertedAmount.toString()) /
          parseFloat(decimalAmount.toString())
        ).toFixed(8),
        timestamp: new Date().toISOString(),
      });

      // Update card balance
      const oldCardBalance = card.balance.toString();
      card.balance = mongoose.Types.Decimal128.fromString(
        (
          parseFloat(card.balance.toString()) +
          parseFloat(convertedAmount.toString())
        ).toFixed(8)
      );

      logger.debug("Updating card balance", {
        userId: req.user?._id,
        requestId: req.id,
        cardId: card._id,
        oldBalance: oldCardBalance,
        amountAdded: convertedAmount.toString(),
        newBalance: card.balance.toString(),
        timestamp: new Date().toISOString(),
      });

      await card.save({ session });
    }

    // Deduct from wallet
    const oldWalletBalance = wallet.balance.toString();
    wallet.balance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(wallet.balance.toString()) -
        parseFloat(decimalAmount.toString())
      ).toFixed(8)
    );

    logger.debug("Updating wallet balance", {
      userId: req.user?._id,
      requestId: req.id,
      walletId: wallet._id,
      oldBalance: oldWalletBalance,
      amountDeducted: decimalAmount.toString(),
      newBalance: wallet.balance.toString(),
      timestamp: new Date().toISOString(),
    });

    await wallet.save({ session });

    // Generate transaction reference
    const reference = `WD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // Create transaction record
    const transaction = new WalletTransaction({
      user: req.user._id,
      type: "withdrawal",
      amount: decimalAmount,
      currency: wallet.currency,
      sourceId: wallet._id,
      sourceType: "wallet",
      destinationId,
      destinationType,
      destinationCurrency,
      description,
      status: "completed",
      reference,
    });

    logger.debug("Creating transaction record", {
      userId: req.user?._id,
      requestId: req.id,
      transactionReference: reference,
      transactionDetails: {
        type: "withdrawal",
        amount: decimalAmount.toString(),
        currency: wallet.currency,
        sourceId: wallet._id.toString(),
        sourceType: "wallet",
        destinationId: destinationId.toString(),
        destinationType,
        destinationCurrency,
        status: "completed",
      },
      timestamp: new Date().toISOString(),
    });

    await transaction.save({ session });

    // Commit the transaction
    logger.debug("Committing database transaction", {
      userId: req.user?._id,
      requestId: req.id,
      reference,
      timestamp: new Date().toISOString(),
    });

    await session.commitTransaction();
    session.endSession();

    logger.info("Withdrawal completed successfully", {
      userId: req.user?._id,
      requestId: req.id,
      transactionReference: reference,
      amount: decimalAmount.toString(),
      fromCurrency: wallet.currency,
      toCurrency: destinationCurrency,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      status: "success", // Map "completed" to "success"
      message: "Wallet Withdrawal Successfully",
      reference,
      success: true,
      data: transaction,
    });
  } catch (error) {
    // Abort transaction in case of error
    logger.error("Aborting database transaction due to error", {
      userId: req.user?._id,
      requestId: req.id,
      errorMessage: error.message,
      errorStack: error.stack,
      timestamp: new Date().toISOString(),
    });

    await session.abortTransaction();
    session.endSession();

    logger.error("Withdraw transaction failed:", {
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
 * @desc    Deposit funds to wallet
 * @route   POST /api/wallets/deposit
 * @access  Private
 */
const depositToWallet = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      walletId,
      amount,
      fromAccount,
      fromCard,
      description = "Wallet deposit",
    } = req.body;

    if (!walletId || !amount) {
      throw new CustomError(400, "Please provide wallet ID and amount");
    }

    if (!fromAccount && !fromCard) {
      throw new CustomError(400, "Please provide source account or card");
    }

    if (fromAccount && fromCard) {
      throw new CustomError(
        400,
        "Please provide either account OR card, not both"
      );
    }

    // Convert amount to Decimal128 for precise calculations
    const decimalAmount = mongoose.Types.Decimal128.fromString(
      amount.toString()
    );

    // Find the wallet
    const wallet = await Wallet.findOne({
      _id: walletId,
      user: req.user.id,
    }).session(session);

    if (!wallet) {
      throw new CustomError(404, "Wallet not found");
    }

    let sourceId, sourceType, sourceCurrency, withdrawAmount;

    // Handle account deposit
    if (fromAccount) {
      const account = await Account.findOne({
        _id: fromAccount,
        user: req.user.id,
      }).session(session);

      if (!account) {
        throw new CustomError(404, "Account not found");
      }

      sourceId = account._id;
      sourceType = "account";
      sourceCurrency = account.currency;

      // Check if account has sufficient balance
      if (
        parseFloat(account.availableBalance.toString()) <
        parseFloat(decimalAmount.toString())
      ) {
        throw new CustomError(400, "Insufficient funds in account");
      }

      // Deduct from account
      account.availableBalance = mongoose.Types.Decimal128.fromString(
        (
          parseFloat(account.availableBalance.toString()) -
          parseFloat(decimalAmount.toString())
        ).toFixed(8)
      );

      await account.save({ session });

      // Convert amount to wallet currency if different
      withdrawAmount = await convertCurrency(
        decimalAmount,
        account.currency,
        wallet.currency
      );
    }

    // Handle card deposit
    if (fromCard) {
      const card = await Card.findOne({
        _id: fromCard,
        user: req.user.id,
      }).session(session);

      if (!card) {
        throw new CustomError(404, "Card not found");
      }

      sourceId = card._id;
      sourceType = "card";
      sourceCurrency = card.currency;

      // Check if card has sufficient balance
      if (
        parseFloat(card.balance.toString()) <
        parseFloat(decimalAmount.toString())
      ) {
        throw new CustomError(400, "Insufficient funds in card");
      }

      // Deduct from card
      card.balance = mongoose.Types.Decimal128.fromString(
        (
          parseFloat(card.balance.toString()) -
          parseFloat(decimalAmount.toString())
        ).toFixed(8)
      );

      await card.save({ session });

      // Convert amount to wallet currency if different
      withdrawAmount = await convertCurrency(
        decimalAmount,
        card.currency,
        wallet.currency
      );
    }

    // Add to wallet
    wallet.balance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(wallet.balance.toString()) +
        parseFloat(withdrawAmount.toString())
      ).toFixed(8)
    );

    await wallet.save({ session });

    // Create transaction record
    const transaction = new WalletTransaction({
      user: req.user.id,
      type: "deposit",
      amount: decimalAmount,
      currency: sourceCurrency,
      sourceId,
      sourceType,
      destinationId: wallet._id,
      destinationType: "wallet",
      destinationCurrency: wallet.currency,
      description,
      status: "completed",
      reference: `DP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    });

    await transaction.save({ session });

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      data: transaction,
    });
  } catch (error) {
    // Abort transaction in case of error
    await session.abortTransaction();
    session.endSession();

    logger.error("Deposit transaction failed:", {
      error: error.message,
      userId: req.user?.id,
      requestId: req.id,
    });

    next(error);
  }
};

/**
 * @desc    Transfer between wallets (same or different currencies)
 * @route   POST /api/wallets/swap
 * @access  Private
 */
const swapBetweenWallets = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      fromWalletId,
      toWalletId,
      amount,
      description = "Wallet to wallet transfer",
    } = req.body;

    if (!fromWalletId || !toWalletId || !amount) {
      throw new CustomError(
        400,
        "Please provide source wallet, destination wallet, and amount"
      );
    }

    if (fromWalletId === toWalletId) {
      throw new CustomError(
        400,
        "Source and destination wallets cannot be the same"
      );
    }

    // Convert amount to Decimal128 for precise calculations
    const decimalAmount = mongoose.Types.Decimal128.fromString(
      amount.toString()
    );

    // Find the source wallet
    const sourceWallet = await Wallet.findOne({
      _id: fromWalletId,
      user: req.user.id,
    }).session(session);

    if (!sourceWallet) {
      throw new CustomError(404, "Source wallet not found");
    }

    // Check if source wallet has sufficient balance
    if (
      parseFloat(sourceWallet.balance.toString()) <
      parseFloat(decimalAmount.toString())
    ) {
      throw new CustomError(400, "Insufficient funds in source wallet");
    }

    // Find the destination wallet
    const destWallet = await Wallet.findOne({
      _id: toWalletId,
      user: req.user.id,
    }).session(session);

    if (!destWallet) {
      throw new CustomError(404, "Destination wallet not found");
    }

    // Convert amount to destination wallet currency if different
    const convertedAmount = await convertCurrency(
      decimalAmount,
      sourceWallet.currency,
      destWallet.currency
    );

    // Deduct from source wallet
    sourceWallet.balance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(sourceWallet.balance.toString()) -
        parseFloat(decimalAmount.toString())
      ).toFixed(8)
    );

    await sourceWallet.save({ session });

    // Add to destination wallet
    destWallet.balance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(destWallet.balance.toString()) +
        parseFloat(convertedAmount.toString())
      ).toFixed(8)
    );

    await destWallet.save({ session });

    // Create transaction record
    const transaction = new WalletTransaction({
      user: req.user.id,
      type: "swap",
      amount: decimalAmount,
      currency: sourceWallet.currency,
      sourceId: sourceWallet._id,
      sourceType: "wallet",
      destinationId: destWallet._id,
      destinationType: "wallet",
      destinationCurrency: destWallet.currency,
      conversionRate:
        sourceWallet.currency !== destWallet.currency
          ? parseFloat(convertedAmount.toString()) /
            parseFloat(decimalAmount.toString())
          : 1,
      description,
      status: "completed",
      reference: `SW-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    });

    await transaction.save({ session });

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      data: transaction,
    });
  } catch (error) {
    // Abort transaction in case of error
    await session.abortTransaction();
    session.endSession();

    logger.error("Swap transaction failed:", {
      error: error.message,
      userId: req.user?.id,
      requestId: req.id,
    });

    next(error);
  }
};

/**
 * @desc    Get wallet transactions
 * @route   GET /api/wallets/:walletId/transactions
 * @access  Private
 */
const getWalletTransactions = async (req, res, next) => {
  try {
    const { walletId } = req.params;
    const { page = 1, limit = 10, type } = req.query;

    // Ensure wallet belongs to user
    const wallet = await Wallet.findOne({ _id: walletId, user: req.user.id });

    if (!wallet) {
      throw new CustomError(404, "Wallet not found");
    }

    // Build query to find transactions involving this wallet
    const query = {
      user: req.user.id,
      $or: [
        { sourceId: walletId, sourceType: "wallet" },
        { destinationId: walletId, destinationType: "wallet" },
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

    const transactions = await WalletTransaction.paginate(query, options);

    res.status(200).json({
      success: true,
      data: transactions,
    });
  } catch (error) {
    logger.error("Error fetching wallet transactions:", {
      error: error.message,
      userId: req.user?.id,
      requestId: req.id,
    });

    next(error);
  }
};

module.exports = {
  createPreloadedWallet,
  updatePreloadedWallet,
  deletePreloadedWallet,
  getUserWallets,
  withdrawFromWallet,
  depositToWallet,
  swapBetweenWallets,
  getWalletTransactions,
};
