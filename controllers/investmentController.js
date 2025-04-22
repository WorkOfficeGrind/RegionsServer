const mongoose = require("mongoose");
const InvestmentPlan = require("../models/InvestmentPlan");
const UserInvestment = require("../models/UserInvestment");
const InvestmentTransaction = require("../models/InvestmentTransaction");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const { logger } = require("../config/logger");
const apiResponse = require("../utils/apiResponse");
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
  try {
    // If currencies are the same, no conversion needed
    if (fromCurrency === toCurrency) {
      return amount;
    }

    // In a real-world scenario, you would call an external API or use a service
    // like CoinGecko, CoinMarketCap, or a forex API to get real-time exchange rates

    logger.debug(`Converting currency from ${fromCurrency} to ${toCurrency}`, {
      amount: amount.toString(),
      fromCurrency,
      toCurrency,
      timestamp: new Date().toISOString()
    });

    // Convert amount to USD first (as an intermediate currency)
    const toUSD = await convertToUSD(amount, fromCurrency);

    // If destination is USD, return the USD amount
    if (toCurrency === "USD") {
      return toUSD;
    }

    // Otherwise convert from USD to destination currency
    return await convertFromUSD(toUSD, toCurrency);
  } catch (error) {
    logger.error("Error in currency conversion:", {
      error: error.message,
      stack: error.stack,
      fromCurrency,
      toCurrency,
      amount: amount?.toString() || "undefined",
      timestamp: new Date().toISOString()
    });
    throw error;
  }
};

/**
 * @desc    Convert given amount to USD
 * @param {mongoose.Types.Decimal128} amount - Amount to convert
 * @param {string} currency - Source currency
 * @returns {Promise<mongoose.Types.Decimal128>} - Converted amount in USD
 */
