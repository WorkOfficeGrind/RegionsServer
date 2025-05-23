const mongoose = require("mongoose");
const crypto = require("crypto");
const UserInvestment = require("../models/UserInvestment");
const InvestmentTransaction = require("../models/InvestmentTransaction");
const { logger } = require("../config/logger");

/**
 * Generates a realistic daily growth schedule for an investment
 *
 * @param {number} principal - Initial investment amount
 * @param {number} annualRateOfReturn - Annual rate of return (as decimal, e.g., 0.08 for 8%)
 * @param {number} maturityPeriodDays - Total days until maturity
 * @param {number} volatility - How much daily returns can vary (0-1, higher = more random)
 * @returns {Array} Daily returns over the maturity period (not cumulative balances)
 */
const generateInvestmentGrowthSchedule = (
  principal,
  annualRateOfReturn,
  maturityPeriodDays,
  volatility = 0.5
) => {
  // Calculate the total expected return at maturity
  const totalExpectedReturn =
    principal * (annualRateOfReturn * (maturityPeriodDays / 365));

  // Average return per day (mean value)
  const avgDailyReturn = totalExpectedReturn / maturityPeriodDays;

  // Maximum volatility range (as a percentage of the average daily return)
  const maxVariance = avgDailyReturn * volatility * 2;

  // Generate random daily returns with normal distribution
  let dailyReturns = [];
  let totalGeneratedReturn = 0;

  // First, generate random daily returns
  for (let i = 0; i < maturityPeriodDays; i++) {
    // Generate a random number with normal-ish distribution (using Box-Muller transform)
    let u = 0,
      v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    let standardNormal =
      Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);

    // Adjust the normal distribution to have our desired mean and variance
    let dailyReturn = avgDailyReturn + standardNormal * (maxVariance / 4);

    // Ensure the majority of days have positive returns but allow occasional small negatives for realism
    if (dailyReturn < -avgDailyReturn * 0.2) {
      dailyReturn = -avgDailyReturn * 0.2;
    }

    dailyReturns.push(dailyReturn);
    totalGeneratedReturn += dailyReturn;
  }

  // Adjust returns to ensure they sum to the expected total return
  const adjustmentFactor = totalExpectedReturn / totalGeneratedReturn;
  dailyReturns = dailyReturns.map((dailyReturn) => {
    return parseFloat((dailyReturn * adjustmentFactor).toFixed(8));
  });

  return dailyReturns;
};

/**
 * Initialize the growth schedule for a newly created investment
 *
 * @param {Object} investment - The UserInvestment document
 * @returns {Promise} Updated investment with growth schedule
 */
const initializeInvestmentGrowth = async (investment) => {
  try {
    // Calculate days until maturity
    const investedAt = new Date(investment.investedAt);
    const maturityDate = new Date(investment.maturityDate);
    const maturityPeriodDays = Math.ceil(
      (maturityDate - investedAt) / (1000 * 60 * 60 * 24)
    );

    // Generate growth schedule
    const dailyReturns = generateInvestmentGrowthSchedule(
      investment.amount,
      investment.rate / 100, // Convert percentage to decimal
      maturityPeriodDays,
      0.6 // Moderate volatility
    );

    // Add growth schedule to investment metadata
    if (!investment.metadata) {
      investment.metadata = {};
    }

    investment.metadata.growthSchedule = dailyReturns;
    investment.metadata.lastGrowthDate = investedAt;
    investment.metadata.nextGrowthIndex = 0;

    // Save the updated investment
    await investment.save();

    logger.info("Investment growth schedule initialized", {
      investmentId: investment._id,
      userId: investment.user,
      maturityPeriodDays,
      totalExpectedReturn: dailyReturns.reduce((sum, val) => sum + val, 0),
      scheduleLength: dailyReturns.length,
    });

    return investment;
  } catch (error) {
    logger.error("Error initializing investment growth schedule:", {
      error: error.message,
      stack: error.stack,
      investmentId: investment._id,
      userId: investment.user,
    });
    throw error;
  }
};

/**
 * Process daily growth for a single investment
 *
 * @param {Object} investment - The UserInvestment document
 * @param {Date} currentDate - The current date to process (defaults to now)
 * @returns {Promise} Processing result with transaction details
 */
