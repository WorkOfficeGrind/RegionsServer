const cron = require("node-cron");
const investmentGrowthService = require("./investmentService");
const { logger } = require("../config/logger");

/**
 * Register the daily investment growth processing cron job
 * Runs every day at 2:00 AM
 */
/**
 * Register the daily investment growth processing cron job
 * Runs every day at 2:00 AM
 */
const registerInvestmentGrowthCron = () => {
  logger.info("Registering investment growth cron job");

  // Schedule the job to run every 5 minutes for testing
  // In production, use "0 2 * * *" for daily at 2 AM
  cron.schedule(
    "0 2 * * *",
    async () => {
      logger.info("Running daily investment growth cron job");

      try {
        // Debug: Log current date/time when job runs
        const processDate = new Date();
        logger.debug("Cron job triggered at", {
          dateTime: processDate.toISOString(),
          timestamp: processDate.getTime(),
        });

        const results =
          await investmentGrowthService.processAllInvestmentsGrowth(
            processDate
          );

        logger.info("Daily investment growth cron completed", {
          processed: results.processed,
          skipped: results.skipped,
          matured: results.matured,
          failed: results.failed,
          timestamp: new Date().toISOString(),
        });

        // If all investments were skipped, log detailed info
        if (results.skipped > 0 && results.processed === 0) {
          logger.debug("All investments were skipped, detailed reasons:", {
            details: results.details.map((d) => ({
              investmentId: d.investmentId,
              reason: d.message,
            })),
          });
        }
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