const convertToUSD = async (amount, currency) => {
  try {
    if (currency === "USD") {
      return amount;
    }

    // Check if we have a rate for this currency
    if (!toUSDrates[currency]) {
      logger.error(`Unsupported currency for conversion to USD: ${currency}`, {
        amount: amount.toString(),
        currency,
        availableRates: Object.keys(toUSDrates),
        timestamp: new Date().toISOString()
      });
      throw new Error(`Unsupported currency for conversion: ${currency}`);
    }

    // Convert to USD
    const amountFloat = parseFloat(amount.toString());
    const usdValue = amountFloat * toUSDrates[currency];

    logger.debug(`Converted ${currency} to USD`, {
      originalAmount: amount.toString(),
      currency,
      rate: toUSDrates[currency],
      usdValue: usdValue.toFixed(8),
      timestamp: new Date().toISOString()
    });

    return mongoose.Types.Decimal128.fromString(usdValue.toFixed(8));
  } catch (error) {
    logger.error("Error converting to USD:", {
      error: error.message,
      stack: error.stack,
      amount: amount?.toString() || "undefined",
      currency,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
};

/**
 * @desc    Convert USD amount to specified currency
 * @param {mongoose.Types.Decimal128} usdAmount - Amount in USD
 * @param {string} currency - Target currency
 * @returns {Promise<mongoose.Types.Decimal128>} - Converted amount
 */
const convertFromUSD = async (usdAmount, currency) => {
  try {
    if (currency === "USD") {
      return usdAmount;
    }

    // Check if we have a rate for this currency
    if (!fromUSDrates[currency]) {
      logger.error(`Unsupported currency for conversion from USD: ${currency}`, {
        usdAmount: usdAmount.toString(),
        currency,
        availableRates: Object.keys(fromUSDrates),
        timestamp: new Date().toISOString()
      });
      throw new Error(`Unsupported currency for conversion: ${currency}`);
    }

    // Convert from USD to target currency
    const usdFloat = parseFloat(usdAmount.toString());
    const convertedValue = usdFloat * fromUSDrates[currency];

    logger.debug(`Converted USD to ${currency}`, {
      usdAmount: usdAmount.toString(),
      currency,
      rate: fromUSDrates[currency],
      convertedValue: convertedValue.toFixed(8),
      timestamp: new Date().toISOString()
    });

    return mongoose.Types.Decimal128.fromString(convertedValue.toFixed(8));
  } catch (error) {
    logger.error("Error converting from USD:", {
      error: error.message,
      stack: error.stack,
      usdAmount: usdAmount?.toString() || "undefined",
      currency,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
};

/**
 * @desc    Get all available investment plans
 * @route   GET /api/investments/plans
 * @access  Private
 */
exports.getInvestmentPlans = async (req, res) => {
  try {
    logger.info("Fetching investment plans", {
      userId: req.user._id,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });

    const plans = await InvestmentPlan.find({ isActive: true }).sort({
      minInvestment: 1,
      expectedReturnMin: 1,
    });

    logger.debug("Investment plans fetched successfully", {
      userId: req.user._id,
      requestId: req.id,
      plansCount: plans.length,
      timestamp: new Date().toISOString(),
    });

    return apiResponse.success(
      res,
      200,
      "Investment Plans Retrieved",
      "Investment plans fetched successfully",
      { plans }
    );
  } catch (error) {
    logger.error("Error fetching investment plans:", {
      error: error.message,
      stack: error.stack,
      userId: req.user?._id,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });
    
    return apiResponse.error(
      res,
      500,
      "Plans Retrieval Failed",
      "Error fetching investment plans",
      "PLANS_FETCH_ERROR"
    );
  }
}

/**
 * @desc    Get a specific investment plan
 * @route   GET /api/investments/plans/:id
 * @access  Private
 */
exports.getInvestmentPlan = async (req, res) => {
  try {
    const { id } = req.params;

    logger.info("Fetching specific investment plan", {
      userId: req.user._id,
      requestId: req.id,
      planId: id,
      timestamp: new Date().toISOString(),
    });

    const plan = await InvestmentPlan.findById(id);

    if (!plan) {
      logger.warn("Investment plan not found", {
        userId: req.user._id,
        requestId: req.id,
        planId: id,
        timestamp: new Date().toISOString(),
      });
      return apiResponse.notFound(
        res, 
        "Plan Not Found", 
        "No investment plan found with that ID",
        "PLAN_NOT_FOUND"
      );
    }

    logger.debug("Investment plan fetched successfully", {
      userId: req.user._id,
      requestId: req.id,
      planId: id,
      timestamp: new Date().toISOString(),
    });

    return apiResponse.success(
      res,
      200,
      "Investment Plan Retrieved",
      "Investment plan fetched successfully",
      { plan }
    );
  } catch (error) {
    logger.error("Error fetching investment plan:", {
      error: error.message,
      stack: error.stack,
      userId: req.user?._id,
      requestId: req.id,
      planId: req.params?.id,
      timestamp: new Date().toISOString(),
    });
    
    return apiResponse.error(
      res,
      500,
      "Plan Retrieval Failed",
      "Error fetching investment plan",
      "PLAN_FETCH_ERROR"
    );
  }
}

/**
 * @desc    Create a new investment
 * @route   POST /api/investments
 * @access  Private
 */
exports.createInvestment = async (req, res) => {
  // Start logging - capture initial request data
  logger.info("Investment creation request initiated", {
    userId: req.user._id,
    requestId: req.id,
    requestBody: {
      planId: req.body.planId,
      amount: req.body.amount,
      sourceWalletId: req.body.sourceWalletId,
      compoundFrequency: req.body.compoundFrequency,
      label: req.body.label,
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
      planId,
      amount,
      sourceWalletId,
      compoundFrequency = "monthly",
      label,
    } = req.body;

    // Validate required fields
    if (!planId || !amount || !sourceWalletId) {
      await session.abortTransaction();
      session.endSession();
      
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Missing required fields for creating investment",
        "MISSING_INVESTMENT_FIELDS"
      );
    }

    // Convert amount to Decimal128 for precise calculations
    const decimalAmount = mongoose.Types.Decimal128.fromString(
      amount.toString()
    );

    // Validate investment plan
    const plan = await InvestmentPlan.findById(planId).session(session);

    if (!plan || !plan.isActive) {
      logger.warn("Invalid or inactive investment plan", {
        userId: req.user._id,
        requestId: req.id,
        planId,
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      session.endSession();
      
      return apiResponse.badRequest(
        res,
        "Invalid Plan",
        "Invalid or inactive investment plan",
        "INVALID_INVESTMENT_PLAN"
      );
    }

    // Find source wallet
    const sourceWallet = await Wallet.findOne({
      _id: sourceWalletId,
      user: req.user._id,
    }).session(session);

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
        "Wallet Not Found",
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
        investmentAmount: decimalAmount.toString(),
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

    // Convert amount from source wallet currency to plan currency for minimum investment check
    let investmentAmountInPlanCurrency;
    try {
      if (sourceWallet.currency !== plan.currency) {
        // Convert to plan currency (typically USD) for comparison with minimum
        investmentAmountInPlanCurrency = await convertCurrency(
          decimalAmount,
          sourceWallet.currency,
          plan.currency
        );

        logger.debug("Currency conversion for minimum investment check", {
          userId: req.user._id,
          requestId: req.id,
          fromCurrency: sourceWallet.currency,
          toCurrency: plan.currency,
          beforeConversion: decimalAmount.toString(),
          afterConversion: investmentAmountInPlanCurrency.toString(),
          timestamp: new Date().toISOString(),
        });
      } else {
        investmentAmountInPlanCurrency = decimalAmount;
      }
    } catch (error) {
      logger.error("Currency conversion error", {
        userId: req.user._id,
        requestId: req.id,
        fromCurrency: sourceWallet.currency,
        toCurrency: plan.currency,
        amount: decimalAmount.toString(),
        error: error.message,
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      session.endSession();
      
      return apiResponse.error(
        res,
        500,
        "Conversion Error",
        "Error converting currency",
        "CURRENCY_CONVERSION_ERROR"
      );
    }

    // Check minimum investment amount AFTER converting to plan currency (usually USD)
    if (
      parseFloat(investmentAmountInPlanCurrency.toString()) < plan.minInvestment
    ) {
      logger.warn("Investment amount below minimum", {
        userId: req.user._id,
        requestId: req.id,
        planId,
        walletCurrency: sourceWallet.currency,
        planCurrency: plan.currency,
        originalAmount: decimalAmount.toString(),
        convertedAmount: investmentAmountInPlanCurrency.toString(),
        minimumRequired: plan.minInvestment,
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      session.endSession();
      
      return apiResponse.badRequest(
        res,
        "Below Minimum",
        `Minimum investment amount is ${plan.minInvestment} ${plan.currency}`,
        "BELOW_MINIMUM_INVESTMENT"
      );
    }

    // We're already converted to plan currency above, so use that value
    let investmentAmount = investmentAmountInPlanCurrency;

    // Calculate maturity date based on plan duration
    const investedAt = new Date();
    const maturityDate = new Date();

    // Ensure plan.maturityPeriod is a number
    const maturityPeriod =
      typeof plan.maturityPeriod === "number"
        ? plan.maturityPeriod
        : parseInt(plan.maturityPeriod, 10) || 30; // Default to 30 days if invalid

    maturityDate.setDate(maturityDate.getDate() + maturityPeriod);

    // Validate that maturityDate is valid
    if (isNaN(maturityDate.getTime())) {
      logger.error("Invalid maturity date calculation", {
        userId: req.user._id,
        requestId: req.id,
        investedAt: investedAt.toISOString(),
        maturityPeriod,
        planId: plan._id,
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      session.endSession();
      
      return apiResponse.badRequest(
        res,
        "Invalid Date",
        "Could not calculate valid maturity date",
        "INVALID_MATURITY_DATE"
      );
    }

    // Create the investment
    const userInvestment = new UserInvestment({
      user: req.user._id,
      plan: plan._id,
      source: sourceWallet._id,
      label: label || `Investment in ${plan.name}`,
      currency: plan.currency,
      rate: plan.expectedReturnMax, // Using max rate as the target
      amount: investmentAmount,
      currentValue: investmentAmount, // Initially same as investment amount
      investedAt,
      maturityDate,
      status: "active",
      compoundFrequency,
      withdrawalAllowed: plan.earlyWithdrawalAllowed || false,
      earlyWithdrawalFee: plan.earlyWithdrawalFee || 0,
      lastInterestCalculatedAt: investedAt,
      interestPaidOut: 0,
    });

    // Save the investment
    await userInvestment.save({ session });

    logger.debug("User investment created", {
      userId: req.user._id,
      requestId: req.id,
      investmentId: userInvestment._id,
      planId,
      amount: investmentAmount.toString(),
      maturityDate,
      timestamp: new Date().toISOString(),
    });

    // Deduct from wallet
    const oldWalletBalance = sourceWallet.balance.toString();
    sourceWallet.balance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(sourceWallet.balance.toString()) -
        parseFloat(decimalAmount.toString())
      ).toFixed(8)
    );

    logger.debug("Deducting from wallet", {
      userId: req.user._id,
      requestId: req.id,
      walletId: sourceWallet._id,
      oldBalance: oldWalletBalance,
      deductedAmount: decimalAmount.toString(),
      newBalance: sourceWallet.balance.toString(),
      timestamp: new Date().toISOString(),
    });

    await sourceWallet.save({ session });

    // Create transaction record
    const reference = `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const transaction = new InvestmentTransaction({
      user: req.user._id,
      type: "investment",
      amount: investmentAmount,
      currency: sourceWallet.currency,
      sourceAmount: decimalAmount,
      source: sourceWallet._id,
      sourceType: "Wallet",
      sourceCurrency: sourceWallet.currency,
      beneficiary: userInvestment._id,
      beneficiaryType: "UserInvestment",
      beneficiaryCurrency: plan.currency,
      description: `Investment in ${plan.name}`,
      status: "completed",
      reference,
    });

    await transaction.save({ session });

    // Add transaction to investment
    userInvestment.transactions.push(transaction._id);
    await userInvestment.save({ session });

    // Get the user and add the investment to their investments array
    const User = mongoose.model("User");
    const user = await User.findById(req.user._id).session(session);

    // Initialize investments array if it doesn't exist
    if (!user.investments) {
      user.investments = [];
    }

    // Add the investment ID to the user's investments array
    user.investments.push(userInvestment._id);

    logger.debug("Adding investment to user's investments array", {
      userId: user._id,
      requestId: req.id,
      investmentId: userInvestment._id,
      investmentsCount: user.investments.length,
      timestamp: new Date().toISOString(),
    });

    await user.save({ session });
    
    // Create notification for the user
    await notificationService.createNotification(
      user._id,
      "Investment Created Successfully",
      `Your investment of ${parseFloat(investmentAmount.toString()).toFixed(2)} ${plan.currency} in ${plan.name} has been created successfully.`,
      "investment",
      { 
        investmentId: userInvestment._id,
        planName: plan.name,
        amount: investmentAmount.toString(),
        currency: plan.currency,
        maturityDate: maturityDate
      },
      session
    );

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Investment created successfully", {
      userId: req.user._id,
      requestId: req.id,
      investmentId: userInvestment._id,
      transactionId: transaction._id,
      planId,
      amount: investmentAmount.toString(),
      reference,
      timestamp: new Date().toISOString(),
    });

    // Fetch the populated investment to return
    const populatedInvestment = await UserInvestment.findById(
      userInvestment._id
    )
      .populate("plan")
      .populate("source")
      .populate("transactions");

    // Return successful response
    return apiResponse.created(
      res,
      "Investment Created",
      "Your investment has been created successfully",
      {
        investment: populatedInvestment,
        transaction,
        reference,
      }
    );
  } catch (error) {
    // Abort transaction if error occurs
    logger.error("Aborting investment creation due to error", {
      userId: req.user?._id,
      requestId: req.id,
      errorMessage: error.message,
      errorStack: error.stack,
      timestamp: new Date().toISOString(),
    });

    await session.abortTransaction();
    session.endSession();

    logger.error("Investment creation failed:", {
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
      "Investment Creation Failed",
      "Error creating investment",
      "INVESTMENT_CREATION_ERROR"
    );
  }
}

/**
 * @desc    Get user's investments
 * @route   GET /api/investments
 * @access  Private
 */
exports.getUserInvestments = async (req, res) => {
  try {
    const { status, sortBy = "-investedAt" } = req.query;

    logger.info("Fetching user investments", {
      userId: req.user._id,
      requestId: req.id,
      queryParams: req.query,
      timestamp: new Date().toISOString(),
    });

    // Build query
    const query = { user: req.user._id };

    // Add status filter if provided
    if (
      status &&
      ["active", "matured", "withdrawn", "cancelled"].includes(status)
    ) {
      query.status = status;
    }

    // Get investments with plan details
    const investments = await UserInvestment.find(query)
      .populate("plan")
      .populate("source")
      .sort(sortBy)
      .exec();

    const normalizedInvestments = investments.map((investment) => {
      if (!investment.previousValue && investment.previousValue !== 0) {
        investment.previousValue = investment.currentValue;
      }
      return investment;
    });

    logger.debug("User investments fetched", {
      userId: req.user._id,
      requestId: req.id,
      count: investments.length,
      timestamp: new Date().toISOString(),
    });

    // Return investments
    return apiResponse.success(
      res,
      200,
      "Investments Retrieved",
      "Your investments have been retrieved successfully",
      { investments: normalizedInvestments }
    );
  } catch (error) {
    logger.error("Error fetching user investments:", {
      error: error.message,
      stack: error.stack,
      userId: req.user?._id,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });
    
    return apiResponse.error(
      res,
      500,
      "Investments Retrieval Failed",
      "Error fetching your investments",
      "INVESTMENTS_FETCH_ERROR"
    );
  }
}

/**
 * @desc    Get investment performance metrics
 * @route   GET /api/investments/performance
 * @access  Private
 */
exports.getInvestmentPerformance = async (req, res) => {
  try {
    logger.info("Fetching investment performance metrics", {
      userId: req.user._id,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });

    // Get all active investments
    const activeInvestments = await UserInvestment.find({
      user: req.user._id,
      status: "active",
    })
      .populate("plan")
      .exec();

    // Calculate current values for all active investments
    const updatedInvestments = await Promise.all(
      activeInvestments.map(async (investment) => {
        try {
          await investment.calculateInterest();
          return investment;
        } catch (error) {
          logger.error("Error calculating interest for performance metrics:", {
            error: error.message,
            stack: error.stack,
            userId: req.user._id,
            requestId: req.id,
            investmentId: investment._id,
            timestamp: new Date().toISOString(),
          });
          return investment; // Return unchanged investment on error
        }
      })
    );

    // Get all investments including matured/withdrawn for historical data
    const allInvestments = await UserInvestment.find({
      user: req.user._id,
    })
      .populate("plan")
      .exec();

    // Calculate total metrics
    const totalInvested = allInvestments.reduce(
      (sum, inv) => sum + parseFloat(inv.amount.toString()),
      0
    );

    const totalCurrentValue = updatedInvestments.reduce(
      (sum, inv) => sum + parseFloat(inv.currentValue.toString()),
      0
    );

    const totalInitialValue = updatedInvestments.reduce(
      (sum, inv) => sum + parseFloat(inv.amount.toString()),
      0
    );

    // Calculate growth percentage
    const overallGrowth =
      totalInitialValue > 0
        ? (
            ((totalCurrentValue - totalInitialValue) / totalInitialValue) *
            100
          ).toFixed(2)
        : 0;

    // Get total returns from completed investments
    const completedInvestments = allInvestments.filter(
      (inv) => inv.status === "withdrawn" || inv.status === "matured"
    );

    const totalCompletedReturns = completedInvestments.reduce((sum, inv) => {
      const returns =
        parseFloat(inv.currentValue.toString()) -
        parseFloat(inv.amount.toString());
      return sum + (returns > 0 ? returns : 0);
    }, 0);

    // Get performance by plan
    const performanceByPlan = {};
    allInvestments.forEach((inv) => {
      const planName = inv.plan.name;
      if (!performanceByPlan[planName]) {
        performanceByPlan[planName] = {
          totalInvested: 0,
          currentValue: 0,
          count: 0,
        };
      }

      performanceByPlan[planName].totalInvested += parseFloat(
        inv.amount.toString()
      );
      performanceByPlan[planName].currentValue += parseFloat(
        inv.currentValue.toString()
      );
      performanceByPlan[planName].count += 1;
    });

    // Calculate growth percentage for each plan
    Object.keys(performanceByPlan).forEach((planName) => {
      const plan = performanceByPlan[planName];
      plan.growthPercentage =
        plan.totalInvested > 0
          ? (
              ((plan.currentValue - plan.totalInvested) / plan.totalInvested) *
              100
            ).toFixed(2)
          : 0;
    });

    // Get top performing investments
    const topInvestments = [...updatedInvestments]
      .sort((a, b) => {
        const roiA = a.roi || 0;
        const roiB = b.roi || 0;
        return roiB - roiA;
      })
      .slice(0, 5);

    logger.debug("Investment performance metrics calculated", {
      userId: req.user._id,
      requestId: req.id,
      activeInvestmentsCount: updatedInvestments.length,
      totalInvestmentsCount: allInvestments.length,
      totalInvested,
      totalCurrentValue,
      overallGrowth,
      timestamp: new Date().toISOString(),
    });

    // Return performance metrics
    return apiResponse.success(
      res,
      200,
      "Investment Performance Retrieved",
      "Investment performance metrics have been retrieved successfully",
      {
        summary: {
          totalInvested,
          totalCurrentValue,
          activeInvestments: updatedInvestments.length,
          totalInvestments: allInvestments.length,
          overallGrowth,
          totalCompletedReturns,
        },
        performanceByPlan,
        topInvestments: topInvestments.map((inv) => ({
          _id: inv._id,
          planName: inv.plan.name,
          investedAmount: parseFloat(inv.amount.toString()),
          currentValue: parseFloat(inv.currentValue.toString()),
          roi: inv.roi,
          investedAt: inv.investedAt,
          maturityDate: inv.maturityDate,
        })),
      }
    );
  } catch (error) {
    logger.error("Error fetching investment performance:", {
      error: error.message,
      stack: error.stack,
      userId: req.user?._id,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });
    
    return apiResponse.error(
      res,
      500,
      "Performance Retrieval Failed",
      "Error fetching investment performance metrics",
      "PERFORMANCE_METRICS_ERROR"
    );
  }
}

/**
 * @desc    Process investment growth (simulated daily growth)
 * @route   POST /api/investments/process-growth
 * @access  Private/Admin
 */
exports.processInvestmentGrowth = async (req, res) => {
  try {
    logger.info("Processing investment growth", {
      userId: req.user._id,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });

    // This endpoint would typically be called by a scheduler/cron job
    // Check if user has admin privileges
    if (!req.user.isAdmin) {
      logger.warn("Unauthorized attempt to process investment growth", {
        userId: req.user._id,
        requestId: req.id,
        timestamp: new Date().toISOString(),
      });
      return apiResponse.unauthorized(
        res,
        "Unauthorized",
        "You do not have permission to perform this action",
        "ADMIN_PERMISSION_REQUIRED"
      );
    }

    // Start a transaction for batch processing
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Get all active investments
      const activeInvestments = await UserInvestment.find({
        status: "active",
      }).populate("plan").session(session);

      logger.debug("Found active investments for growth processing", {
        count: activeInvestments.length,
        requestId: req.id,
        timestamp: new Date().toISOString(),
      });

      // Process each investment
      const results = await Promise.all(
        activeInvestments.map(async (investment) => {
          try {
            const result = await investment.calculateInterest();
            
            // Create notification for significant growth (e.g., > 2%)
            if (result.success && result.interestEarned) {
              const interestPercent = (parseFloat(result.interestEarned.toString()) / 
                                       parseFloat(investment.currentValue.toString() || "1")) * 100;
              
              if (interestPercent >= 2) {
                await notificationService.createNotification(
                  investment.user,
                  "Significant Investment Growth",
                  `Your investment in ${investment.plan.name} has grown by ${interestPercent.toFixed(2)}% today.`,
                  "investment",
                  {
                    investmentId: investment._id,
                    planName: investment.plan.name,
                    growthAmount: result.interestEarned.toString(),
                    growthPercent: interestPercent.toFixed(2),
                    currentValue: result.currentValue.toString()
                  },
                  session
                );
              }
            }
            
            return {
              investmentId: investment._id,
              userId: investment.user,
              success: result.success,
              message: result.message,
              interestEarned: result.interestEarned?.toString() || "0",
              currentValue:
                result.currentValue?.toString() ||
                investment.currentValue.toString(),
            };
          } catch (error) {
            logger.error("Error processing growth for investment:", {
              error: error.message,
              stack: error.stack,
              investmentId: investment._id,
              userId: investment.user,
              requestId: req.id,
              timestamp: new Date().toISOString(),
            });
            return {
              investmentId: investment._id,
              userId: investment.user,
              success: false,
              message: error.message,
              error: true,
            };
          }
        })
      );

      // Summarize results
      const successful = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      await session.commitTransaction();
      session.endSession();

      logger.info("Investment growth processing completed", {
        totalProcessed: results.length,
        successful,
        failed,
        requestId: req.id,
        timestamp: new Date().toISOString(),
      });

      // Return results
      return apiResponse.success(
        res,
        200,
        "Investment Growth Processed",
        `Processed ${results.length} investments: ${successful} successful, ${failed} failed`,
        {
          summary: {
            totalProcessed: results.length,
            successful,
            failed,
          },
          results,
        }
      );
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  } catch (error) {
    logger.error("Error in investment growth processing:", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });
    
    return apiResponse.error(
      res,
      500,
      "Growth Processing Failed",
      "Error processing investment growth",
      "GROWTH_PROCESSING_ERROR"
    );
  }
}

/**
 * @desc    Add liquidity to an existing investment
 * @route   POST /api/investments/:id/add-liquidity
 * @access  Private
 */
exports.addLiquidityToInvestment = async (req, res) => {
  // Start logging - capture initial request data
  logger.info("Add liquidity to investment request initiated", {
    userId: req.user._id,
    requestId: req.id,
    investmentId: req.params.id,
    requestBody: {
      amount: req.body.amount,
      sourceWalletId: req.body.sourceWalletId,
    },
    timestamp: new Date().toISOString(),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });

  // Start a database transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { amount, sourceWalletId } = req.body;
    
    // Validate required fields
    if (!amount || !sourceWalletId) {
      await session.abortTransaction();
      session.endSession();
      
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Amount and source wallet ID are required",
        "MISSING_REQUIRED_FIELDS"
      );
    }

    // Convert amount to Decimal128 for precise calculations
    const decimalAmount = mongoose.Types.Decimal128.fromString(
      amount.toString()
    );

    // Find the investment
    const investment = await UserInvestment.findOne({
      _id: id,
      user: req.user._id,
      status: "active", // Only active investments can receive additional liquidity
    })
      .populate("plan")
      .session(session);

    if (!investment) {
      logger.warn("Investment not found or not active", {
        userId: req.user._id,
        requestId: req.id,
        investmentId: id,
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      session.endSession();
      
      return apiResponse.notFound(
        res,
        "Not Found",
        "Active investment not found",
        "INVESTMENT_NOT_FOUND"
      );
    }

    // Find source wallet
    const sourceWallet = await Wallet.findOne({
      _id: sourceWalletId,
      user: req.user._id,
    }).session(session);

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
        "Bad Request",
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
        investmentAmount: decimalAmount.toString(),
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

    // Convert amount from source wallet currency to investment currency if needed
    let additionalAmountInInvestmentCurrency;
    try {
      if (sourceWallet.currency !== investment.currency) {
        additionalAmountInInvestmentCurrency = await convertCurrency(
          decimalAmount,
          sourceWallet.currency,
          investment.currency
        );

        logger.debug("Currency conversion for add liquidity", {
          userId: req.user._id,
          requestId: req.id,
          fromCurrency: sourceWallet.currency,
          toCurrency: investment.currency,
          beforeConversion: decimalAmount.toString(),
          afterConversion: additionalAmountInInvestmentCurrency.toString(),
          timestamp: new Date().toISOString(),
        });
      } else {
        additionalAmountInInvestmentCurrency = decimalAmount;
      }
    } catch (error) {
      logger.error("Currency conversion error during add liquidity", {
        userId: req.user._id,
        requestId: req.id,
        fromCurrency: sourceWallet.currency,
        toCurrency: investment.currency,
        amount: decimalAmount.toString(),
        error: error.message,
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      session.endSession();
      
      return apiResponse.error(
        res,
        500,
        "Conversion Error",
        "Error converting currency",
        "CURRENCY_CONVERSION_ERROR"
      );
    }

    // Calculate current value before adding liquidity
    if (investment.status === "active") {
      try {
        await investment.calculateInterest();
        logger.debug("Interest calculated before adding liquidity", {
          userId: req.user._id,
          requestId: req.id,
          investmentId: id,
          currentValue: investment.currentValue.toString(),
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error("Error calculating interest before adding liquidity:", {
          error: error.message,
          stack: error.stack,
          userId: req.user._id,
          requestId: req.id,
          investmentId: id,
          timestamp: new Date().toISOString(),
        });
        await session.abortTransaction();
        session.endSession();
        
        return apiResponse.error(
          res,
          500,
          "Calculation Error",
          "Error calculating current investment value",
          "INTEREST_CALCULATION_ERROR"
        );
      }
    }

    // Store old values for logging and record keeping
    const oldAmount = parseFloat(investment.amount.toString());
    const oldCurrentValue = parseFloat(investment.currentValue.toString());
    const additionalAmount = parseFloat(
      additionalAmountInInvestmentCurrency.toString()
    );

    // Update the investment with new values
    investment.amount = mongoose.Types.Decimal128.fromString(
      (oldAmount + additionalAmount).toFixed(8)
    );
    investment.currentValue = mongoose.Types.Decimal128.fromString(
      (oldCurrentValue + additionalAmount).toFixed(8)
    );

    // Make sure to update previousValue to maintain correct growth tracking
    if (
      !investment.previousValue ||
      parseFloat(investment.previousValue.toString()) === 0
    ) {
      investment.previousValue = investment.currentValue;
    }

    // Generate reference for transaction
    const reference = `INV-ADD-${Date.now()}-${Math.floor(
      Math.random() * 1000
    )}`;

    // Deduct from wallet
    const oldWalletBalance = sourceWallet.balance.toString();
    sourceWallet.balance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(sourceWallet.balance.toString()) -
        parseFloat(decimalAmount.toString())
      ).toFixed(8)
    );

    logger.debug("Deducting from wallet", {
      userId: req.user._id,
      requestId: req.id,
      walletId: sourceWallet._id,
      oldBalance: oldWalletBalance,
      deductedAmount: decimalAmount.toString(),
      newBalance: sourceWallet.balance.toString(),
      timestamp: new Date().toISOString(),
    });

    await sourceWallet.save({ session });

    // Create debit transaction for wallet
    const walletTransaction = new WalletTransaction({
      user: req.user._id,
      type: "debit",
      amount: decimalAmount,
      currency: sourceWallet.currency,
      source: sourceWallet._id,
      sourceType: "Wallet",
      sourceCurrency: sourceWallet.currency,
      beneficiary: investment._id,
      beneficiaryType: "UserInvestment",
      beneficiaryCurrency: investment.currency,
      conversionRate:
        sourceWallet.currency !== investment.currency
          ? parseFloat(additionalAmountInInvestmentCurrency.toString()) /
            parseFloat(decimalAmount.toString())
          : 1,
      description: `Additional liquidity for investment in ${investment.plan.name}`,
      status: "completed",
      reference: `${reference}-DEBIT`,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      completedAt: new Date(),
    });

    // Create credit transaction for investment
    const investmentTransaction = new InvestmentTransaction({
      user: req.user._id,
      type: "investment",
      amount: additionalAmountInInvestmentCurrency,
      currency: investment.currency,
      sourceAmount: decimalAmount,
      source: sourceWallet._id,
      sourceType: "Wallet",
      sourceCurrency: sourceWallet.currency,
      beneficiary: investment._id,
      beneficiaryType: "UserInvestment",
      beneficiaryCurrency: investment.currency,
      description: `Additional liquidity for investment in ${investment.plan.name}`,
      status: "completed",
      reference: `${reference}-CREDIT`,
    });

    // Save both transactions
    await walletTransaction.save({ session });
    await investmentTransaction.save({ session });

    // Add transaction to investment
    investment.transactions.push(investmentTransaction._id);
    await investment.save({ session });

    // Add transaction to wallet
    if (!sourceWallet.transactions) {
      sourceWallet.transactions = [];
    }
    sourceWallet.transactions.push(walletTransaction._id);
    sourceWallet.lastActivityAt = new Date();
    await sourceWallet.save({ session });
    
    // Create notification for the user
    await notificationService.createNotification(
      req.user._id,
      "Liquidity Added to Investment",
      `Additional liquidity of ${parseFloat(additionalAmountInInvestmentCurrency.toString()).toFixed(2)} ${investment.currency} has been added to your investment in ${investment.plan.name}.`,
      "investment",
      {
        investmentId: investment._id,
        planName: investment.plan.name,
        addedAmount: additionalAmountInInvestmentCurrency.toString(),
        currency: investment.currency,
        newTotalAmount: investment.amount.toString(),
        transactionReference: reference
      },
      session
    );

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Liquidity added to investment successfully", {
      userId: req.user._id,
      requestId: req.id,
      investmentId: investment._id,
      walletTransactionId: walletTransaction._id,
      investmentTransactionId: investmentTransaction._id,
      originalAmount: oldAmount.toFixed(8),
      additionalAmount: additionalAmount.toFixed(8),
      newTotalAmount: investment.amount.toString(),
      originalValue: oldCurrentValue.toFixed(8),
      newTotalValue: investment.currentValue.toString(),
      reference,
      timestamp: new Date().toISOString(),
    });

    // Fetch the fully populated investment to return
    const populatedInvestment = await UserInvestment.findById(investment._id)
      .populate("plan")
      .populate("source")
      .populate("transactions");

    // Return successful response
    return apiResponse.success(
      res,
      200,
      "Liquidity Added",
      "Additional funds have been added to your investment successfully",
      {
        investment: populatedInvestment,
        walletTransaction,
        investmentTransaction,
        originalAmount: oldAmount.toFixed(8),
        additionalAmount: additionalAmount.toFixed(8),
        newTotalAmount: investment.amount.toString(),
        reference,
      }
    );
  } catch (error) {
    // Abort transaction if error occurs
    logger.error("Aborting add liquidity operation due to error", {
      userId: req.user?._id,
      requestId: req.id,
      investmentId: req.params?.id,
      errorMessage: error.message,
      errorStack: error.stack,
      timestamp: new Date().toISOString(),
    });

    await session.abortTransaction();
    session.endSession();

    logger.error("Add liquidity to investment failed:", {
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
      "Liquidity Addition Failed",
      "Error adding liquidity to investment",
      "LIQUIDITY_ADDITION_ERROR"
    );
  }
}

/**
 * @desc    Simulate growth on an investment (for testing purposes only)
 * @route   POST /api/investments/:id/simulate-growth
 * @access  Private/Admin
 */
exports.simulateInvestmentGrowth = async (req, res) => {
  try {
    logger.info("Simulating investment growth", {
      userId: req.user._id,
      requestId: req.id,
      investmentId: req.params.id,
      timestamp: new Date().toISOString(),
    });

    // This is a dev/admin endpoint
    if (!req.user.isAdmin && process.env.NODE_ENV === "production") {
      logger.warn("Unauthorized attempt to simulate investment growth", {
        userId: req.user._id,
        requestId: req.id,
        timestamp: new Date().toISOString(),
      });
      return apiResponse.unauthorized(
        res,
        "Unauthorized",
        "You do not have permission to perform this action",
        "ADMIN_PERMISSION_REQUIRED"
      );
    }

    const { id } = req.params;
    const {
      growthPattern = "random", // 'random', 'up', 'down', 'volatile'
      days = 7,
      baseGrowthRate = 0.005, // 0.5% daily average
      volatilityFactor = 0.5, // How much variation
      reset = true,
      applyGrowth = true,
    } = req.body;

    // Start a transaction for the operation
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Find the investment
      const investment = await UserInvestment.findOne({
        _id: id,
        user: req.user._id,
      }).session(session);

      if (!investment) {
        logger.warn("Investment not found for growth simulation", {
          userId: req.user._id,
          requestId: req.id,
          investmentId: id,
          timestamp: new Date().toISOString(),
        });
        await session.abortTransaction();
        session.endSession();
        
        return apiResponse.notFound(
          res,
          "Not Found",
          "Investment not found",
          "INVESTMENT_NOT_FOUND"
        );
      }

      // Validate input parameters
      if (days <= 0 || days > 365) {
        logger.warn("Invalid number of days for growth simulation", {
          userId: req.user._id,
          requestId: req.id,
          investmentId: id,
          days,
          timestamp: new Date().toISOString(),
        });
        await session.abortTransaction();
        session.endSession();
        
        return apiResponse.badRequest(
          res,
          "Invalid Parameter",
          "Number of days must be between 1 and 365",
          "INVALID_DAYS_PARAMETER"
        );
      }

      if (baseGrowthRate < -0.1 || baseGrowthRate > 0.1) {
        logger.warn("Invalid growth rate for simulation", {
          userId: req.user._id,
          requestId: req.id,
          investmentId: id,
          baseGrowthRate,
          timestamp: new Date().toISOString(),
        });
        await session.abortTransaction();
        session.endSession();
        
        return apiResponse.badRequest(
          res,
          "Invalid Parameter",
          "Base growth rate must be between -10% and 10% per day",
          "INVALID_GROWTH_RATE"
        );
      }

      // Initialize metadata object if it doesn't exist
      if (!investment.metadata) {
        investment.metadata = {};
      }

      // Initialize or reset growth schedule
      if (!investment.metadata.growthSchedule || reset) {
        investment.metadata.growthSchedule = [];
        investment.metadata.nextGrowthIndex = 0;
      }

      // Generate growth rates based on pattern
      const growthRates = [];

      // Ensure we have some historical data for comparison if we're resetting
      if (reset) {
        // Add 5 days of baseline growth first to establish a reference point
        for (let i = 0; i < 5; i++) {
          growthRates.push(baseGrowthRate);
        }
      }

      // Now add the pattern-specific growth rates
      for (let i = 0; i < days; i++) {
        let rate;
        const dayPosition = i / days; // Relative position in the simulation period (0 to 1)

        switch (growthPattern) {
          case "up":
            // Gradually increasing trend - starts at base rate and goes up
            rate = baseGrowthRate * (1 + dayPosition * 2);
            // Add some randomness
            rate += (Math.random() - 0.3) * volatilityFactor * baseGrowthRate;
            growthRates.push(Math.max(0, rate));
            break;

          case "down":
            // Gradually decreasing trend - starts at base rate and goes down
            rate = baseGrowthRate * (1 - dayPosition);
            // Add some randomness
            rate += (Math.random() - 0.7) * volatilityFactor * baseGrowthRate;
            growthRates.push(Math.max(0, rate));
            break;

          case "volatile":
            // Highly variable (both positive and negative)
            rate =
              baseGrowthRate +
              (Math.random() * 2 - 1) * volatilityFactor * baseGrowthRate * 3;
            growthRates.push(rate);
            break;

          case "random":
          default:
            // Random variations around base rate
            rate =
              baseGrowthRate +
              (Math.random() * 2 - 1) * volatilityFactor * baseGrowthRate;
            growthRates.push(rate);
            break;
        }
      }

      // Add new growth rates to the schedule
      investment.metadata.growthSchedule = [
        ...investment.metadata.growthSchedule,
        ...growthRates,
      ];

      // Calculate new value based on growth rates
      let currentValue = parseFloat(investment.currentValue.toString());
      const initialValue = currentValue;

      for (let i = 0; i < growthRates.length; i++) {
        const growthRate = growthRates[i];
        currentValue = currentValue * (1 + growthRate);
      }

      // Store previous value before updating current value
      investment.previousValue = investment.currentValue;

      // Update the investment with new value and next growth index
      if (applyGrowth) {
        investment.currentValue = mongoose.Types.Decimal128.fromString(
          currentValue.toFixed(8)
        );
        // Set nextGrowthIndex to one past the end to indicate all growth has been applied
        investment.metadata.nextGrowthIndex =
          investment.metadata.growthSchedule.length;
      }

      await investment.save({ session });
      
      // If there's significant growth, create a notification
      if (applyGrowth && currentValue > initialValue * 1.05) { // More than 5% growth
        const growthPercent = ((currentValue / initialValue - 1) * 100).toFixed(2);
        await notificationService.createNotification(
          req.user._id,
          "Significant Investment Growth Simulated",
          `Your investment has simulated a growth of ${growthPercent}% (for testing purposes).`,
          "investment",
          {
            investmentId: investment._id,
            initialValue: initialValue.toFixed(8),
            currentValue: currentValue.toFixed(8),
            growthPercent: growthPercent,
            growthPattern,
            simulationDays: days
          },
          session
        );
      }

      await session.commitTransaction();
      session.endSession();

      logger.info("Investment growth simulation completed", {
        userId: req.user._id,
        requestId: req.id,
        investmentId: id,
        growthPattern,
        daysSimulated: days,
        initialValue: initialValue.toFixed(8),
        newValue: currentValue.toFixed(8),
        percentageGrowth:
          ((currentValue / initialValue - 1) * 100).toFixed(2) + "%",
        growthRates:
          growthRates.slice(0, 3).map((r) => (r * 100).toFixed(2) + "%") + "...",
        totalGrowthRates: growthRates.length,
        nextGrowthIndex: investment.metadata.nextGrowthIndex,
        timestamp: new Date().toISOString(),
      });

      // Return the simulated investment
      return apiResponse.success(
        res,
        200,
        "Investment Growth Simulated",
        "Growth has been simulated on the investment",
        {
          investment,
          simulationDetails: {
            growthPattern,
            daysSimulated: days,
            initialValue: initialValue.toFixed(8),
            newValue: currentValue.toFixed(8),
            percentageChange:
              ((currentValue / initialValue - 1) * 100).toFixed(2) + "%",
            growthRates: growthRates.map((rate) => (rate * 100).toFixed(4) + "%"),
            totalRates: investment.metadata.growthSchedule.length,
            nextGrowthIndex: investment.metadata.nextGrowthIndex,
          },
        }
      );
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  } catch (error) {
    logger.error("Error simulating investment growth:", {
      error: error.message,
      stack: error.stack,
      userId: req.user?._id,
      requestId: req.id,
      investmentId: req.params?.id,
      timestamp: new Date().toISOString(),
    });
    
    return apiResponse.error(
      res,
      500,
      "Simulation Failed",
      "Error simulating investment growth",
      "GROWTH_SIMULATION_ERROR"
    );
  }
}

/**
 * @desc    Withdraw funds from an investment (partial or full withdrawal)
 * @route   POST /api/investments/:id/withdraw
 * @access  Private
 */
exports.withdrawInvestment = async (req, res, next) => {
  // Start logging
  logger.info("Investment partial withdrawal request initiated", {
    userId: req.user._id,
    requestId: req.id,
    investmentId: req.params.id,
    requestBody: {
      amount: req.body.amount,
      destinationWalletId: req.body.destinationWalletId,
    },
    timestamp: new Date().toISOString(),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });

  // Start a database transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { amount, destinationWalletId } = req.body;

    // Convert amount to Decimal128 for precise calculations
    const withdrawalAmount = mongoose.Types.Decimal128.fromString(
      amount.toString()
    );

    // Find the investment
    const investment = await UserInvestment.findOne({
      _id: id,
      user: req.user._id,
    })
      .populate("plan")
      .session(session);

    if (!investment) {
      logger.warn("Investment not found", {
        userId: req.user._id,
        requestId: req.id,
        investmentId: id,
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      return apiResponse.notFound(res, "Investment not found");
    }

    // Find destination wallet
    const destinationWallet = await Wallet.findOne({
      _id: destinationWalletId,
      user: req.user._id,
    }).session(session);

    if (!destinationWallet) {
      logger.warn("Destination wallet not found", {
        userId: req.user._id,
        requestId: req.id,
        destinationWalletId,
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      return apiResponse.badRequest(res, "Destination wallet not found");
    }

    // Calculate current value before processing withdrawal
    if (investment.status === "active") {
      try {
        await investment.calculateInterest();

        logger.debug("Interest calculated before partial withdrawal", {
          userId: req.user._id,
          requestId: req.id,
          investmentId: id,
          currentValue: investment.currentValue.toString(),
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error("Error calculating interest before partial withdrawal:", {
          error: error.message,
          stack: error.stack,
          userId: req.user._id,
          requestId: req.id,
          investmentId: id,
          timestamp: new Date().toISOString(),
        });
        await session.abortTransaction();
        return apiResponse.serverError(
          res,
          "Error calculating investment value"
        );
      }
    }

    // Check withdrawal eligibility
    if (investment.status !== "active" && investment.status !== "matured") {
      logger.warn("Cannot withdraw from investment", {
        userId: req.user._id,
        requestId: req.id,
        investmentId: id,
        status: investment.status,
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      return apiResponse.badRequest(
        res,
        `Cannot withdraw from ${investment.status} investment`
      );
    }

    const now = new Date();
    const maturityReached = now >= investment.maturityDate;

    if (!maturityReached && !investment.withdrawalAllowed) {
      logger.warn("Early withdrawal not allowed", {
        userId: req.user._id,
        requestId: req.id,
        investmentId: id,
        maturityDate: investment.maturityDate,
        withdrawalAllowed: investment.withdrawalAllowed,
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      return apiResponse.badRequest(
        res,
        "Early withdrawal is not allowed for this investment"
      );
    }

    // Validate withdrawal amount
    if (
      parseFloat(withdrawalAmount.toString()) >
      parseFloat(investment.currentValue.toString())
    ) {
      logger.warn("Withdrawal amount exceeds investment value", {
        userId: req.user._id,
        requestId: req.id,
        investmentId: id,
        requestedAmount: withdrawalAmount.toString(),
        availableAmount: investment.currentValue.toString(),
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      return apiResponse.badRequest(
        res,
        "Withdrawal amount exceeds investment value"
      );
    }

    // Determine if this is a full withdrawal (liquidation) or partial withdrawal
    const isFullWithdrawal =
      Math.abs(
        parseFloat(withdrawalAmount.toString()) -
          parseFloat(investment.currentValue.toString())
      ) < 0.00001; // Using small epsilon for floating point comparison

    logger.debug("Withdrawal type determination", {
      userId: req.user._id,
      requestId: req.id,
      investmentId: id,
      withdrawalAmount: withdrawalAmount.toString(),
      currentValue: investment.currentValue.toString(),
      isFullWithdrawal,
      timestamp: new Date().toISOString(),
    });

    // For partial withdrawals, check minimum investment requirement
    if (!isFullWithdrawal) {
      // Calculate remaining value after withdrawal
      const remainingValue =
        parseFloat(investment.currentValue.toString()) -
        parseFloat(withdrawalAmount.toString());

      // Ensure remaining value isn't less than the plan's minimum investment
      if (remainingValue < investment.plan.minInvestment) {
        logger.warn(
          "Remaining investment would be below minimum investment amount",
          {
            userId: req.user._id,
            requestId: req.id,
            investmentId: id,
            requestedWithdrawal: withdrawalAmount.toString(),
            remainingValue: remainingValue.toFixed(8),
            minimumRequired: investment.plan.minInvestment,
            timestamp: new Date().toISOString(),
          }
        );
        await session.abortTransaction();
        return apiResponse.badRequest(
          res,
          `Remaining investment would be below the minimum required amount of ${investment.plan.minInvestment} ${investment.currency}. Please withdraw the full amount instead.`
        );
      }
    }

    // Calculate fee for early withdrawal
    let fee = 0;
    if (!maturityReached && investment.earlyWithdrawalFee > 0) {
      fee =
        parseFloat(withdrawalAmount.toString()) *
        (investment.earlyWithdrawalFee / 100);
      logger.debug("Early withdrawal fee applied", {
        userId: req.user._id,
        requestId: req.id,
        investmentId: id,
        withdrawalAmount: withdrawalAmount.toString(),
        feePercentage: investment.earlyWithdrawalFee,
        feeAmount: fee.toFixed(8),
        timestamp: new Date().toISOString(),
      });
    }

    // Actual amount after fee deduction
    const actualWithdrawalAmount =
      parseFloat(withdrawalAmount.toString()) - fee;

    // Convert withdrawal amount to destination wallet currency if needed
    let convertedAmount;
    if (investment.currency !== destinationWallet.currency) {
      convertedAmount = await convertCurrency(
        mongoose.Types.Decimal128.fromString(actualWithdrawalAmount.toFixed(8)),
        investment.currency,
        destinationWallet.currency
      );

      logger.debug("Currency conversion for withdrawal", {
        userId: req.user._id,
        requestId: req.id,
        fromCurrency: investment.currency,
        toCurrency: destinationWallet.currency,
        beforeConversion: actualWithdrawalAmount.toFixed(8),
        afterConversion: convertedAmount.toString(),
        timestamp: new Date().toISOString(),
      });
    } else {
      convertedAmount = mongoose.Types.Decimal128.fromString(
        actualWithdrawalAmount.toFixed(8)
      );
    }

    // Generate reference for transaction
    const reference = `INV-PWD-${Date.now()}-${Math.floor(
      Math.random() * 1000
    )}`;

    // Record old values for logging
    const oldInvestmentValue = investment.currentValue.toString();
    const oldInvestmentAmount = investment.amount.toString();
    const oldWalletBalance = destinationWallet.balance.toString();

    // Calculate proportion of principal being withdrawn
    const withdrawalProportion =
      parseFloat(withdrawalAmount.toString()) /
      parseFloat(investment.currentValue.toString());
    const principalReduction =
      parseFloat(investment.amount.toString()) * withdrawalProportion;

    // Store the current value as previous value before making any changes
    investment.previousValue = mongoose.Types.Decimal128.fromString(
      investment.currentValue.toString()
    );

    // Update investment values
    if (isFullWithdrawal) {
      // For full withdrawal, change status to withdrawn
      investment.status = "withdrawn";
      investment.currentValue = mongoose.Types.Decimal128.fromString("0");
      investment.amount = mongoose.Types.Decimal128.fromString("0");

      logger.debug("Investment fully liquidated", {
        userId: req.user._id,
        requestId: req.id,
        investmentId: id,
        oldValue: oldInvestmentValue,
        previousValue: investment.previousValue.toString(),
        currentValue: "0",
        status: "withdrawn",
        timestamp: new Date().toISOString(),
      });
    } else {
      // For partial withdrawal, calculate proportion and reduce accordingly
      const remainingValue =
        parseFloat(investment.currentValue.toString()) -
        parseFloat(withdrawalAmount.toString());

      investment.currentValue = mongoose.Types.Decimal128.fromString(
        remainingValue.toFixed(8)
      );
      investment.amount = mongoose.Types.Decimal128.fromString(
        (parseFloat(investment.amount.toString()) - principalReduction).toFixed(
          8
        )
      );

      logger.debug("Investment partially withdrawn", {
        userId: req.user._id,
        requestId: req.id,
        investmentId: id,
        oldValue: oldInvestmentValue,
        previousValue: investment.previousValue.toString(),
        newValue: investment.currentValue.toString(),
        oldAmount: oldInvestmentAmount,
        newAmount: investment.amount.toString(),
        withdrawalProportion: withdrawalProportion.toFixed(4),
        timestamp: new Date().toISOString(),
      });
    }

    // Record withdrawal in history
    if (!investment.withdrawalHistory) {
      investment.withdrawalHistory = [];
    }

    investment.withdrawalHistory.push({
      amount: parseFloat(withdrawalAmount.toString()),
      date: now,
      transactionReference: reference,
      fee: fee,
    });

    await investment.save({ session });

    logger.debug("Investment updated after partial withdrawal", {
      userId: req.user._id,
      requestId: req.id,
      investmentId: id,
      oldValue: oldInvestmentValue,
      previousValue: investment.previousValue.toString(),
      newValue: investment.currentValue.toString(),
      oldAmount: oldInvestmentAmount,
      newAmount: investment.amount.toString(),
      timestamp: new Date().toISOString(),
    });

    // Update wallet balance
    destinationWallet.balance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(destinationWallet.balance.toString()) +
        parseFloat(convertedAmount.toString())
      ).toFixed(8)
    );

    logger.debug("Destination wallet balance updated", {
      userId: req.user._id,
      requestId: req.id,
      walletId: destinationWallet._id,
      oldBalance: oldWalletBalance,
      deposited: convertedAmount.toString(),
      newBalance: destinationWallet.balance.toString(),
      timestamp: new Date().toISOString(),
    });

    await destinationWallet.save({ session });

    // Calculate conversion rate
    const conversionRate =
      investment.currency !== destinationWallet.currency
        ? parseFloat(convertedAmount.toString()) / actualWithdrawalAmount
        : 1;

    // Create InvestmentTransaction (debit)
    const investmentTransaction = new InvestmentTransaction({
      user: req.user._id,
      type: "debit",
      amount: mongoose.Types.Decimal128.fromString(withdrawalAmount.toString()),
      currency: investment.currency,
      sourceAmount: mongoose.Types.Decimal128.fromString(
        withdrawalAmount.toString()
      ),
      source: investment._id,
      sourceType: "UserInvestment",
      sourceCurrency: investment.currency,
      beneficiary: destinationWallet._id,
      beneficiaryType: "Wallet",
      beneficiaryCurrency: destinationWallet.currency,
      description: `${
        isFullWithdrawal ? "Full liquidation" : "Partial withdrawal"
      } from investment${!maturityReached ? " before maturity" : ""}${
        fee > 0 ? ` (fee: ${fee.toFixed(8)} ${investment.currency})` : ""
      }`,
      status: "completed",
      reference: `${reference}-DEBIT`,
    });

    await investmentTransaction.save({ session });

    // Create WalletTransaction (credit)
    const walletTransaction = new WalletTransaction({
      user: req.user._id,
      type: "credit",
      amount: convertedAmount,
      currency: destinationWallet.currency,
      source: investment._id,
      sourceType: "UserInvestment",
      sourceCurrency: investment.currency,
      beneficiary: destinationWallet._id,
      beneficiaryType: "Wallet",
      beneficiaryCurrency: destinationWallet.currency,
      conversionRate,
      description: `${
        isFullWithdrawal ? "Full liquidation" : "Partial withdrawal"
      } from investment${!maturityReached ? " before maturity" : ""}${
        fee > 0 ? ` (fee: ${fee.toFixed(8)} ${investment.currency})` : ""
      }`,
      status: "completed",
      reference: `${reference}-CREDIT`,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      completedAt: new Date(),
    });

    await walletTransaction.save({ session });

    // Add transaction to investment
    if (!investment.transactions) {
      investment.transactions = [];
    }
    investment.transactions.push(investmentTransaction._id);
    await investment.save({ session });

    // Add transaction to wallet
    if (!destinationWallet.transactions) {
      destinationWallet.transactions = [];
    }
    destinationWallet.transactions.push(walletTransaction._id);
    destinationWallet.lastActivityAt = new Date();
    await destinationWallet.save({ session });

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    logger.info(
      `Investment ${
        isFullWithdrawal ? "full liquidation" : "partial withdrawal"
      } completed successfully`,
      {
        userId: req.user._id,
        requestId: req.id,
        investmentId: id,
        investmentTransactionId: investmentTransaction._id,
        walletTransactionId: walletTransaction._id,
        withdrawalAmount: withdrawalAmount.toString(),
        fee: fee.toFixed(8),
        actualWithdrawalAmount: actualWithdrawalAmount.toFixed(8),
        convertedAmount: convertedAmount.toString(),
        previousValue: investment.previousValue.toString(),
        remainingValue: investment.currentValue.toString(),
        isFullWithdrawal,
        newStatus: investment.status,
        reference,
        timestamp: new Date().toISOString(),
      }
    );

    const populatedInvestment = await UserInvestment.findById(investment._id)
      .populate("plan")
      .populate("source")
      .lean();

    // Return success response with detailed information
    return apiResponse.success(
      res,
      200,
      isFullWithdrawal ? "Liquidation Successful!" : "Trade Successful!",
      isFullWithdrawal
        ? "Your investment has been liquidated successfully"
        : "Your investment trade has been processed successfully",
      {
        investment: {
          _id: investment._id,
          status: investment.status,
          currentValue: investment.currentValue,
          previousValue: investment.previousValue,
          amount: investment.amount,
          isFullyLiquidated: isFullWithdrawal,
          plan: populatedInvestment.plan,
        },
        withdrawal: {
          requestedAmount: withdrawalAmount.toString(),
          fee: fee.toFixed(8),
          actualAmount: actualWithdrawalAmount.toFixed(8),
          convertedAmount: convertedAmount.toString(),
          currency: destinationWallet.currency,
        },
        transactions: {
          investmentTransaction,
          walletTransaction,
          reference,
        },
      }
    );
  } catch (error) {
    // Abort transaction if error occurs
    logger.error("Aborting investment partial withdrawal due to error", {
      userId: req.user?._id,
      requestId: req.id,
      investmentId: req.params?.id,
      errorMessage: error.message,
      errorStack: error.stack,
      timestamp: new Date().toISOString(),
    });

    await session.abortTransaction();
    session.endSession();

    logger.error("Investment partial withdrawal failed:", {
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
 * @desc    Get investment transaction history
 * @route   GET /api/investments/transactions
 * @access  Private
 */
exports.getInvestmentTransactions = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 10,
      sort = "-createdAt",
      type,
      planId,
      startDate,
      endDate,
    } = req.query;

    logger.info("Fetching investment transactions", {
      userId: req.user._id,
      requestId: req.id,
      queryParams: req.query,
      timestamp: new Date().toISOString(),
    });

    // Build query
    const query = { user: req.user._id };

    // Add type filter if provided
    if (type && ["investment", "return"].includes(type)) {
      query.type = type;
    }

    // Add date filters if provided
    if (startDate) {
      if (!query.createdAt) query.createdAt = {};
      query.createdAt.$gte = new Date(startDate);
    }

    if (endDate) {
      if (!query.createdAt) query.createdAt = {};
      query.createdAt.$lte = new Date(endDate);
    }

    // For plan filter, we need to find investments for that plan first
    if (planId) {
      const investments = await UserInvestment.find({
        user: req.user._id,
        plan: planId,
      }).select("_id");

      const investmentIds = investments.map((inv) => inv._id);

      // Add to query - either as source or beneficiary
      query.$or = [
        { source: { $in: investmentIds }, sourceType: "UserInvestment" },
        {
          beneficiary: { $in: investmentIds },
          beneficiaryType: "UserInvestment",
        },
      ];
    }

    // Execute query with pagination
    const options = {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      sort: sort,
      populate: [
        { path: "source", select: "name address label" },
        { path: "beneficiary", select: "name address label" },
      ],
    };

    // Using mongoose-paginate-v2 (assuming it's installed)
    const transactions = await InvestmentTransaction.paginate(query, options);

    logger.debug("Investment transactions fetched", {
      userId: req.user._id,
      requestId: req.id,
      count: transactions.docs.length,
      totalDocs: transactions.totalDocs,
      timestamp: new Date().toISOString(),
    });

    // Return transactions
    return apiResponse.success(
      res,
      200,
      "Investment Transactions Retrieved",
      "Investment transactions have been retrieved successfully",
      { transactions }
    );
  } catch (error) {
    logger.error("Error fetching investment transactions:", {
      error: error.message,
      stack: error.stack,
      userId: req.user?._id,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });
    next(error);
  }
};

/**
 * @desc    Get a specific investment details
 * @route   GET /api/investments/:id
 * @access  Private
 */
exports.getInvestmentDetails = async (req, res, next) => {
  try {
    const { id } = req.params;

    logger.info("Fetching investment details", {
      userId: req.user._id,
      requestId: req.id,
      investmentId: id,
      timestamp: new Date().toISOString(),
    });

    // Find investment with populated data
    const investment = await UserInvestment.findOne({
      _id: id,
      user: req.user._id,
    })
      .populate("plan")
      .populate("source")
      .populate({
        path: "transactions",
        options: { sort: { createdAt: -1 } },
      })
      .exec();

    if (!investment) {
      logger.warn("Investment not found", {
        userId: req.user._id,
        requestId: req.id,
        investmentId: id,
        timestamp: new Date().toISOString(),
      });
      return apiResponse.notFound(res, "Investment not found");
    }

    // Calculate current value before returning
    // For active investments, we should recalculate interest
    if (investment.status === "active") {
      try {
        const result = await investment.calculateInterest();

        logger.debug("Interest calculation for investment", {
          userId: req.user._id,
          requestId: req.id,
          investmentId: id,
          calculationResult: result,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error("Error calculating investment interest:", {
          error: error.message,
          stack: error.stack,
          userId: req.user._id,
          requestId: req.id,
          investmentId: id,
          timestamp: new Date().toISOString(),
        });
        // Continue without failing the request
      }
    }

    if (!investment.previousValue && investment.previousValue !== 0) {
      investment.previousValue = investment.currentValue;
      await investment.save();
    }

    logger.debug("Investment details fetched", {
      userId: req.user._id,
      requestId: req.id,
      investmentId: id,
      timestamp: new Date().toISOString(),
    });

    // Return investment details
    return apiResponse.success(
      res,
      200,
      "Investment Details Retrieved",
      "Investment details have been retrieved successfully",
      { investment }
    );
  } catch (error) {
    logger.error("Error fetching investment details:", {
      error: error.message,
      stack: error.stack,
      userId: req.user?._id,
      requestId: req.id,
      investmentId: req.params?.id,
      timestamp: new Date().toISOString(),
    });
    next(error);
  }
};

/**
 * @desc    Cancel an investment
 * @route   POST /api/investments/:id/cancel
 * @access  Private
 */
exports.cancelInvestment = async (req, res) => {
  // Start logging
  logger.info("Investment cancellation request initiated", {
    userId: req.user._id,
    requestId: req.id,
    investmentId: req.params.id,
    timestamp: new Date().toISOString(),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });

  // Start a database transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { destinationWalletId, reason } = req.body;

    // Validate required fields
    if (!destinationWalletId) {
      await session.abortTransaction();
      session.endSession();
      
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Destination wallet ID is required",
        "MISSING_DESTINATION_WALLET"
      );
    }

    // Find the investment
    const investment = await UserInvestment.findOne({
      _id: id,
      user: req.user._id,
    })
      .populate("plan")
      .session(session);

    if (!investment) {
      logger.warn("Investment not found for cancellation", {
        userId: req.user._id,
        requestId: req.id,
        investmentId: id,
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      session.endSession();
      
      return apiResponse.notFound(
        res,
        "Not Found",
        "Investment not found",
        "INVESTMENT_NOT_FOUND"
      );
    }

    // Check if investment can be cancelled (only active ones)
    if (investment.status !== "active") {
      logger.warn("Cannot cancel non-active investment", {
        userId: req.user._id,
        requestId: req.id,
        investmentId: id,
        status: investment.status,
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      session.endSession();
      
      return apiResponse.badRequest(
        res,
        "Invalid Status",
        `Cannot cancel ${investment.status} investment`,
        "INVESTMENT_NOT_CANCELLABLE"
      );
    }

    // Find destination wallet
    const destinationWallet = await Wallet.findOne({
      _id: destinationWalletId,
      user: req.user._id,
    }).session(session);

    if (!destinationWallet) {
      logger.warn("Destination wallet not found for cancellation", {
        userId: req.user._id,
        requestId: req.id,
        destinationWalletId,
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      session.endSession();
      
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Destination wallet not found",
        "DESTINATION_WALLET_NOT_FOUND"
      );
    }

    // Generate reference for transaction
    const reference = `INV-CAN-${Date.now()}-${Math.floor(
      Math.random() * 1000
    )}`;

    // Set investment status to cancelled and save
    investment.status = "cancelled";
    investment.cancelledAt = new Date();
    investment.cancellationReason = reason || "User requested";
    
    await investment.save({ session });

    // Convert currency if needed for refund
    let refundAmount = investment.amount;
    try {
      if (investment.currency !== destinationWallet.currency) {
        refundAmount = await convertCurrency(
          investment.amount,
          investment.currency,
          destinationWallet.currency
        );

        logger.debug("Currency conversion for cancellation refund", {
          userId: req.user._id,
          requestId: req.id,
          fromCurrency: investment.currency,
          toCurrency: destinationWallet.currency,
          beforeConversion: investment.amount.toString(),
          afterConversion: refundAmount.toString(),
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      logger.error("Currency conversion error during cancellation", {
        userId: req.user._id,
        requestId: req.id,
        fromCurrency: investment.currency,
        toCurrency: destinationWallet.currency,
        amount: investment.amount.toString(),
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      session.endSession();
      
      return apiResponse.error(
        res,
        500,
        "Conversion Error",
        "Error converting investment amount to wallet currency",
        "CANCELLATION_CONVERSION_ERROR"
      );
    }

    // Credit the wallet with the original investment amount
    const oldWalletBalance = destinationWallet.balance.toString();
    destinationWallet.balance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(destinationWallet.balance.toString()) +
        parseFloat(refundAmount.toString())
      ).toFixed(8)
    );

    logger.debug("Crediting wallet for cancellation refund", {
      userId: req.user._id,
      requestId: req.id,
      walletId: destinationWallet._id,
      oldBalance: oldWalletBalance,
      creditAmount: refundAmount.toString(),
      newBalance: destinationWallet.balance.toString(),
      timestamp: new Date().toISOString(),
    });

    await destinationWallet.save({ session });

    // Create transaction record for investment
    const investmentTransaction = new InvestmentTransaction({
      user: req.user._id,
      type: "return",
      amount: investment.amount,
      currency: investment.currency,
      source: investment._id,
      sourceType: "UserInvestment",
      sourceCurrency: investment.currency,
      beneficiary: destinationWallet._id,
      beneficiaryType: "Wallet",
      beneficiaryCurrency: destinationWallet.currency,
      description: `Investment cancellation: ${reason || "User requested"}`,
      status: "completed",
      reference: `${reference}-INVEST`,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      completedAt: new Date(),
    });

    await investmentTransaction.save({ session });

    // Create wallet transaction record
    const walletTransaction = new WalletTransaction({
      user: req.user._id,
      type: "credit",
      amount: refundAmount,
      currency: destinationWallet.currency,
      source: investment._id,
      sourceType: "UserInvestment",
      sourceCurrency: investment.currency,
      beneficiary: destinationWallet._id,
      beneficiaryType: "Wallet",
      beneficiaryCurrency: destinationWallet.currency,
      conversionRate: 
        investment.currency !== destinationWallet.currency
          ? parseFloat(refundAmount.toString()) / parseFloat(investment.amount.toString())
          : 1,
      description: `Refund from cancelled investment in ${investment.plan.name}`,
      status: "completed",
      reference: `${reference}-WALLET`,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      completedAt: new Date(),
    });

    await walletTransaction.save({ session });

    // Add transaction to investment
    if (!investment.transactions) {
      investment.transactions = [];
    }
    investment.transactions.push(investmentTransaction._id);
    await investment.save({ session });
    
    // Add transaction to wallet
    if (!destinationWallet.transactions) {
      destinationWallet.transactions = [];
    }
    destinationWallet.transactions.push(walletTransaction._id);
    destinationWallet.lastActivityAt = new Date();
    await destinationWallet.save({ session });
    
    // Create notification for the user
    await notificationService.createNotification(
      req.user._id,
      "Investment Cancelled",
      `Your investment in ${investment.plan.name} has been cancelled. ${parseFloat(refundAmount.toString()).toFixed(2)} ${destinationWallet.currency} has been refunded to your wallet.`,
      "investment",
      {
        investmentId: investment._id,
        planName: investment.plan.name,
        refundAmount: refundAmount.toString(),
        currency: destinationWallet.currency,
        reason: reason || "User requested",
        walletId: destinationWallet._id,
        transactionReference: reference
      },
      session
    );

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Investment cancellation completed successfully", {
      userId: req.user._id,
      requestId: req.id,
      investmentId: id,
      investmentTransactionId: investmentTransaction._id,
      walletTransactionId: walletTransaction._id,
      refundAmount: refundAmount.toString(),
      reason: reason || "User requested",
      reference,
      timestamp: new Date().toISOString(),
    });

    // Return success response
    return apiResponse.success(
      res,
      200,
      "Investment Cancelled",
      "Your investment has been cancelled and funds returned to your wallet",
      {
        investment: {
          _id: investment._id,
          status: investment.status,
          cancelledAt: investment.cancelledAt,
          cancellationReason: investment.cancellationReason
        },
        wallet: {
          _id: destinationWallet._id,
          balance: destinationWallet.balance
        },
        transactions: {
          investmentTransaction,
          walletTransaction,
          reference
        },
        refundAmount: refundAmount.toString(),
        currency: destinationWallet.currency
      }
    );
  } catch (error) {
    // Abort transaction if error occurs
    logger.error("Aborting investment cancellation due to error", {
      userId: req.user?._id,
      requestId: req.id,
      investmentId: req.params?.id,
      errorMessage: error.message,
      errorStack: error.stack,
      timestamp: new Date().toISOString(),
    });

    await session.abortTransaction();
    session.endSession();

    logger.error("Investment cancellation failed:", {
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
      "Cancellation Failed",
      "Error cancelling investment",
      "INVESTMENT_CANCELLATION_ERROR"
    );
  }
}

module.exports = exports;
