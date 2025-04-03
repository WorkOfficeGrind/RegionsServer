const mongoose = require("mongoose");
const InvestmentPlan = require("../models/InvestmentPlan");
const UserInvestment = require("../models/UserInvestment");
const InvestmentTransaction = require("../models/InvestmentTransaction");
const Wallet = require("../models/Wallet");
const { logger } = require("../config/logger");
const apiResponse = require("../utils/apiResponse");
const { toUSDrates, fromUSDrates } = require("../utils/constants");

/**
 * @desc    Get all available investment plans
 * @route   GET /api/investments/plans
 * @access  Private
 */
exports.getInvestmentPlans = async (req, res, next) => {
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
    next(error);
  }
};

/**
 * @desc    Get a specific investment plan
 * @route   GET /api/investments/plans/:id
 * @access  Private
 */
exports.getInvestmentPlan = async (req, res, next) => {
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
      return apiResponse.notFound(res, "No investment plan found with that ID");
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
    next(error);
  }
};

/**
 * @desc    Create a new investment
 * @route   POST /api/investments
 * @access  Private
 */
exports.createInvestment = async (req, res, next) => {
  // Start logging - capture initial request data
  logger.info("Investment creation request initiated", {
    userId: req.user._id,
    requestId: req.id,
    requestBody: {
      planId: req.body.planId,
      amount: req.body.amount,
      sourceWalletId: req.body.sourceWalletId,
      compoundFrequency: req.body.compoundFrequency,
      label: req.body.label
    },
    timestamp: new Date().toISOString(),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"]
  });

  // Start a database transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { 
      planId, 
      amount, 
      sourceWalletId, 
      compoundFrequency = 'monthly',
      label
    } = req.body;
    
    // Convert amount to Decimal128 for precise calculations
    const decimalAmount = mongoose.Types.Decimal128.fromString(amount.toString());
    
    // Validate investment plan
    const plan = await InvestmentPlan.findById(planId).session(session);
    
    if (!plan || !plan.isActive) {
      logger.warn("Invalid or inactive investment plan", {
        userId: req.user._id,
        requestId: req.id,
        planId,
        timestamp: new Date().toISOString()
      });
      await session.abortTransaction();
      return apiResponse.badRequest(res, "Invalid or inactive investment plan");
    }

    // Find source wallet
    const sourceWallet = await Wallet.findOne({
      _id: sourceWalletId,
      user: req.user._id
    }).session(session);
    
    if (!sourceWallet) {
      logger.warn("Source wallet not found", {
        userId: req.user._id,
        requestId: req.id,
        sourceWalletId,
        timestamp: new Date().toISOString()
      });
      await session.abortTransaction();
      return apiResponse.badRequest(res, "Source wallet not found");
    }
    
    // Check if source wallet has sufficient balance
    if (parseFloat(sourceWallet.balance.toString()) < parseFloat(decimalAmount.toString())) {
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
        timestamp: new Date().toISOString()
      });
      await session.abortTransaction();
      return apiResponse.badRequest(res, "Insufficient funds in source wallet");
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
          timestamp: new Date().toISOString()
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
        timestamp: new Date().toISOString()
      });
      await session.abortTransaction();
      return apiResponse.serverError(res, "Error converting currency");
    }
    
    // Debug log to verify conversion
    logger.debug("Comparing investment amount with minimum", {
      userId: req.user._id,
      requestId: req.id,
      walletCurrency: sourceWallet.currency,
      planCurrency: plan.currency,
      originalAmount: decimalAmount.toString(),
      convertedAmount: investmentAmountInPlanCurrency.toString(),
      minimumRequired: plan.minInvestment,
      timestamp: new Date().toISOString()
    });
    
    // Check minimum investment amount AFTER converting to plan currency (usually USD)
    if (parseFloat(investmentAmountInPlanCurrency.toString()) < plan.minInvestment) {
      logger.warn("Investment amount below minimum", {
        userId: req.user._id,
        requestId: req.id,
        planId,
        walletCurrency: sourceWallet.currency,
        planCurrency: plan.currency,
        originalAmount: decimalAmount.toString(),
        convertedAmount: investmentAmountInPlanCurrency.toString(),
        minimumRequired: plan.minInvestment,
        timestamp: new Date().toISOString()
      });
      await session.abortTransaction();
      return apiResponse.badRequest(
        res, 
        `Minimum investment amount is ${plan.minInvestment} ${plan.currency}`
      );
    }
    
    // Create the investment - here we preserve the original currency or convert if needed
    // We're already converted to plan currency above, so use that value
    let investmentAmount = investmentAmountInPlanCurrency;
    
    // Calculate maturity date based on plan duration
    const investedAt = new Date();
    const maturityDate = new Date();
    
    // Ensure plan.maturityPeriod is a number
    const maturityPeriod = typeof plan.maturityPeriod === 'number' ? plan.maturityPeriod : 
                           (parseInt(plan.maturityPeriod, 10) || 30); // Default to 30 days if invalid
    
    maturityDate.setDate(maturityDate.getDate() + maturityPeriod);
    
    // Validate that maturityDate is valid
    if (isNaN(maturityDate.getTime())) {
      logger.error("Invalid maturity date calculation", {
        userId: req.user._id,
        requestId: req.id,
        investedAt: investedAt.toISOString(),
        maturityPeriod,
        planId: plan._id,
        timestamp: new Date().toISOString()
      });
      await session.abortTransaction();
      return apiResponse.badRequest(res, "Could not calculate valid maturity date");
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
      timestamp: new Date().toISOString()
    });
    
    // Deduct from wallet
    const oldWalletBalance = sourceWallet.balance.toString();
    sourceWallet.balance = mongoose.Types.Decimal128.fromString(
      (parseFloat(sourceWallet.balance.toString()) - parseFloat(decimalAmount.toString())).toFixed(8)
    );
    
    logger.debug("Deducting from wallet", {
      userId: req.user._id,
      requestId: req.id,
      walletId: sourceWallet._id,
      oldBalance: oldWalletBalance,
      deductedAmount: decimalAmount.toString(),
      newBalance: sourceWallet.balance.toString(),
      timestamp: new Date().toISOString()
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
    const User = mongoose.model('User');
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
      timestamp: new Date().toISOString()
    });
    
    await user.save({ session });
    
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
      timestamp: new Date().toISOString()
    });
    
    // Fetch the populated investment to return
    const populatedInvestment = await UserInvestment.findById(userInvestment._id)
      .populate('plan')
      .populate('source')
      .populate('transactions');
    
    // Return successful response
    return apiResponse.success(
      res,
      201,
      "Investment Created",
      "Your investment has been created successfully",
      {
        investment: populatedInvestment,
        transaction,
        reference
      }
    );
  } catch (error) {
    // Abort transaction if error occurs
    logger.error("Aborting investment creation due to error", {
      userId: req.user?._id,
      requestId: req.id,
      errorMessage: error.message,
      errorStack: error.stack,
      timestamp: new Date().toISOString()
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
      timestamp: new Date().toISOString()
    });

    next(error);
  }
};