const processDailyGrowth = async (investment, currentDate = new Date()) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Ensure the investment has a growth schedule
    if (!investment.metadata?.growthSchedule) {
      // Initialize growth schedule if not present
      investment = await initializeInvestmentGrowth(investment);
    }

    const { growthSchedule, lastGrowthDate, nextGrowthIndex } =
      investment.metadata;

    // Convert dates to days for comparison (ignoring time)
    const lastGrowthDay = new Date(lastGrowthDate).setHours(0, 0, 0, 0);
    const currentDay = new Date(currentDate).setHours(0, 0, 0, 0);

    // Skip if already processed today or invalid index
    if (
      lastGrowthDay === currentDay ||
      nextGrowthIndex >= growthSchedule.length
    ) {
      await session.abortTransaction();
      session.endSession();

      return {
        success: false,
        message:
          lastGrowthDay === currentDay
            ? "Growth already processed today"
            : "Investment has reached maturity",
        investmentId: investment._id,
      };
    }

    // Get today's growth amount from the schedule
    const growthAmount = growthSchedule[nextGrowthIndex];

    // Update current value with today's growth
    const oldValue = investment.currentValue;
    investment.currentValue = parseFloat(oldValue) + growthAmount;

    const previousValue = parseFloat(oldValue);
    const percentageIncrease =
      previousValue > 0 ? (growthAmount / previousValue) * 100 : 0;

    // Generate reference for transaction
    const transactionRef = `INVGROW-${Date.now()}-${crypto
      .randomBytes(4)
      .toString("hex")}`;

    // Create transaction record for the growth
    const transaction = new InvestmentTransaction({
      user: investment.user,
      type: "return",
      amount: Math.abs(growthAmount),
      currency: investment.currency,
      source: investment._id,
      sourceAmount: Math.abs(growthAmount),
      sourceType: "UserInvestment",
      sourceCurrency: investment.currency,
      beneficiary: investment._id,
      beneficiaryType: "UserInvestment",
      beneficiaryCurrency: investment.currency,
      description:
        growthAmount >= 0
          ? `Daily investment growth of ${percentageIncrease.toFixed(
              2
            )}% (Day ${nextGrowthIndex + 1})`
          : `Daily investment fluctuation of ${percentageIncrease.toFixed(
              2
            )}% (Day ${nextGrowthIndex + 1})`,
      status: "completed",
      reference: transactionRef,
      metadata: {
        day: nextGrowthIndex + 1,
        percentageIncrease,
        absoluteGrowth: growthAmount,
        previousValue,
      },
    });

    

    // Save the transaction
    await transaction.save({ session });

    // Update investment with new transaction and metadata
    if (!investment.transactions) {
      investment.transactions = [];
    }

    investment.transactions.push(transaction._id);

    // IMPORTANT CHANGE: Explicitly log what we're updating
    logger.debug("Updating investment metadata", {
      investmentId: investment._id,
      oldIndex: nextGrowthIndex,
      newIndex: nextGrowthIndex + 1,
      oldDate: new Date(lastGrowthDate).toISOString(),
      newDate: new Date(currentDate).toISOString(),
    });

    // Update metadata for next processing - make a new object to ensure changes are tracked
    // investment.metadata = {
    //   ...investment.metadata,
    //   lastGrowthDate: currentDate,
    //   nextGrowthIndex: nextGrowthIndex + 1,
    // };

    // Check if investment has reached maturity
    if (nextGrowthIndex + 1 >= growthSchedule.length) {
      investment.status = "matured";
      logger.info("Investment has reached maturity", {
        investmentId: investment._id,
        userId: investment.user,
        finalValue: investment.currentValue,
      });
    }

    // CHANGE: Use direct update for greater certainty
    const updateResult = await UserInvestment.findByIdAndUpdate(
      investment._id,
      {
        $set: {
          previousValue: oldValue, // Add this line to store the previous value
          currentValue: investment.currentValue,
          "metadata.lastGrowthDate": currentDate,
          "metadata.nextGrowthIndex": nextGrowthIndex + 1,
          status: investment.status,
        },
        $push: { transactions: transaction._id },
      },
      {
        new: true,
        session,
      }
    );

    logger.debug("Database update result", {
      investmentId: investment._id,
      updated: !!updateResult,
      newMetadata: updateResult?.metadata,
    });

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Investment daily growth processed", {
      investmentId: investment._id,
      userId: investment.user,
      day: nextGrowthIndex + 1,
      growthAmount,
      previousValue: oldValue,
      newValue: investment.currentValue,
      transactionRef,
      metadataUpdated: {
        lastGrowthDate: currentDate,
        nextGrowthIndex: nextGrowthIndex + 1,
      },
    });

    return {
      success: true,
      message: "Daily growth processed successfully",
      investmentId: investment._id,
      growthAmount,
      previousValue,
      newValue: investment.currentValue,
      percentageIncrease,
      transaction,
      hasReachedMaturity: investment.status === "matured",
    };
  } catch (error) {
    // Abort transaction on error
    await session.abortTransaction();
    session.endSession();

    logger.error("Error processing daily investment growth:", {
      error: error.message,
      stack: error.stack,
      investmentId: investment._id,
      userId: investment.user,
    });

    throw error;
  }
};

