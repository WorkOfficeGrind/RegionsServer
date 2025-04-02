const cron = require("node-cron");
const investmentGrowthService = require("./investmentService");
const { logger } = require("../config/logger");

/**
 * Register the daily investment growth processing cron job
 * Runs every day at 2:00 AM
 */
const registerInvestmentGrowthCron = () => {
  logger.info("Registering investment growth cron job");

  // Schedule the job to run at 2:00 AM daily
  cron.schedule(
    "*/5 * * * *",
    // "0 2 * * *",
    async () => {
      logger.info("Running daily investment growth cron job");

      try {
        const results =
          await investmentGrowthService.processAllInvestmentsGrowth();

        logger.info("Daily investment growth cron completed", {
          processed: results.processed,
          skipped: results.skipped,
          matured: results.matured,
          failed: results.failed,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error("Error in daily investment growth cron job", {
          error: error.message,
          stack: error.stack,
          timestamp: new Date().toISOString(),
        });
      }
    },
    {
      scheduled: true,
      timezone: "UTC", // Adjust timezone as needed
    }
  );

  logger.info("Investment growth cron job registered successfully");
};

/**
 * Register cron job to check for matured investments
 * Runs every day at 3:00 AM
 */
const registerMaturityCheckCron = () => {
  logger.info("Registering investment maturity check cron job");

  // Schedule the job to run at 3:00 AM daily
  cron.schedule(
    "0 3 * * *",
    async () => {
      // Implementation of maturity check would go here
      logger.info("Running investment maturity check cron");
    },
    {
      scheduled: true,
      timezone: "UTC",
    }
  );
};

/**
 * Initialize all cron jobs
 */
const initCronJobs = () => {
  try {
    logger.info("Initializing investment cron jobs");

    registerInvestmentGrowthCron();
    registerMaturityCheckCron();

    logger.info("All investment cron jobs initialized successfully");
  } catch (error) {
    logger.error("Failed to initialize investment cron jobs", {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });
  }
};

module.exports = {
  initCronJobs,
};