/**
 * @desc    Get user's investments
 * @route   GET /api/investments
 * @access  Private
 */
exports.getUserInvestments = async (req, res, next) => {
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
 * @desc    Get investment performance metrics
 * @route   GET /api/investments/performance
 * @access  Private
 */
exports.getInvestmentPerformance = async (req, res, next) => {
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
    next(error);
  }
};

/**
 * @desc    Process investment growth (simulated daily growth)
 * @route   POST /api/investments/process-growth
 * @access  Private/Admin
 */
exports.processInvestmentGrowth = async (req, res, next) => {
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
        "You do not have permission to perform this action"
      );
    }

    // Get all active investments
    const activeInvestments = await UserInvestment.find({
      status: "active",
    }).populate("plan");

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
    logger.error("Error in investment growth processing:", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });
    next(error);
  }
};

/**
 * @desc    Withdraw funds from an investment
 * @route   POST /api/investments/:id/withdraw
 * @access  Private
 */
exports.withdrawInvestment = async (req, res, next) => {
  // Start logging
  logger.info("Investment withdrawal request initiated", {
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
    const decimalAmount = mongoose.Types.Decimal128.fromString(
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

        logger.debug("Interest calculated before withdrawal", {
          userId: req.user._id,
          requestId: req.id,
          investmentId: id,
          currentValue: investment.currentValue.toString(),
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error("Error calculating interest before withdrawal:", {
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

    // Validate withdrawal amount
    if (
      parseFloat(decimalAmount.toString()) >
      parseFloat(investment.currentValue.toString())
    ) {
      logger.warn("Withdrawal amount exceeds investment value", {
        userId: req.user._id,
        requestId: req.id,
        investmentId: id,
        requestedAmount: decimalAmount.toString(),
        availableAmount: investment.currentValue.toString(),
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      return apiResponse.badRequest(
        res,
        "Withdrawal amount exceeds investment value"
      );
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

    // Generate reference for transaction
    const reference = `INV-WD-${Date.now()}-${Math.floor(
      Math.random() * 1000
    )}`;

    // Process withdrawal
    const withdrawalResult = await investment.withdraw(
      decimalAmount,
      reference
    );

    if (!withdrawalResult.success) {
      logger.error("Withdrawal processing failed", {
        userId: req.user._id,
        requestId: req.id,
        investmentId: id,
        error: withdrawalResult.message,
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      return apiResponse.badRequest(
        res,
        withdrawalResult.message || "Withdrawal processing failed"
      );
    }

    logger.debug("Withdrawal processed by investment model", {
      userId: req.user._id,
      requestId: req.id,
      investmentId: id,
      withdrawalResult,
      timestamp: new Date().toISOString(),
    });

    // Convert currency if needed
    let convertedAmount = decimalAmount;
    if (investment.currency !== destinationWallet.currency) {
      convertedAmount = await convertCurrency(
        decimalAmount,
        investment.currency,
        destinationWallet.currency
      );

      logger.debug("Currency conversion for withdrawal", {
        userId: req.user._id,
        requestId: req.id,
        fromCurrency: investment.currency,
        toCurrency: destinationWallet.currency,
        beforeConversion: decimalAmount.toString(),
        afterConversion: convertedAmount.toString(),
        timestamp: new Date().toISOString(),
      });
    }

    // Credit the wallet
    const oldWalletBalance = destinationWallet.balance.toString();
    destinationWallet.balance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(destinationWallet.balance.toString()) +
        parseFloat(convertedAmount.toString())
      ).toFixed(8)
    );

    logger.debug("Crediting wallet", {
      userId: req.user._id,
      requestId: req.id,
      walletId: destinationWallet._id,
      oldBalance: oldWalletBalance,
      creditAmount: convertedAmount.toString(),
      newBalance: destinationWallet.balance.toString(),
      timestamp: new Date().toISOString(),
    });

    await destinationWallet.save({ session });

    // Create transaction record
    const transaction = new InvestmentTransaction({
      user: req.user._id,
      type: "return",
      amount: decimalAmount,
      currency: destinationWallet.currency,
      source: investment._id,
      sourceAmount: convertedAmount,
      sourceType: "UserInvestment",
      sourceCurrency: investment.currency,
      beneficiary: destinationWallet._id,
      beneficiaryType: "Wallet",
      beneficiaryCurrency: destinationWallet.currency,
      description: `Investment withdrawal ${
        maturityReached ? "at maturity" : "before maturity"
      }`,
      status: "completed",
      reference,
    });

    

    await transaction.save({ session });

    // Add transaction to investment
    investment.transactions.push(transaction._id);
    await investment.save({ session });

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Investment withdrawal completed successfully", {
      userId: req.user._id,
      requestId: req.id,
      investmentId: id,
      transactionId: transaction._id,
      amount: decimalAmount.toString(),
      convertedAmount: convertedAmount.toString(),
      fee: withdrawalResult.fee || 0,
      reference,
      timestamp: new Date().toISOString(),
    });

    // Return success response
    return apiResponse.success(
      res,
      200,
      "Withdrawal Successful",
      "Your investment withdrawal has been processed successfully",
      {
        transaction,
        withdrawalAmount: convertedAmount.toString(),
        fee: withdrawalResult.fee || 0,
        remainingValue: investment.currentValue.toString(),
        investment: {
          _id: investment._id,
          status: investment.status,
          currentValue: investment.currentValue,
          maturityDate: investment.maturityDate,
        },
      }
    );
  } catch (error) {
    // Abort transaction if error occurs
    logger.error("Aborting investment withdrawal due to error", {
      userId: req.user?._id,
      requestId: req.id,
      investmentId: req.params?.id,
      errorMessage: error.message,
      errorStack: error.stack,
      timestamp: new Date().toISOString(),
    });

    await session.abortTransaction();
    session.endSession();

    logger.error("Investment withdrawal failed:", {
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
 * @desc    Cancel an investment
 * @route   POST /api/investments/:id/cancel
 * @access  Private
 */
exports.cancelInvestment = async (req, res, next) => {
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
      return apiResponse.notFound(res, "Investment not found");
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
      return apiResponse.badRequest(
        res,
        `Cannot cancel ${investment.status} investment`
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
      return apiResponse.badRequest(res, "Destination wallet not found");
    }

    // Generate reference for transaction
    const reference = `INV-CAN-${Date.now()}-${Math.floor(
      Math.random() * 1000
    )}`;

    // Set investment status to cancelled and save
    investment.status = "cancelled";
    await investment.save({ session });

    // Convert currency if needed for refund
    let refundAmount = investment.amount;
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

    // Create transaction record
    const transaction = new InvestmentTransaction({
      user: req.user._id,
      type: "return",
      amount: investment.amount,
      currency: destinationWallet.currency,
      source: investment._id,
      sourceAmount: refundAmount,
      sourceType: "UserInvestment",
      sourceCurrency: investment.currency,
      beneficiary: destinationWallet._id,
      beneficiaryType: "Wallet",
      beneficiaryCurrency: destinationWallet.currency,
      description: `Investment cancellation: ${reason || "User requested"}`,
      status: "completed",
      reference,
    });

    
    await transaction.save({ session });

    // Add transaction to investment
    investment.transactions.push(transaction._id);
    await investment.save({ session });

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Investment cancellation completed successfully", {
      userId: req.user._id,
      requestId: req.id,
      investmentId: id,
      transactionId: transaction._id,
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
        transaction,
        refundAmount: refundAmount.toString(),
        investment: {
          _id: investment._id,
          status: investment.status,
        },
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

    next(error);
  }
};


/**
 * @desc    Simulate growth on an investment (for testing purposes only)
 * @route   POST /api/investments/:id/simulate-growth
 * @access  Private/Admin
 */
exports.simulateInvestmentGrowth = async (req, res, next) => {
  try {
    logger.info("Simulating investment growth", {
      userId: req.user._id,
      requestId: req.id,
      investmentId: req.params.id,
      timestamp: new Date().toISOString()
    });
    
    // This is a dev/admin endpoint
    if (!req.user.isAdmin && process.env.NODE_ENV === 'production') {
      logger.warn("Unauthorized attempt to simulate investment growth", {
        userId: req.user._id,
        requestId: req.id,
        timestamp: new Date().toISOString()
      });
      return apiResponse.unauthorized(res, "You do not have permission to perform this action");
    }
    
    const { id } = req.params;
    const { 
      growthPattern = 'random', // 'random', 'up', 'down', 'volatile'
      days = 7,
      baseGrowthRate = 0.005, // 0.5% daily average
      volatilityFactor = 0.5, // How much variation
      reset = true,
      applyGrowth = true
    } = req.body;
    
    // Find the investment
    const investment = await UserInvestment.findOne({
      _id: id,
      user: "67dcb8120a0ba43192d09cec",
    });
    
    if (!investment) {
      logger.warn("Investment not found for growth simulation", {
        userId: req.user._id,
        requestId: req.id,
        investmentId: id,
        timestamp: new Date().toISOString()
      });
      return apiResponse.notFound(res, "Investment not found");
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
        case 'up':
          // Gradually increasing trend - starts at base rate and goes up
          rate = baseGrowthRate * (1 + dayPosition * 2);
          // Add some randomness
          rate += (Math.random() - 0.3) * volatilityFactor * baseGrowthRate;
          growthRates.push(Math.max(0, rate));
          break;
        
        case 'down':
          // Gradually decreasing trend - starts at base rate and goes down
          rate = baseGrowthRate * (1 - dayPosition);
          // Add some randomness
          rate += (Math.random() - 0.7) * volatilityFactor * baseGrowthRate;
          growthRates.push(Math.max(0, rate));
          break;
          
        case 'volatile':
          // Highly variable (both positive and negative)
          rate = baseGrowthRate + ((Math.random() * 2 - 1) * volatilityFactor * baseGrowthRate * 3);
          growthRates.push(rate);
          break;
          
        case 'random':
        default:
          // Random variations around base rate
          rate = baseGrowthRate + ((Math.random() * 2 - 1) * volatilityFactor * baseGrowthRate);
          growthRates.push(rate);
          break;
      }
    }
    
    // Add new growth rates to the schedule
    investment.metadata.growthSchedule = [
      ...investment.metadata.growthSchedule,
      ...growthRates
    ];
    
    // Calculate new value based on growth rates
    let currentValue = parseFloat(investment.currentValue.toString());
    const initialValue = currentValue;
    
    for (let i = 0; i < growthRates.length; i++) {
      const growthRate = growthRates[i];
      currentValue = currentValue * (1 + growthRate);
    }
    
    // Update the investment with new value and next growth index
    if (applyGrowth) {
      investment.currentValue = mongoose.Types.Decimal128.fromString(currentValue.toFixed(8));
      // Set nextGrowthIndex to one past the end to indicate all growth has been applied
      investment.metadata.nextGrowthIndex = investment.metadata.growthSchedule.length;
    }
    
    await investment.save();
    
    logger.info("Investment growth simulation completed", {
      userId: req.user._id,
      requestId: req.id,
      investmentId: id,
      growthPattern,
      daysSimulated: days,
      initialValue: initialValue.toFixed(8),
      newValue: currentValue.toFixed(8),
      percentageGrowth: ((currentValue / initialValue - 1) * 100).toFixed(2) + '%',
      growthRates: growthRates.slice(0, 3).map(r => (r * 100).toFixed(2) + '%') + '...',
      totalGrowthRates: growthRates.length,
      nextGrowthIndex: investment.metadata.nextGrowthIndex,
      timestamp: new Date().toISOString()
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
          percentageChange: ((currentValue / initialValue - 1) * 100).toFixed(2) + '%',
          growthRates: growthRates.map(rate => (rate * 100).toFixed(4) + '%'),
          totalRates: investment.metadata.growthSchedule.length,
          nextGrowthIndex: investment.metadata.nextGrowthIndex
        }
      }
    );
  } catch (error) {
    logger.error("Error simulating investment growth:", {
      error: error.message,
      stack: error.stack,
      userId: req.user?._id,
      requestId: req.id,
      investmentId: req.params?.id,
      timestamp: new Date().toISOString()
    });
    next(error);
  }
};



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

  // Check if we have a rate for this currency
  if (!fromUSDrates[currency]) {
    throw new Error(`Unsupported currency for conversion: ${currency}`);
  }

  // Convert from USD to target currency
  const usdFloat = parseFloat(usdAmount.toString());
  const convertedValue = usdFloat * fromUSDrates[currency];

  return mongoose.Types.Decimal128.fromString(convertedValue.toFixed(8));
};

module.exports = exports;