/**
 * Process daily growth for all active investments
 *
 * @param {Date} processDate - The date to process growth for (defaults to now)
 * @returns {Promise} Processing results
 */
// const processAllInvestmentsGrowth = async (processDate = new Date()) => {
//   try {
//     logger.info("Starting daily growth processing for all active investments", {
//       processDate: processDate.toISOString(),
//       timestamp: new Date().toISOString(),
//     });

//     // Get all active investments
//     const activeInvestments = await UserInvestment.find({
//       status: "active",
//       maturityDate: { $gt: processDate },
//     });

//     logger.info(
//       `Found ${activeInvestments.length} active investments to process`
//     );

//     const results = {
//       processed: 0,
//       skipped: 0,
//       matured: 0,
//       failed: 0,
//       details: [],
//     };

//     // Process each investment
//     for (const investment of activeInvestments) {
//       try {
//         const result = await processDailyGrowth(investment, processDate);

//         if (result.success) {
//           results.processed++;
//           if (result.hasReachedMaturity) {
//             results.matured++;
//           }
//         } else {
//           results.skipped++;
//         }

//         results.details.push({
//           investmentId: investment._id,
//           userId: investment.user,
//           success: result.success,
//           message: result.message,
//         });
//       } catch (error) {
//         results.failed++;
//         results.details.push({
//           investmentId: investment._id,
//           userId: investment.user,
//           success: false,
//           message: error.message,
//         });

//         logger.error(
//           `Failed to process growth for investment ${investment._id}`,
//           {
//             error: error.message,
//             investmentId: investment._id,
//             userId: investment.user,
//           }
//         );
//       }
//     }

//     logger.info("Daily growth processing completed", {
//       processDate: processDate.toISOString(),
//       processed: results.processed,
//       skipped: results.skipped,
//       matured: results.matured,
//       failed: results.failed,
//       timestamp: new Date().toISOString(),
//     });

//     return results;
//   } catch (error) {
//     logger.error("Error in batch processing of investment growth:", {
//       error: error.message,
//       stack: error.stack,
//       timestamp: new Date().toISOString(),
//     });

//     throw error;
//   }
// };
/**
 * Process daily growth for all active investments
 *
 * @param {Date} processDate - The date to process growth for (defaults to now)
 * @returns {Promise} Processing results
 */
