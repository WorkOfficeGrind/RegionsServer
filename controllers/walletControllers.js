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
  // Start logging - capture initial request data
  logger.info("Deposit request initiated", {
    userId: req.user._id,
    requestId: req.id,
    requestBody: {
      walletId: req.body.walletId,
      amount: req.body.amount,
      fromAccount: req.body.fromAccount ? req.body.fromAccount : undefined,
      fromCard: req.body.fromCard ? req.body.fromCard : undefined,
      description: req.body.description || "Wallet deposit",
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
      fromAccount,
      fromCard,
      description = "Wallet deposit",
    } = req.body;

    // Log data validation step
    if (!walletId || !amount) {
      logger.warn("Validation failed: Missing required fields", {
        userId: req.user._id,
        requestId: req.id,
        missingFields: !walletId ? "walletId" : !amount ? "amount" : null,
        timestamp: new Date().toISOString(),
      });
      throw new CustomError(400, "Please provide wallet ID and amount");
    }

    if (!fromAccount && !fromCard) {
      logger.warn("Validation failed: Missing source", {
        userId: req.user._id,
        requestId: req.id,
        timestamp: new Date().toISOString(),
      });
      throw new CustomError(400, "Please provide source account or card");
    }

    if (fromAccount && fromCard) {
      logger.warn("Validation failed: Multiple sources", {
        userId: req.user._id,
        requestId: req.id,
        timestamp: new Date().toISOString(),
        sources: { fromAccount, fromCard },
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
      userId: req.user._id,
      requestId: req.id,
      walletId,
      timestamp: new Date().toISOString(),
    });

    // Find the wallet
    const wallet = await Wallet.findOne({
      _id: walletId,
      user: req.user._id,
    }).session(session);

    if (!wallet) {
      logger.warn("Wallet not found", {
        userId: req.user._id,
        requestId: req.id,
        walletId,
        timestamp: new Date().toISOString(),
      });
      throw new CustomError(404, "Wallet not found");
    }

    // Log wallet details
    logger.debug("Wallet found", {
      userId: req.user._id,
      requestId: req.id,
      walletId,
      walletBalance: wallet.balance.toString(),
      walletCurrency: wallet.currency,
      timestamp: new Date().toISOString(),
    });

    let sourceId, sourceType, sourceCurrency, depositAmount;

    // Handle account deposit
    if (fromAccount) {
      logger.debug("Processing account deposit", {
        userId: req.user._id,
        requestId: req.id,
        accountId: fromAccount,
        timestamp: new Date().toISOString(),
      });

      const account = await Account.findOne({
        _id: fromAccount,
        user: req.user._id,
      }).session(session);

      if (!account) {
        logger.warn("Account not found", {
          userId: req.user._id,
          requestId: req.id,
          accountId: fromAccount,
          timestamp: new Date().toISOString(),
        });
        throw new CustomError(404, "Account not found");
      }

      sourceId = account._id;
      sourceType = "account";
      sourceCurrency = "USD";

      // Check if account has sufficient balance
      if (
        parseFloat(account.availableBalance.toString()) <
        parseFloat(decimalAmount.toString())
      ) {
        logger.warn("Insufficient funds in account", {
          userId: req.user._id,
          requestId: req.id,
          accountId: account._id,
          accountBalance: account.availableBalance.toString(),
          withdrawalAmount: decimalAmount.toString(),
          difference: (
            parseFloat(decimalAmount.toString()) -
            parseFloat(account.availableBalance.toString())
          ).toFixed(8),
          timestamp: new Date().toISOString(),
        });
        throw new CustomError(400, "Insufficient funds in account");
      }

      // Log currency conversion if needed
      logger.debug("Currency conversion check", {
        userId: req.user._id,
        requestId: req.id,
        fromCurrency: "USD", // Always USD for accounts
        toCurrency: wallet.currency,
        beforeConversion: decimalAmount.toString(),
        timestamp: new Date().toISOString(),
      });

      // Convert amount from USD to wallet currency
      depositAmount = await convertCurrency(
        decimalAmount,
        "USD",
        wallet.currency
      );

      logger.debug("After currency conversion", {
        userId: req.user._id,
        requestId: req.id,
        fromCurrency: "USD",
        toCurrency: wallet.currency,
        beforeConversion: decimalAmount.toString(),
        afterConversion: depositAmount.toString(),
        conversionRate: (
          parseFloat(depositAmount.toString()) /
          parseFloat(decimalAmount.toString())
        ).toFixed(8),
        timestamp: new Date().toISOString(),
      });

      // Deduct from account
      const oldAccountBalance = account.availableBalance.toString();
      account.availableBalance = mongoose.Types.Decimal128.fromString(
        (
          parseFloat(account.availableBalance.toString()) -
          parseFloat(decimalAmount.toString())
        ).toFixed(8)
      );

      logger.debug("Updating account balance", {
        userId: req.user._id,
        requestId: req.id,
        accountId: account._id,
        oldBalance: oldAccountBalance,
        amountDeducted: decimalAmount.toString(),
        newBalance: account.availableBalance.toString(),
        timestamp: new Date().toISOString(),
      });

      await account.save({ session });
    }

    // Handle card deposit
    if (fromCard) {
      logger.debug("Processing card deposit", {
        userId: req.user._id,
        requestId: req.id,
        cardId: fromCard,
        timestamp: new Date().toISOString(),
      });

      const card = await Card.findOne({
        _id: fromCard,
        user: req.user._id,
      }).session(session);

      if (!card) {
        logger.warn("Card not found", {
          userId: req.user._id,
          requestId: req.id,
          cardId: fromCard,
          timestamp: new Date().toISOString(),
        });
        throw new CustomError(404, "Card not found");
      }

      sourceId = card._id;
      sourceType = "card";
      sourceCurrency = "USD";

      // Check if card has sufficient balance
      if (
        parseFloat(card.balance.toString()) <
        parseFloat(decimalAmount.toString())
      ) {
        logger.warn("Insufficient funds in card", {
          userId: req.user._id,
          requestId: req.id,
          cardId: card._id,
          cardBalance: card.balance.toString(),
          withdrawalAmount: decimalAmount.toString(),
          difference: (
            parseFloat(decimalAmount.toString()) -
            parseFloat(card.balance.toString())
          ).toFixed(8),
          timestamp: new Date().toISOString(),
        });
        throw new CustomError(400, "Insufficient funds in card");
      }

      // Log currency conversion if needed
      logger.debug("Currency conversion check", {
        userId: req.user._id,
        requestId: req.id,
        fromCurrency: "USD", // Always USD for cards
        toCurrency: wallet.currency,
        beforeConversion: decimalAmount.toString(),
        timestamp: new Date().toISOString(),
      });

      // Convert amount from USD to wallet currency
      depositAmount = await convertCurrency(
        decimalAmount,
        "USD",
        wallet.currency
      );

      logger.debug("After currency conversion", {
        userId: req.user._id,
        requestId: req.id,
        fromCurrency: "USD",
        toCurrency: wallet.currency,
        beforeConversion: decimalAmount.toString(),
        afterConversion: depositAmount.toString(),
        conversionRate: (
          parseFloat(depositAmount.toString()) /
          parseFloat(decimalAmount.toString())
        ).toFixed(8),
        timestamp: new Date().toISOString(),
      });

      // Deduct from card
      const oldCardBalance = card.balance.toString();
      card.balance = mongoose.Types.Decimal128.fromString(
        (
          parseFloat(card.balance.toString()) -
          parseFloat(decimalAmount.toString())
        ).toFixed(8)
      );

      logger.debug("Updating card balance", {
        userId: req.user._id,
        requestId: req.id,
        cardId: card._id,
        oldBalance: oldCardBalance,
        amountDeducted: decimalAmount.toString(),
        newBalance: card.balance.toString(),
        timestamp: new Date().toISOString(),
      });

      await card.save({ session });
    }

    // Add to wallet
    const oldWalletBalance = wallet.balance.toString();
    wallet.balance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(wallet.balance.toString()) +
        parseFloat(depositAmount.toString())
      ).toFixed(8)
    );

    logger.debug("Updating wallet balance", {
      userId: req.user._id,
      requestId: req.id,
      walletId: wallet._id,
      oldBalance: oldWalletBalance,
      amountAdded: depositAmount.toString(),
      newBalance: wallet.balance.toString(),
      timestamp: new Date().toISOString(),
    });

    await wallet.save({ session });

    // Generate transaction reference
    const reference = `DP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // Create transaction record
    const transaction = new WalletTransaction({
      user: req.user._id,
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
      reference,
    });

    logger.debug("Creating transaction record", {
      userId: req.user._id,
      requestId: req.id,
      transactionReference: reference,
      transactionDetails: {
        type: "deposit",
        amount: decimalAmount.toString(),
        currency: sourceCurrency,
        sourceId: sourceId.toString(),
        sourceType,
        destinationId: wallet._id.toString(),
        destinationType: "wallet",
        destinationCurrency: wallet.currency,
        status: "completed",
      },
      timestamp: new Date().toISOString(),
    });

    await transaction.save({ session });

    // Commit the transaction
    logger.debug("Committing database transaction", {
      userId: req.user._id,
      requestId: req.id,
      reference,
      timestamp: new Date().toISOString(),
    });

    await session.commitTransaction();
    session.endSession();

    logger.info("Deposit completed successfully", {
      userId: req.user._id,
      requestId: req.id,
      transactionReference: reference,
      amount: decimalAmount.toString(),
      fromCurrency: sourceCurrency,
      toCurrency: wallet.currency,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      status: "success",
      message: "Wallet Deposit Successful",
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

    logger.error("Deposit transaction failed:", {
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
 * @desc    Transfer between wallets (same or different currencies)
 * @route   POST /api/wallets/swap
 * @access  Private
 */
const swapBetweenWallets = async (req, res, next) => {
  // Start logging - capture initial request data
  logger.info("Swap request initiated", {
    userId: req.user._id,
    requestId: req.id,
    requestBody: {
      fromWalletId: req.body.fromWalletId,
      toWalletId: req.body.toWalletId,
      amount: req.body.amount,
      description: req.body.description || "Wallet to wallet transfer",
    },
    timestamp: new Date().toISOString(),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      fromWalletId,
      toWalletId,
      amount,
      description = "Wallet to wallet transfer",
    } = req.body;

    // Log data validation step
    if (!fromWalletId || !toWalletId || !amount) {
      logger.warn("Validation failed: Missing required fields", {
        userId: req.user._id,
        requestId: req.id,
        missingFields: !fromWalletId
          ? "fromWalletId"
          : !toWalletId
          ? "toWalletId"
          : !amount
          ? "amount"
          : null,
        timestamp: new Date().toISOString(),
      });
      throw new CustomError(
        400,
        "Please provide source wallet, destination wallet, and amount"
      );
    }

    if (fromWalletId === toWalletId) {
      logger.warn("Validation failed: Same source and destination", {
        userId: req.user._id,
        requestId: req.id,
        walletId: fromWalletId,
        timestamp: new Date().toISOString(),
      });
      throw new CustomError(
        400,
        "Source and destination wallets cannot be the same"
      );
    }

    // Convert amount to Decimal128 for precise calculations
    const decimalAmount = mongoose.Types.Decimal128.fromString(
      amount.toString()
    );

    // Log source wallet lookup attempt
    logger.debug("Looking up source wallet", {
      userId: req.user._id,
      requestId: req.id,
      fromWalletId,
      timestamp: new Date().toISOString(),
    });

    // Find the source wallet
    const sourceWallet = await Wallet.findOne({
      _id: fromWalletId,
      user: req.user._id,
    }).session(session);

    if (!sourceWallet) {
      logger.warn("Source wallet not found", {
        userId: req.user._id,
        requestId: req.id,
        fromWalletId,
        timestamp: new Date().toISOString(),
      });
      throw new CustomError(404, "Source wallet not found");
    }

    // Log source wallet details for balance check
    logger.debug("Source wallet found - checking balance", {
      userId: req.user._id,
      requestId: req.id,
      fromWalletId,
      walletBalance: sourceWallet.balance.toString(),
      swapAmount: decimalAmount.toString(),
      walletCurrency: sourceWallet.currency,
      timestamp: new Date().toISOString(),
    });

    // Check if source wallet has sufficient balance
    if (
      parseFloat(sourceWallet.balance.toString()) <
      parseFloat(decimalAmount.toString())
    ) {
      logger.warn("Insufficient funds in source wallet", {
        userId: req.user._id,
        requestId: req.id,
        fromWalletId,
        walletBalance: sourceWallet.balance.toString(),
        swapAmount: decimalAmount.toString(),
        walletCurrency: sourceWallet.currency,
        difference: (
          parseFloat(decimalAmount.toString()) -
          parseFloat(sourceWallet.balance.toString())
        ).toFixed(8),
        timestamp: new Date().toISOString(),
      });
      throw new CustomError(400, "Insufficient funds in source wallet");
    }

    // Log destination wallet lookup attempt
    logger.debug("Looking up destination wallet", {
      userId: req.user._id,
      requestId: req.id,
      toWalletId,
      timestamp: new Date().toISOString(),
    });

    // Find the destination wallet
    const destWallet = await Wallet.findOne({
      _id: toWalletId,
      user: req.user._id,
    }).session(session);

    if (!destWallet) {
      logger.warn("Destination wallet not found", {
        userId: req.user._id,
        requestId: req.id,
        toWalletId,
        timestamp: new Date().toISOString(),
      });
      throw new CustomError(404, "Destination wallet not found");
    }

    // Log destination wallet details
    logger.debug("Destination wallet found", {
      userId: req.user._id,
      requestId: req.id,
      toWalletId,
      walletBalance: destWallet.balance.toString(),
      walletCurrency: destWallet.currency,
      timestamp: new Date().toISOString(),
    });

    // Log currency conversion if needed
    logger.debug("Currency conversion check", {
      userId: req.user._id,
      requestId: req.id,
      fromCurrency: sourceWallet.currency,
      toCurrency: destWallet.currency,
      beforeConversion: decimalAmount.toString(),
      timestamp: new Date().toISOString(),
    });

    // Convert amount to destination wallet currency if different
    const convertedAmount = await convertCurrency(
      decimalAmount,
      sourceWallet.currency,
      destWallet.currency
    );

    logger.debug("After currency conversion", {
      userId: req.user._id,
      requestId: req.id,
      fromCurrency: sourceWallet.currency,
      toCurrency: destWallet.currency,
      beforeConversion: decimalAmount.toString(),
      afterConversion: convertedAmount.toString(),
      conversionRate: (
        parseFloat(convertedAmount.toString()) /
        parseFloat(decimalAmount.toString())
      ).toFixed(8),
      timestamp: new Date().toISOString(),
    });

    // Deduct from source wallet
    const oldSourceWalletBalance = sourceWallet.balance.toString();
    sourceWallet.balance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(sourceWallet.balance.toString()) -
        parseFloat(decimalAmount.toString())
      ).toFixed(8)
    );

    logger.debug("Updating source wallet balance", {
      userId: req.user._id,
      requestId: req.id,
      walletId: sourceWallet._id,
      oldBalance: oldSourceWalletBalance,
      amountDeducted: decimalAmount.toString(),
      newBalance: sourceWallet.balance.toString(),
      timestamp: new Date().toISOString(),
    });

    await sourceWallet.save({ session });

    // Add to destination wallet
    const oldDestWalletBalance = destWallet.balance.toString();
    destWallet.balance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(destWallet.balance.toString()) +
        parseFloat(convertedAmount.toString())
      ).toFixed(8)
    );

    logger.debug("Updating destination wallet balance", {
      userId: req.user._id,
      requestId: req.id,
      walletId: destWallet._id,
      oldBalance: oldDestWalletBalance,
      amountAdded: convertedAmount.toString(),
      newBalance: destWallet.balance.toString(),
      timestamp: new Date().toISOString(),
    });

    await destWallet.save({ session });

    // Generate transaction reference
    const reference = `SW-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // Create transaction record
    const transaction = new WalletTransaction({
      user: req.user._id,
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
      reference,
    });

    logger.debug("Creating transaction record", {
      userId: req.user._id,
      requestId: req.id,
      transactionReference: reference,
      transactionDetails: {
        type: "swap",
        amount: decimalAmount.toString(),
        currency: sourceWallet.currency,
        sourceId: sourceWallet._id.toString(),
        sourceType: "wallet",
        destinationId: destWallet._id.toString(),
        destinationType: "wallet",
        destinationCurrency: destWallet.currency,
        conversionRate:
          sourceWallet.currency !== destWallet.currency
            ? (
                parseFloat(convertedAmount.toString()) /
                parseFloat(decimalAmount.toString())
              ).toFixed(8)
            : "1.00000000",
        status: "completed",
      },
      timestamp: new Date().toISOString(),
    });

    await transaction.save({ session });

    // Commit the transaction
    logger.debug("Committing database transaction", {
      userId: req.user._id,
      requestId: req.id,
      reference,
      timestamp: new Date().toISOString(),
    });

    await session.commitTransaction();
    session.endSession();

    logger.info("Swap completed successfully", {
      userId: req.user._id,
      requestId: req.id,
      transactionReference: reference,
      amount: decimalAmount.toString(),
      fromCurrency: sourceWallet.currency,
      toCurrency: destWallet.currency,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      status: "success",
      message: "Wallet swap successful",
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

    logger.error("Swap transaction failed:", {
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