const processAllInvestmentsGrowth = async (processDate = new Date()) => {
  try {
    logger.info("Starting daily growth processing for all active investments", {
      processDate: processDate.toISOString(),
      timestamp: new Date().toISOString(),
    });

    // Get all active investments
    const activeInvestments = await UserInvestment.find({
      status: "active",
      maturityDate: { $gt: processDate },
    });

    logger.info(
      `Found ${activeInvestments.length} active investments to process`
    );

    // Log details of each investment for debugging
    activeInvestments.forEach((investment, index) => {
      logger.debug(`Investment ${index + 1} details:`, {
        investmentId: investment._id,
        userId: investment.user,
        hasMetadata: !!investment.metadata,
        lastGrowthDate: investment.metadata?.lastGrowthDate,
        nextGrowthIndex: investment.metadata?.nextGrowthIndex,
        scheduleLength: investment.metadata?.growthSchedule?.length,
      });
    });

    const results = {
      processed: 0,
      skipped: 0,
      matured: 0,
      failed: 0,
      details: [],
    };

    // Process each investment
    for (const investment of activeInvestments) {
      try {
        const result = await processDailyGrowth(investment, processDate);

        if (result.success) {
          results.processed++;
          if (result.hasReachedMaturity) {
            results.matured++;
          }
        } else {
          results.skipped++;
        }

        results.details.push({
          investmentId: investment._id,
          userId: investment.user,
          success: result.success,
          message: result.message,
        });
      } catch (error) {
        results.failed++;
        results.details.push({
          investmentId: investment._id,
          userId: investment.user,
          success: false,
          message: error.message,
        });

        logger.error(
          `Failed to process growth for investment ${investment._id}`,
          {
            error: error.message,
            investmentId: investment._id,
            userId: investment.user,
          }
        );
      }
    }

    logger.info("Daily growth processing completed", {
      processDate: processDate.toISOString(),
      processed: results.processed,
      skipped: results.skipped,
      matured: results.matured,
      failed: results.failed,
      timestamp: new Date().toISOString(),
    });

    return results;
  } catch (error) {
    logger.error("Error in batch processing of investment growth:", {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });

    throw error;
  }
};

/**
 * Force update all active investments' lastGrowthDate to allow processing
 * This is a utility function for troubleshooting
 */
const forceResetAllInvestmentsLastGrowthDate = async () => {
  try {
    logger.info("Force resetting lastGrowthDate for all active investments");

    // Set date to yesterday
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);

    // Update all active investments
    const result = await UserInvestment.updateMany(
      { status: "active" },
      { $set: { "metadata.lastGrowthDate": yesterdayDate } }
    );

    logger.info("Forced reset completed", {
      matched: result.matchedCount,
      modified: result.modifiedCount,
    });

    return result;
  } catch (error) {
    logger.error("Error in force resetting growth dates:", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

/**
 * Force add growth schedule to investments missing it
 * This is a utility function for troubleshooting
 */
const fixInvestmentsMissingMetadata = async () => {
  try {
    logger.info("Finding investments with missing metadata");

    // Find all active investments with missing growth schedules
    const brokenInvestments = await UserInvestment.find({
      status: "active",
      $or: [
        { metadata: { $exists: false } },
        { "metadata.growthSchedule": { $exists: false } },
      ],
    });

    logger.info(
      `Found ${brokenInvestments.length} investments with missing metadata`
    );

    // Fix each investment
    const results = {
      total: brokenInvestments.length,
      success: 0,
      failed: 0,
      details: [],
    };

    for (const investment of brokenInvestments) {
      try {
        await initializeInvestmentGrowth(investment);
        results.success++;
        results.details.push({
          investmentId: investment._id,
          status: "fixed",
        });
      } catch (error) {
        results.failed++;
        results.details.push({
          investmentId: investment._id,
          status: "failed",
          error: error.message,
        });
      }
    }

    logger.info("Fix operation completed", {
      totalFixed: results.success,
      totalFailed: results.failed,
    });

    return results;
  } catch (error) {
    logger.error("Error in fixing investments with missing metadata:", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

/**
 * Manually initialize growth schedule for existing investments (migration utility)
 */
const migrateExistingInvestments = async () => {
  try {
    logger.info("Starting migration for existing investments");

    // Find all active investments without growth schedules
    const investments = await UserInvestment.find({
      status: "active",
      $or: [
        { "metadata.growthSchedule": { $exists: false } },
        { metadata: { $exists: false } },
      ],
    });

    logger.info(`Found ${investments.length} investments to migrate`);

    let success = 0;
    let failed = 0;

    for (const investment of investments) {
      try {
        await initializeInvestmentGrowth(investment);
        success++;
      } catch (error) {
        failed++;
        logger.error(`Failed to migrate investment ${investment._id}`, {
          error: error.message,
          investmentId: investment._id,
          userId: investment.user,
        });
      }
    }

    logger.info("Migration completed", { success, failed });

    return { success, failed };
  } catch (error) {
    logger.error("Error in migration process:", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

module.exports = {
  initializeInvestmentGrowth,
  processDailyGrowth,
  processAllInvestmentsGrowth,
  forceResetAllInvestmentsLastGrowthDate,
  fixInvestmentsMissingMetadata,
  migrateExistingInvestments,
  generateInvestmentGrowthSchedule,
};
