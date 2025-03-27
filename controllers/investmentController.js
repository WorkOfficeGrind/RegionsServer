const mongoose = require("mongoose");
const crypto = require("crypto");
const User = require("../models/User");
const Account = require("../models/Account");
const Transaction = require("../models/Transaction");
const InvestmentPlan = require("../models/InvestmentPlan");
const UserInvestment = require("../models/UserInvestment");
const { logger } = require("../config/logger");
const apiResponse = require("../utils/apiResponse");
const config = require("../config/config");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const { toUSDrates, fromUSDrates } = require("../utils/constants");
const InvestmentTransaction = require("../models/InvestmentTransaction");

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
 * @desc    Get all investment plans
 * @route   GET /api/investment-plans
 * @access  Public
 */
exports.getAllInvestmentPlans = async (req, res, next) => {
  try {
    logger.info("Get all investment plans request", {
      requestId: req.id,
      userId: req.user?._id,
      timestamp: new Date().toISOString(),
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    const { active, featured, riskLevel, sort } = req.query;

    // Build filter object
    const filter = {};

    if (active !== undefined) {
      filter.isActive = active === "true";
    }

    if (featured !== undefined) {
      filter.isFeatured = featured === "true";
    }

    if (riskLevel) {
      filter.riskLevel = riskLevel;
    }

    // Build sort object
    // let sortOption = { createdAt: -1 }; // Default sort by creation date, newest first
    let sortOption = {}; // Default sort by creation date, newest first

    if (sort) {
      switch (sort) {
        case "return-asc":
          sortOption = { expectedReturnMin: 1 };
          break;
        case "return-desc":
          sortOption = { expectedReturnMin: -1 };
          break;
        case "risk-asc":
          // Custom sort for risk levels from low to high
          sortOption = {
            riskLevel: 1, // MongoDB will sort strings alphabetically
          };
          break;
        case "risk-desc":
          sortOption = { riskLevel: -1 };
          break;
        case "name-asc":
          sortOption = { name: 1 };
          break;
        case "name-desc":
          sortOption = { name: -1 };
          break;
      }
    }

    const investmentPlans = await InvestmentPlan.find(filter).sort(sortOption);

    logger.info("Investment plans retrieved successfully", {
      requestId: req.id,
      count: investmentPlans.length,
      timestamp: new Date().toISOString(),
    });

    return apiResponse.success(
      res,
      200,
      "Success",
      "Investment plans retrieved successfully",
      { plans: investmentPlans }
    );
  } catch (error) {
    logger.error("Error retrieving investment plans:", {
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
 * @desc    Get investment plan by ID
 * @route   GET /api/investment-plans/:planId
 * @access  Public
 */
exports.getInvestmentPlanById = async (req, res, next) => {
  try {
    const { planId } = req.params;

    logger.info("Get investment plan by ID request", {
      requestId: req.id,
      userId: req.user?._id,
      planId,
      timestamp: new Date().toISOString(),
      ip: req.ip,
    });

    // Check if planId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(planId)) {
      logger.warn("Invalid investment plan ID format", {
        requestId: req.id,
        planId,
        timestamp: new Date().toISOString(),
      });
      return apiResponse.badRequest(res, "Invalid investment plan ID format");
    }

    const investmentPlan = await InvestmentPlan.findById(planId);

    if (!investmentPlan) {
      logger.warn("Investment plan not found", {
        requestId: req.id,
        planId,
        timestamp: new Date().toISOString(),
      });
      return apiResponse.notFound(res, "Investment plan not found");
    }

    logger.info("Investment plan retrieved successfully", {
      requestId: req.id,
      planId: investmentPlan._id,
      timestamp: new Date().toISOString(),
    });

    return apiResponse.success(
      res,
      200,
      "Success",
      "Investment plan retrieved successfully",
      { investmentPlan }
    );
  } catch (error) {
    logger.error("Error retrieving investment plan:", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
      planId: req.params.planId,
      ip: req.ip,
      timestamp: new Date().toISOString(),
    });
    next(error);
  }
};

/**
 * @desc    Create new investment plan
 * @route   POST /api/investment-plans
 * @access  Admin
 */
exports.createInvestmentPlan = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      name,
      symbol,
      maturityPeriod,
      minInvestment,
      currency,
      expectedReturnMin,
      expectedReturnMax,
      riskLevel,
      description,
      managementFee,
      allocations,
      icon,
      isActive,
      isFeatured,
      features,
    } = req.body;

    logger.info("Create investment plan request initiated", {
      requestId: req.id,
      userId: req.user._id,
      planName: name,
      timestamp: new Date().toISOString(),
      ip: req.ip,
    });

    // Validate required fields
    if (
      !name ||
      !symbol ||
      !maturityPeriod ||
      !minInvestment ||
      !expectedReturnMin ||
      !expectedReturnMax ||
      !riskLevel ||
      !description
    ) {
      logger.warn("Validation failed: Missing required fields", {
        userId: req.user._id,
        requestId: req.id,
        timestamp: new Date().toISOString(),
      });

      // Abort transaction
      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Please provide all required investment plan details"
      );
    }

    // Validate allocations (if provided) total to 100%
    if (allocations && allocations.length > 0) {
      const totalPercentage = allocations.reduce(
        (sum, allocation) => sum + allocation.percentage,
        0
      );

      if (Math.abs(totalPercentage - 100) > 0.01) {
        // Allow for small floating point errors
        logger.warn("Validation failed: Allocations do not sum to 100%", {
          userId: req.user._id,
          requestId: req.id,
          totalPercentage,
          timestamp: new Date().toISOString(),
        });

        await session.abortTransaction();
        session.endSession();

        return apiResponse.badRequest(res, "Asset allocations must total 100%");
      }
    }

    // Create new investment plan
    const newInvestmentPlan = new InvestmentPlan({
      name,
      symbol: symbol,
      maturityPeriod,
      minInvestment,
      currency: currency || "USD",
      expectedReturnMin,
      expectedReturnMax,
      riskLevel,
      description,
      managementFee: managementFee || 0,
      allocations: allocations || [],
      icon: icon || "chart-line",
      isActive: isActive !== undefined ? isActive : true,
      isFeatured: isFeatured || false,
      features: features || [],
    });

    await newInvestmentPlan.save({ session });

    logger.info("Investment plan created successfully", {
      requestId: req.id,
      planId: newInvestmentPlan._id,
      planName: newInvestmentPlan.name,
      timestamp: new Date().toISOString(),
    });

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    return apiResponse.success(
      res,
      201,
      "Created",
      "Investment plan created successfully",
      { investmentPlan: newInvestmentPlan }
    );
  } catch (error) {
    // Abort transaction if error occurs
    await session.abortTransaction();
    session.endSession();

    logger.error("Error creating investment plan:", {
      error: error.message,
      errorCode: error.code,
      stack: error.stack,
      requestId: req.id,
      userId: req.user?._id,
      ip: req.ip,
      timestamp: new Date().toISOString(),
    });

    // Handle duplicate key error
    if (error.code === 11000) {
      return apiResponse.conflict(
        res,
        "An investment plan with this name already exists"
      );
    }

    next(error);
  }
};

/**
 * @desc    Update investment plan
 * @route   PUT /api/investment-plans/:planId
 * @access  Admin
 */
exports.updateInvestmentPlan = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { planId } = req.params;
    const updateData = req.body;

    logger.info("Update investment plan request initiated", {
      requestId: req.id,
      userId: req.user._id,
      planId,
      updateData: Object.keys(updateData),
      timestamp: new Date().toISOString(),
      ip: req.ip,
    });

    // Check if planId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(planId)) {
      logger.warn("Invalid investment plan ID format", {
        requestId: req.id,
        planId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(res, "Invalid investment plan ID format");
    }

    // Get current plan to compare changes
    const existingPlan = await InvestmentPlan.findById(planId).session(session);

    if (!existingPlan) {
      logger.warn("Investment plan not found for update", {
        requestId: req.id,
        planId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.notFound(res, "Investment plan not found");
    }

    // Handle symbol uppercase if provided
    if (updateData.symbol) {
      updateData.symbol = updateData.symbol;
    }

    // Validate allocations if provided
    if (updateData.allocations && updateData.allocations.length > 0) {
      const totalPercentage = updateData.allocations.reduce(
        (sum, allocation) => sum + allocation.percentage,
        0
      );

      if (Math.abs(totalPercentage - 100) > 0.01) {
        logger.warn(
          "Validation failed: Updated allocations do not sum to 100%",
          {
            userId: req.user._id,
            requestId: req.id,
            totalPercentage,
            timestamp: new Date().toISOString(),
          }
        );

        await session.abortTransaction();
        session.endSession();

        return apiResponse.badRequest(res, "Asset allocations must total 100%");
      }
    }

    // Update the investment plan
    const updatedInvestmentPlan = await InvestmentPlan.findByIdAndUpdate(
      planId,
      updateData,
      { new: true, runValidators: true, session }
    );

    logger.info("Investment plan updated successfully", {
      requestId: req.id,
      planId: updatedInvestmentPlan._id,
      planName: updatedInvestmentPlan.name,
      timestamp: new Date().toISOString(),
    });

    // Log significant changes
    if (
      updateData.isActive !== undefined &&
      existingPlan.isActive !== updateData.isActive
    ) {
      logger.info(
        `Investment plan status changed from ${
          existingPlan.isActive ? "active" : "inactive"
        } to ${updateData.isActive ? "active" : "inactive"}`,
        {
          requestId: req.id,
          planId: updatedInvestmentPlan._id,
          timestamp: new Date().toISOString(),
        }
      );
    }

    if (
      updateData.expectedReturnMin !== undefined ||
      updateData.expectedReturnMax !== undefined
    ) {
      logger.info("Investment plan return rates updated", {
        requestId: req.id,
        planId: updatedInvestmentPlan._id,
        oldMin: existingPlan.expectedReturnMin,
        newMin:
          updateData.expectedReturnMin !== undefined
            ? updateData.expectedReturnMin
            : existingPlan.expectedReturnMin,
        oldMax: existingPlan.expectedReturnMax,
        newMax:
          updateData.expectedReturnMax !== undefined
            ? updateData.expectedReturnMax
            : existingPlan.expectedReturnMax,
        timestamp: new Date().toISOString(),
      });
    }

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    return apiResponse.success(
      res,
      200,
      "Updated",
      "Investment plan updated successfully",
      { investmentPlan: updatedInvestmentPlan }
    );
  } catch (error) {
    // Abort transaction if error occurs
    await session.abortTransaction();
    session.endSession();

    logger.error("Error updating investment plan:", {
      error: error.message,
      errorCode: error.code,
      stack: error.stack,
      requestId: req.id,
      planId: req.params.planId,
      userId: req.user?._id,
      ip: req.ip,
      timestamp: new Date().toISOString(),
    });

    // Handle duplicate key error
    if (error.code === 11000) {
      return apiResponse.conflict(
        res,
        "An investment plan with this name already exists"
      );
    }

    next(error);
  }
};

/**
 * @desc    Delete investment plan
 * @route   DELETE /api/investment-plans/:planId
 * @access  Admin
 */
exports.deleteInvestmentPlan = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { planId } = req.params;

    logger.info("Delete investment plan request initiated", {
      requestId: req.id,
      userId: req.user._id,
      planId,
      timestamp: new Date().toISOString(),
      ip: req.ip,
    });

    // Check if planId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(planId)) {
      logger.warn("Invalid investment plan ID format", {
        requestId: req.id,
        planId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(res, "Invalid investment plan ID format");
    }

    // Get plan details before deletion for logging
    const plan = await InvestmentPlan.findById(planId).session(session);

    if (!plan) {
      logger.warn("Investment plan not found for deletion", {
        requestId: req.id,
        planId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.notFound(res, "Investment plan not found");
    }

    // In a production environment, you might want to:
    // 1. Check if there are active investments using this plan
    // 2. Soft delete instead of hard delete

    // For now, implementing a direct delete
    await InvestmentPlan.findByIdAndDelete(planId).session(session);

    logger.info("Investment plan deleted successfully", {
      requestId: req.id,
      planId,
      planName: plan.name,
      timestamp: new Date().toISOString(),
    });

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    return apiResponse.success(
      res,
      200,
      "Deleted",
      "Investment plan deleted successfully",
      {}
    );
  } catch (error) {
    // Abort transaction if error occurs
    await session.abortTransaction();
    session.endSession();

    logger.error("Error deleting investment plan:", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
      planId: req.params.planId,
      userId: req.user?._id,
      ip: req.ip,
      timestamp: new Date().toISOString(),
    });

    next(error);
  }
};

/**
 * @desc    Toggle investment plan active status
 * @route   PATCH /api/investment-plans/:planId/toggle-active
 * @access  Admin
 */
exports.toggleActiveStatus = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { planId } = req.params;

    logger.info("Toggle investment plan active status request initiated", {
      requestId: req.id,
      userId: req.user._id,
      planId,
      timestamp: new Date().toISOString(),
      ip: req.ip,
    });

    // Check if planId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(planId)) {
      logger.warn("Invalid investment plan ID format", {
        requestId: req.id,
        planId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(res, "Invalid investment plan ID format");
    }

    // Get current plan status
    const plan = await InvestmentPlan.findById(planId).session(session);

    if (!plan) {
      logger.warn("Investment plan not found for status toggle", {
        requestId: req.id,
        planId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.notFound(res, "Investment plan not found");
    }

    // Toggle the active status
    const newStatus = !plan.isActive;

    const updatedPlan = await InvestmentPlan.findByIdAndUpdate(
      planId,
      { isActive: newStatus },
      { new: true, runValidators: true, session }
    );

    logger.info(
      `Investment plan status toggled to ${newStatus ? "active" : "inactive"}`,
      {
        requestId: req.id,
        planId,
        planName: plan.name,
        oldStatus: plan.isActive,
        newStatus: updatedPlan.isActive,
        timestamp: new Date().toISOString(),
      }
    );

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    return apiResponse.success(
      res,
      200,
      "Updated",
      `Investment plan ${newStatus ? "activated" : "deactivated"} successfully`,
      { investmentPlan: updatedPlan }
    );
  } catch (error) {
    // Abort transaction if error occurs
    await session.abortTransaction();
    session.endSession();

    logger.error("Error toggling investment plan status:", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
      planId: req.params.planId,
      userId: req.user?._id,
      ip: req.ip,
      timestamp: new Date().toISOString(),
    });

    next(error);
  }
};

/**
 * @desc    Toggle investment plan featured status
 * @route   PATCH /api/investment-plans/:planId/toggle-featured
 * @access  Admin
 */
exports.toggleFeaturedStatus = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { planId } = req.params;

    logger.info("Toggle investment plan featured status request initiated", {
      requestId: req.id,
      userId: req.user._id,
      planId,
      timestamp: new Date().toISOString(),
      ip: req.ip,
    });

    // Check if planId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(planId)) {
      logger.warn("Invalid investment plan ID format", {
        requestId: req.id,
        planId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(res, "Invalid investment plan ID format");
    }

    // Get current plan status
    const plan = await InvestmentPlan.findById(planId).session(session);

    if (!plan) {
      logger.warn("Investment plan not found for featured toggle", {
        requestId: req.id,
        planId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.notFound(res, "Investment plan not found");
    }

    // Toggle the featured status
    const newStatus = !plan.isFeatured;

    const updatedPlan = await InvestmentPlan.findByIdAndUpdate(
      planId,
      { isFeatured: newStatus },
      { new: true, runValidators: true, session }
    );

    logger.info(
      `Investment plan featured status toggled to ${
        newStatus ? "featured" : "not featured"
      }`,
      {
        requestId: req.id,
        planId,
        planName: plan.name,
        oldStatus: plan.isFeatured,
        newStatus: updatedPlan.isFeatured,
        timestamp: new Date().toISOString(),
      }
    );

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    return apiResponse.success(
      res,
      200,
      "Updated",
      `Investment plan ${newStatus ? "featured" : "unfeatured"} successfully`,
      { investmentPlan: updatedPlan }
    );
  } catch (error) {
    // Abort transaction if error occurs
    await session.abortTransaction();
    session.endSession();

    logger.error("Error toggling investment plan featured status:", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
      planId: req.params.planId,
      userId: req.user?._id,
      ip: req.ip,
      timestamp: new Date().toISOString(),
    });

    next(error);
  }
};

/**
 * @desc    Update investment plan allocations
 * @route   PATCH /api/investment-plans/:planId/allocations
 * @access  Admin
 */
exports.updateAllocations = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { planId } = req.params;
    const { allocations } = req.body;

    logger.info("Update investment plan allocations request initiated", {
      requestId: req.id,
      userId: req.user._id,
      planId,
      allocationCount: allocations?.length,
      timestamp: new Date().toISOString(),
      ip: req.ip,
    });

    // Check if planId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(planId)) {
      logger.warn("Invalid investment plan ID format", {
        requestId: req.id,
        planId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(res, "Invalid investment plan ID format");
    }

    // Validate allocations
    if (
      !allocations ||
      !Array.isArray(allocations) ||
      allocations.length === 0
    ) {
      logger.warn("Invalid allocations data", {
        requestId: req.id,
        planId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Invalid allocations data. Allocations must be an array of asset allocation objects."
      );
    }

    // Check if allocations total 100%
    const totalPercentage = allocations.reduce(
      (sum, allocation) => sum + allocation.percentage,
      0
    );

    if (Math.abs(totalPercentage - 100) > 0.01) {
      logger.warn("Validation failed: Allocations do not sum to 100%", {
        userId: req.user._id,
        requestId: req.id,
        totalPercentage,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(res, "Asset allocations must total 100%");
    }

    // Find the plan
    const plan = await InvestmentPlan.findById(planId).session(session);

    if (!plan) {
      logger.warn("Investment plan not found for allocation update", {
        requestId: req.id,
        planId,
        timestamp: new Date().toISOString(),
      });

      await session.abortTransaction();
      session.endSession();

      return apiResponse.notFound(res, "Investment plan not found");
    }

    // Store old allocations for logging
    const oldAllocations = [...plan.allocations];

    // Update allocations
    const updatedPlan = await InvestmentPlan.findByIdAndUpdate(
      planId,
      { allocations },
      { new: true, runValidators: true, session }
    );

    logger.info("Investment plan allocations updated successfully", {
      requestId: req.id,
      planId,
      planName: plan.name,
      oldAllocationsCount: oldAllocations.length,
      newAllocationsCount: allocations.length,
      timestamp: new Date().toISOString(),
    });

    // Log allocation changes if needed
    const oldAllocationMap = {};
    oldAllocations.forEach((item) => {
      oldAllocationMap[item.asset] = item.percentage;
    });

    allocations.forEach((item) => {
      if (
        oldAllocationMap[item.asset] !== undefined &&
        oldAllocationMap[item.asset] !== item.percentage
      ) {
        logger.info(
          `Allocation for ${item.asset} changed from ${
            oldAllocationMap[item.asset]
          }% to ${item.percentage}%`,
          {
            requestId: req.id,
            planId,
            asset: item.asset,
            timestamp: new Date().toISOString(),
          }
        );
      } else if (oldAllocationMap[item.asset] === undefined) {
        logger.info(
          `New allocation added: ${item.asset} at ${item.percentage}%`,
          {
            requestId: req.id,
            planId,
            timestamp: new Date().toISOString(),
          }
        );
      }
    });

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    return apiResponse.success(
      res,
      200,
      "Updated",
      "Investment plan allocations updated successfully",
      { investmentPlan: updatedPlan }
    );
  } catch (error) {
    // Abort transaction if error occurs
    await session.abortTransaction();
    session.endSession();

    logger.error("Error updating investment plan allocations:", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
      planId: req.params.planId,
      userId: req.user?._id,
      ip: req.ip,
      timestamp: new Date().toISOString(),
    });

    next(error);
  }
};

/**
 * @desc    Get featured investment plans
 * @route   GET /api/investment-plans/featured
 * @access  Public
 */
exports.getFeaturedPlans = async (req, res, next) => {
  try {
    logger.info("Get featured investment plans request", {
      requestId: req.id,
      userId: req.user?._id,
      timestamp: new Date().toISOString(),
      ip: req.ip,
    });

    // Only return active and featured plans
    const featuredPlans = await InvestmentPlan.find({
      isActive: true,
      isFeatured: true,
    }).sort({ expectedReturnMin: -1 }); // Sort by highest returns first

    logger.info("Investment plans by risk level retrieved successfully", {
      requestId: req.id,
      riskLevel,
      count: plans.length,
      timestamp: new Date().toISOString(),
    });

    return apiResponse.success(
      res,
      200,
      "Success",
      "Investment plans retrieved successfully",
      { investmentPlans: plans }
    );
  } catch (error) {
    logger.error("Error retrieving investment plans by risk level:", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
      riskLevel: req.params.riskLevel,
      ip: req.ip,
      timestamp: new Date().toISOString(),
    });
    next(error);
  }
};

/**
 * @desc    Search investment plans
 * @route   GET /api/investment-plans/search
 * @access  Public
 */
exports.searchInvestmentPlans = async (req, res, next) => {
  try {
    const { query, minReturn, maxReturn, riskLevel } = req.query;

    logger.info("Search investment plans request", {
      requestId: req.id,
      userId: req.user?._id,
      searchParams: { query, minReturn, maxReturn, riskLevel },
      timestamp: new Date().toISOString(),
      ip: req.ip,
    });

    // Build search filter
    const filter = { isActive: true };

    if (query) {
      filter.$or = [
        { name: { $regex: query, $options: "i" } },
        { symbol: { $regex: query, $options: "i" } },
        { description: { $regex: query, $options: "i" } },
      ];
    }

    if (minReturn) {
      filter.expectedReturnMin = { $gte: parseFloat(minReturn) };
    }

    if (maxReturn) {
      filter.expectedReturnMax = { $lte: parseFloat(maxReturn) };
    }

    if (riskLevel) {
      filter.riskLevel = riskLevel;
    }

    const searchResults = await InvestmentPlan.find(filter).sort({
      expectedReturnMin: -1,
    });

    logger.info("Investment plans search completed", {
      requestId: req.id,
      resultCount: searchResults.length,
      timestamp: new Date().toISOString(),
    });

    return apiResponse.success(
      res,
      200,
      "Success",
      "Investment plans search completed",
      { investmentPlans: searchResults }
    );
  } catch (error) {
    logger.error("Error searching investment plans:", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
      searchQuery: req.query,
      ip: req.ip,
      timestamp: new Date().toISOString(),
    });
    next(error);
  }
};

/**
 * @desc    Get investment plans by maturity period range
 * @route   GET /api/investment-plans/maturity
 * @access  Public
 */
exports.getPlansByMaturity = async (req, res, next) => {
  try {
    const { minDays, maxDays } = req.query;

    logger.info("Get investment plans by maturity period request", {
      requestId: req.id,
      userId: req.user?._id,
      minDays,
      maxDays,
      timestamp: new Date().toISOString(),
      ip: req.ip,
    });

    // Build query filter
    const filter = { isActive: true };

    if (minDays) {
      filter.maturityPeriod = {
        ...filter.maturityPeriod,
        $gte: parseInt(minDays, 10),
      };
    }

    if (maxDays) {
      filter.maturityPeriod = {
        ...filter.maturityPeriod,
        $lte: parseInt(maxDays, 10),
      };
    }

    const plans = await InvestmentPlan.find(filter).sort({ maturityPeriod: 1 }); // Sort by shortest maturity first

    logger.info("Investment plans by maturity period retrieved successfully", {
      requestId: req.id,
      count: plans.length,
      maturityRange: `${minDays || "0"}-${maxDays || "unlimited"}`,
      timestamp: new Date().toISOString(),
    });

    return apiResponse.success(
      res,
      200,
      "Success",
      "Investment plans retrieved by maturity period",
      { investmentPlans: plans }
    );
  } catch (error) {
    logger.error("Error retrieving investment plans by maturity period:", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
      params: req.query,
      ip: req.ip,
      timestamp: new Date().toISOString(),
    });
    next(error);
  }
};

/**
 * @desc    Get investment plan statistics
 * @route   GET /api/investment-plans/stats
 * @access  Admin
 */
exports.getInvestmentPlanStats = async (req, res, next) => {
  try {
    logger.info("Get investment plan statistics request", {
      requestId: req.id,
      userId: req.user._id,
      timestamp: new Date().toISOString(),
      ip: req.ip,
    });

    // Get total count of plans
    const totalPlans = await InvestmentPlan.countDocuments();

    // Get count of active plans
    const activePlans = await InvestmentPlan.countDocuments({ isActive: true });

    // Get count of featured plans
    const featuredPlans = await InvestmentPlan.countDocuments({
      isFeatured: true,
    });

    // Get counts by risk level
    const lowRiskPlans = await InvestmentPlan.countDocuments({
      riskLevel: "low",
    });
    const mediumRiskPlans = await InvestmentPlan.countDocuments({
      riskLevel: "medium",
    });
    const highRiskPlans = await InvestmentPlan.countDocuments({
      riskLevel: "high",
    });
    const veryHighRiskPlans = await InvestmentPlan.countDocuments({
      riskLevel: "very_high",
    });

    // Get average expected return ranges
    const plans = await InvestmentPlan.find(
      {},
      "expectedReturnMin expectedReturnMax"
    );

    let totalMinReturn = 0;
    let totalMaxReturn = 0;

    plans.forEach((plan) => {
      totalMinReturn += plan.expectedReturnMin;
      totalMaxReturn += plan.expectedReturnMax;
    });

    const avgMinReturn = plans.length
      ? (totalMinReturn / plans.length).toFixed(2)
      : 0;
    const avgMaxReturn = plans.length
      ? (totalMaxReturn / plans.length).toFixed(2)
      : 0;

    const stats = {
      totalPlans,
      activePlans,
      inactivePlans: totalPlans - activePlans,
      featuredPlans,
      riskLevelDistribution: {
        low: lowRiskPlans,
        medium: mediumRiskPlans,
        high: highRiskPlans,
        very_high: veryHighRiskPlans,
      },
      returnRates: {
        averageMinReturn: parseFloat(avgMinReturn),
        averageMaxReturn: parseFloat(avgMaxReturn),
        averageRange: `${avgMinReturn}%-${avgMaxReturn}%`,
      },
    };

    logger.info("Investment plan statistics retrieved successfully", {
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });

    return apiResponse.success(
      res,
      200,
      "Success",
      "Investment plan statistics retrieved successfully",
      { stats }
    );
  } catch (error) {
    logger.error("Error retrieving investment plan statistics:", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
      ip: req.ip,
      timestamp: new Date().toISOString(),
    });
    next(error);
  }
};

// /**
//  * @desc    Get all active investment plans
//  * @route   GET /api/investments/plans
//  * @access  Private
//  */
// exports.getAvailableInvestmentPlans = async (req, res, next) => {
//   try {
//     logger.info("Fetching available investment plans", {
//       userId: req.user._id,
//       requestId: req.id,
//       timestamp: new Date().toISOString(),
//     });

//     // Get all active plans
//     const plans = await InvestmentPlan.find({ isActive: true });

//     return apiResponse.success(
//       res,
//       200,
//       "Investment Plans Retrieved",
//       "Investment plans retrieved successfully",
//       { plans }
//     );
//   } catch (error) {
//     logger.error("Error fetching investment plans", {
//       userId: req.user._id,
//       error: error.message,
//       stack: error.stack,
//       requestId: req.id,
//       timestamp: new Date().toISOString(),
//     });
//     next(error);
//   }
// };

// /**
//  * @desc    Get investment plan by ID
//  * @route   GET /api/investments/plans/:planId
//  * @access  Private
//  */
// exports.getInvestmentPlanById = async (req, res, next) => {
//   try {
//     const { planId } = req.params;

//     logger.info("Fetching investment plan by ID", {
//       userId: req.user._id,
//       planId,
//       requestId: req.id,
//       timestamp: new Date().toISOString(),
//     });

//     const plan = await InvestmentPlan.findById(planId);

//     if (!plan) {
//       logger.warn("Investment plan not found", {
//         userId: req.user._id,
//         planId,
//         requestId: req.id,
//         timestamp: new Date().toISOString(),
//       });
//       return apiResponse.notFound(res, "Plan not found");
//     }

//     return apiResponse.success(
//       res,
//       200,
//       "Investment Plan Retrieved",
//       "Investment plan retrieved successfully",
//       { plan }
//     );
//   } catch (error) {
//     logger.error("Error fetching investment plan", {
//       userId: req.user._id,
//       planId: req.params.planId,
//       error: error.message,
//       stack: error.stack,
//       requestId: req.id,
//       timestamp: new Date().toISOString(),
//     });
//     next(error);
//   }
// };

/**
 * @desc    Get user's active investments
 * @route   GET /api/investments
 * @access  Private
 */
exports.getUserInvestments = async (req, res, next) => {
  try {
    logger.info("Fetching user investments", {
      userId: req.user._id,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });

    const investments = await UserInvestment.find({ user: req.user._id })
      .populate("plan")
      .populate("transactions")
      .sort({ createdAt: -1 });

    return apiResponse.success(
      res,
      200,
      "Investments Retrieved",
      "User investments retrieved successfully",
      { investments }
    );
  } catch (error) {
    logger.error("Error fetching user investments", {
      userId: req.user._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });
    next(error);
  }
};

/**
 * @desc    Get user investment by ID
 * @route   GET /api/investments/:investmentId
 * @access  Private
 */
exports.getUserInvestmentById = async (req, res, next) => {
  try {
    const { investmentId } = req.params;

    logger.info("Fetching user investment by ID", {
      userId: req.user._id,
      investmentId,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });

    const investment = await UserInvestment.findOne({
      _id: investmentId,
      user: req.user._id,
    })
      .populate("plan")
      .populate({
        path: "transactions",
        options: { sort: { processedAt: -1 } },
      })
      .populate("sourceAccount");

    if (!investment) {
      logger.warn("Investment not found", {
        userId: req.user._id,
        investmentId,
        requestId: req.id,
        timestamp: new Date().toISOString(),
      });
      return apiResponse.notFound(res, "Investment not found");
    }

    // Get daily interest history
    const interestHistory = investment.interestHistory || [];

    return apiResponse.success(
      res,
      200,
      "Investment Retrieved",
      "Investment retrieved successfully",
      { investment, interestHistory }
    );
  } catch (error) {
    logger.error("Error fetching user investment", {
      userId: req.user._id,
      investmentId: req.params.investmentId,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
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
// exports.addUserInvestment = async (req, res, next) => {
//   // Start a MongoDB transaction session
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     const {
//       planId,
//       amount,
//       sourceWalletId,
//       autoRenew = false,
//       notes = "",
//     } = req.body;

//     logger.info("Creating new investment", {
//       userId: req.user._id,
//       planId,
//       amount,
//       sourceWalletId,
//       autoRenew,
//       requestId: req.id,
//       timestamp: new Date().toISOString(),
//     });

//     // Validate required fields
//     if (!planId || !amount || !sourceWalletId) {
//       logger.warn("Missing required fields", {
//         userId: req.user._id,
//         requestId: req.id,
//         timestamp: new Date().toISOString(),
//         providedFields: { planId, amount, sourceWalletId },
//       });
//       return apiResponse.badRequest(
//         res,
//         "Bad Request",
//         "Missing required fields"
//       );
//     }

//     // Find the investment plan
//     const plan = await InvestmentPlan.findById(planId).session(session);

//     if (!plan) {
//       logger.warn("Investment plan not found", {
//         userId: req.user._id,
//         planId,
//         requestId: req.id,
//         timestamp: new Date().toISOString(),
//       });
//       return apiResponse.notFound(res, "Investment plan not found");
//     }

//     // Check if plan is active
//     if (!plan.isActive) {
//       logger.warn("Investment plan is not active", {
//         userId: req.user._id,
//         planId,
//         requestId: req.id,
//         timestamp: new Date().toISOString(),
//       });
//       return apiResponse.badRequest(res, "Investment plan is not active");
//     }

//     // Convert amount to Number for precise calculations
//     const numericAmount = parseFloat(amount);

//     // Find the source wallet to get its currency
//     const sourceWallet = await Wallet.findOne({
//       _id: sourceWalletId,
//       user: req.user._id,
//     }).session(session);

//     if (!sourceWallet) {
//       logger.warn("Source wallet not found", {
//         userId: req.user._id,
//         sourceWalletId,
//         requestId: req.id,
//         timestamp: new Date().toISOString(),
//       });
//       return apiResponse.notFound(res, "Source wallet not found");
//     }

//     // Convert amount to USD for comparison with minInvestment if wallet currency is different
//     let usdAmount = numericAmount;
//     if (sourceWallet.currency !== "USD") {
//       // Use the convertToUSD function from your existing code
//       const decimalAmount = mongoose.Types.Decimal128.fromString(
//         numericAmount.toString()
//       );
//       const usdDecimal = await convertCurrency(
//         decimalAmount,
//         sourceWallet.currency,
//         "USD"
//       );
//       usdAmount = parseFloat(usdDecimal.toString());

//       logger.debug("Currency conversion for minimum investment check", {
//         userId: req.user._id,
//         requestId: req.id,
//         originalAmount: numericAmount,
//         originalCurrency: sourceWallet.currency,
//         convertedAmount: usdAmount,
//         convertedCurrency: "USD",
//         timestamp: new Date().toISOString(),
//       });
//     }

//     // Validate minimum investment amount (in USD)
//     if (usdAmount < plan.minInvestment) {
//       logger.warn("Investment amount below minimum", {
//         userId: req.user._id,
//         planId,
//         amount: numericAmount,
//         amountInUSD: usdAmount,
//         minRequired: plan.minInvestment,
//         requestId: req.id,
//         timestamp: new Date().toISOString(),
//       });
//       return apiResponse.badRequest(
//         res,
//         "Minimum investment amount not met",
//         `Minimum investment amount is ${plan.minInvestment} ${plan.currency}`
//       );
//     }

//     // We already found the source wallet above for currency conversion

//     if (!sourceWallet) {
//       logger.warn("Source wallet not found", {
//         userId: req.user._id,
//         sourceWalletId,
//         requestId: req.id,
//         timestamp: new Date().toISOString(),
//       });
//       return apiResponse.notFound(res, "Source wallet not found");
//     }

//     // Check if wallet has sufficient balance
//     if (sourceWallet.balance < numericAmount) {
//       logger.warn("Insufficient funds in source wallet", {
//         userId: req.user._id,
//         sourceWalletId,
//         walletBalance: sourceWallet.balance,
//         requestedAmount: numericAmount,
//         requestId: req.id,
//         timestamp: new Date().toISOString(),
//       });
//       return apiResponse.badRequest(res, "Insufficient funds in source wallet");
//     }

//     // Calculate expected return based on plan
//     const averageReturn = (plan.expectedReturnMin + plan.expectedReturnMax) / 2;
//     const expectedReturnRate = averageReturn / 100;
//     const maturityDate = new Date();
//     maturityDate.setDate(maturityDate.getDate() + plan.maturityPeriod);

//     // Generate unique references
//     const investmentReference = `INV-${Date.now()}-${crypto
//       .randomBytes(4)
//       .toString("hex")}`;

//     const transactionReference = `INVTX-${Date.now()}-${crypto
//       .randomBytes(4)
//       .toString("hex")}`;

//     // Convert investment amount to plan currency if needed
//     let investmentAmount = numericAmount;
//     let conversionRate = 1;

//     if (sourceWallet.currency !== plan.currency) {
//       // Convert from source currency to plan currency (typically USD)
//       const decimalAmount = mongoose.Types.Decimal128.fromString(
//         numericAmount.toString()
//       );
//       const convertedDecimal = await convertCurrency(
//         decimalAmount,
//         sourceWallet.currency,
//         plan.currency
//       );
//       investmentAmount = parseFloat(convertedDecimal.toString());
//       conversionRate = investmentAmount / numericAmount;

//       // Calculate total expected return amount at maturity using the converted amount
//       const expectedReturnAmount = investmentAmount * expectedReturnRate;
//       const totalExpectedValue = investmentAmount + expectedReturnAmount;

//       logger.debug("Currency conversion for investment", {
//         userId: req.user._id,
//         requestId: req.id,
//         originalAmount: numericAmount,
//         originalCurrency: sourceWallet.currency,
//         convertedAmount: investmentAmount,
//         convertedCurrency: plan.currency,
//         conversionRate,
//         timestamp: new Date().toISOString(),
//       });
//     }

//     // Create the investment record
//     const newInvestment = new UserInvestment({
//       user: req.user._id,
//       plan: planId,
//       amount: investmentAmount, // Use the converted amount
//       source: sourceWalletId, // Use source to match schema
//       status: "active",
//       investedAt: new Date(),
//       maturityDate,
//       currency: plan.currency,
//       rate: averageReturn,
//       currentValue: investmentAmount, // Initially equal to converted investment amount
//       label: notes || `Investment in ${plan.name}`,
//       compoundFrequency: plan.compoundFrequency || "monthly",
//       withdrawalAllowed: plan.allowEarlyWithdrawal || false,
//       earlyWithdrawalFee: plan.earlyWithdrawalFee || 0,
//       transactions: [], // Will be populated with the initial transaction
//       withdrawalHistory: [],
//     });

//     await newInvestment.save({ session });

//     // Deduct the amount from the source wallet
//     const oldBalance = sourceWallet.balance;
//     sourceWallet.balance = oldBalance - numericAmount;

//     // Also update ledger balance
//     sourceWallet.ledgerBalance = sourceWallet.ledgerBalance - numericAmount;
//     sourceWallet.lastActivityAt = new Date();

//     logger.debug("Updating source wallet balance", {
//       userId: req.user._id,
//       sourceWalletId,
//       oldBalance,
//       amountDeducted: numericAmount,
//       newBalance: sourceWallet.balance,
//       requestId: req.id,
//       timestamp: new Date().toISOString(),
//     });

//     await sourceWallet.save({ session });

//     // Create a wallet transaction for the debit from source wallet
//     const walletDebitTransaction = new WalletTransaction({
//       user: req.user._id,
//       type: "investment",
//       amount: numericAmount, // Original amount in source currency
//       currency: sourceWallet.currency,
//       source: sourceWallet._id,
//       sourceType: "Wallet",
//       sourceCurrency: sourceWallet.currency,
//       beneficiary: newInvestment._id,
//       beneficiaryType: "UserInvestment",
//       beneficiaryCurrency: plan.currency,
//       conversionRate: conversionRate, // Use the actual conversion rate
//       description: notes || `Investment in ${plan.name}`,
//       status: "completed",
//       reference: transactionReference,
//       metadata: {
//         investmentId: newInvestment._id,
//         planId: plan._id,
//         planName: plan.name,
//       },
//       completedAt: new Date(),
//     });

//     await walletDebitTransaction.save({ session });

//     // Create an investment transaction record (for investment-specific tracking)
//     const investmentTransaction = new InvestmentTransaction({
//       user: req.user._id,
//       type: "credit",
//       amount: investmentAmount, // Use converted amount in plan currency
//       currency: plan.currency,
//       source: sourceWallet._id,
//       sourceType: "Wallet",
//       sourceCurrency: sourceWallet.currency,
//       beneficiary: newInvestment._id,
//       beneficiaryType: "UserInvestment",
//       beneficiaryCurrency: plan.currency,
//       description: notes || `New investment in ${plan.name}`,
//       status: "completed",
//       reference: investmentReference,
//     });

//     await investmentTransaction.save({ session });

//     // Add transactions to the investment's transactions array
//     newInvestment.transactions.push(walletDebitTransaction._id);
//     newInvestment.transactions.push(investmentTransaction._id);
//     await newInvestment.save({ session });

//     // Add transaction to the wallet's transactions array
//     if (!sourceWallet.transactions) {
//       sourceWallet.transactions = [];
//     }
//     sourceWallet.transactions.push(walletDebitTransaction._id);
//     await sourceWallet.save({ session });

//     // Update User collection to track this investment (safely)
//     // Only add the investment ID if it's not already there
//     await User.findByIdAndUpdate(
//       req.user._id,
//       { $addToSet: { investments: newInvestment._id } },
//       { session }
//     );

//     // Commit the transaction
//     await session.commitTransaction();
//     session.endSession();

//     logger.info("Investment created successfully", {
//       userId: req.user._id,
//       investmentId: newInvestment._id,
//       planId,
//       amount: numericAmount,
//       reference: investmentReference,
//       requestId: req.id,
//       timestamp: new Date().toISOString(),
//     });

//     return apiResponse.created(
//       res,
//       "Investment Created",
//       "Investment created successfully",
//       {
//         investment: newInvestment,
//         transaction: walletDebitTransaction,
//         plan,
//       }
//     );
//   } catch (error) {
//     // Abort transaction on error
//     await session.abortTransaction();
//     session.endSession();

//     logger.error("Error creating investment", {
//       userId: req.user._id,
//       error: error.message,
//       stack: error.stack,
//       requestId: req.id,
//       timestamp: new Date().toISOString(),
//     });

//     next(error);
//   }
// };

/**
 * @desc    Create a new investment
 * @route   POST /api/investments
 * @access  Private
 */
exports.addUserInvestment = async (req, res, next) => {
  // Start a MongoDB transaction session
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      planId,
      amount,
      sourceWalletId,
      autoRenew = false,
      notes = "",
    } = req.body;

    logger.info("Creating new investment", {
      userId: req.user._id,
      planId,
      amount,
      sourceWalletId,
      autoRenew,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });

    // Validate required fields
    if (!planId || !amount || !sourceWalletId) {
      logger.warn("Missing required fields", {
        userId: req.user._id,
        requestId: req.id,
        timestamp: new Date().toISOString(),
        providedFields: { planId, amount, sourceWalletId },
      });
      
      await session.abortTransaction();
      session.endSession();
      
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Missing required fields"
      );
    }

    // Find the investment plan
    const plan = await InvestmentPlan.findById(planId).session(session);

    if (!plan) {
      logger.warn("Investment plan not found", {
        userId: req.user._id,
        planId,
        requestId: req.id,
        timestamp: new Date().toISOString(),
      });
      
      await session.abortTransaction();
      session.endSession();
      
      return apiResponse.notFound(res, "Investment plan not found");
    }

    // Check if plan is active
    if (!plan.isActive) {
      logger.warn("Investment plan is not active", {
        userId: req.user._id,
        planId,
        requestId: req.id,
        timestamp: new Date().toISOString(),
      });
      
      await session.abortTransaction();
      session.endSession();
      
      return apiResponse.badRequest(res, "Investment plan is not active");
    }

    // Convert amount to Number for precise calculations
    const numericAmount = parseFloat(amount);

    // Find the source wallet to get its currency
    const sourceWallet = await Wallet.findOne({
      _id: sourceWalletId,
      user: req.user._id,
    }).session(session);

    if (!sourceWallet) {
      logger.warn("Source wallet not found", {
        userId: req.user._id,
        sourceWalletId,
        requestId: req.id,
        timestamp: new Date().toISOString(),
      });
      
      await session.abortTransaction();
      session.endSession();
      
      return apiResponse.notFound(res, "Source wallet not found");
    }

    // Convert amount to USD for comparison with minInvestment if wallet currency is different
    let usdAmount = numericAmount;
    if (sourceWallet.currency !== "USD" && sourceWallet.currency !== plan.currency) {
      // Use the convertToUSD function from your existing code
      try {
        const decimalAmount = mongoose.Types.Decimal128.fromString(
          numericAmount.toString()
        );
        const usdDecimal = await convertCurrency(
          decimalAmount,
          sourceWallet.currency,
          "USD"
        );
        usdAmount = parseFloat(usdDecimal.toString());

        logger.debug("Currency conversion for minimum investment check", {
          userId: req.user._id,
          requestId: req.id,
          originalAmount: numericAmount,
          originalCurrency: sourceWallet.currency,
          convertedAmount: usdAmount,
          convertedCurrency: "USD",
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error("Error converting currency", {
          userId: req.user._id,
          sourceWalletId,
          fromCurrency: sourceWallet.currency,
          toCurrency: "USD",
          amount: numericAmount,
          error: error.message,
          requestId: req.id,
          timestamp: new Date().toISOString(),
        });
        
        await session.abortTransaction();
        session.endSession();
        
        return apiResponse.serverError(res, "Error converting currency");
      }
    }

    // Validate minimum investment amount (in USD)
    if (usdAmount < plan.minInvestment) {
      logger.warn("Investment amount below minimum", {
        userId: req.user._id,
        planId,
        amount: numericAmount,
        amountInUSD: usdAmount,
        minRequired: plan.minInvestment,
        requestId: req.id,
        timestamp: new Date().toISOString(),
      });
      
      await session.abortTransaction();
      session.endSession();
      
      return apiResponse.badRequest(
        res,
        "Minimum investment amount not met",
        `Minimum investment amount is ${plan.minInvestment} ${plan.currency}`
      );
    }

    // Check if wallet has sufficient balance
    if (sourceWallet.balance < numericAmount) {
      logger.warn("Insufficient funds in source wallet", {
        userId: req.user._id,
        sourceWalletId,
        walletBalance: sourceWallet.balance,
        requestedAmount: numericAmount,
        requestId: req.id,
        timestamp: new Date().toISOString(),
      });
      
      await session.abortTransaction();
      session.endSession();
      
      return apiResponse.badRequest(res, "Insufficient funds in source wallet");
    }

    // Calculate expected return based on plan
    const averageReturn = (plan.expectedReturnMin + plan.expectedReturnMax) / 2;
    const expectedReturnRate = averageReturn / 100;
    const maturityDate = new Date();
    maturityDate.setDate(maturityDate.getDate() + plan.maturityPeriod);

    // Generate unique references
    const investmentReference = `INV-${Date.now()}-${crypto
      .randomBytes(4)
      .toString("hex")}`;

    const transactionReference = `INVTX-${Date.now()}-${crypto
      .randomBytes(4)
      .toString("hex")}`;

    // Convert investment amount to plan currency if needed
    let investmentAmount = numericAmount;
    let conversionRate = 1;

    if (sourceWallet.currency !== plan.currency) {
      // Convert from source currency to plan currency
      try {
        const decimalAmount = mongoose.Types.Decimal128.fromString(
          numericAmount.toString()
        );
        const convertedDecimal = await convertCurrency(
          decimalAmount,
          sourceWallet.currency,
          plan.currency
        );
        investmentAmount = parseFloat(convertedDecimal.toString());
        conversionRate = investmentAmount / numericAmount;

        // Calculate total expected return amount at maturity using the converted amount
        const expectedReturnAmount = investmentAmount * expectedReturnRate;
        const totalExpectedValue = investmentAmount + expectedReturnAmount;

        logger.debug("Currency conversion for investment", {
          userId: req.user._id,
          requestId: req.id,
          originalAmount: numericAmount,
          originalCurrency: sourceWallet.currency,
          convertedAmount: investmentAmount,
          convertedCurrency: plan.currency,
          conversionRate,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error("Error converting currency for investment", {
          userId: req.user._id,
          sourceWalletId,
          fromCurrency: sourceWallet.currency,
          toCurrency: plan.currency,
          amount: numericAmount,
          error: error.message,
          requestId: req.id,
          timestamp: new Date().toISOString(),
        });
        
        await session.abortTransaction();
        session.endSession();
        
        return apiResponse.serverError(res, "Error converting currency for investment");
      }
    }

    // Create the investment record with growth schedule metadata
    const newInvestment = new UserInvestment({
      user: req.user._id,
      plan: planId,
      amount: investmentAmount, // Use the converted amount
      source: sourceWalletId, // Use source to match schema
      status: "active",
      investedAt: new Date(),
      maturityDate,
      currency: plan.currency,
      rate: averageReturn,
      currentValue: investmentAmount, // Initially equal to converted investment amount
      label: notes || `Investment in ${plan.name}`,
      compoundFrequency: plan.compoundFrequency || "monthly",
      withdrawalAllowed: plan.allowEarlyWithdrawal || false,
      earlyWithdrawalFee: plan.earlyWithdrawalFee || 0,
      transactions: [], // Will be populated with the initial transaction
      withdrawalHistory: [],
      metadata: {} // Will store the growth schedule
    });

    await newInvestment.save({ session });

    // Deduct the amount from the source wallet
    const oldBalance = sourceWallet.balance;
    sourceWallet.balance = oldBalance - numericAmount;

    // Also update ledger balance
    sourceWallet.ledgerBalance = sourceWallet.ledgerBalance - numericAmount;
    sourceWallet.lastActivityAt = new Date();

    logger.debug("Updating source wallet balance", {
      userId: req.user._id,
      sourceWalletId,
      oldBalance,
      amountDeducted: numericAmount,
      newBalance: sourceWallet.balance,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });

    await sourceWallet.save({ session });

    // Create a wallet transaction for the debit from source wallet
    const walletDebitTransaction = new WalletTransaction({
      user: req.user._id,
      type: "investment",
      amount: numericAmount, // Original amount in source currency
      currency: sourceWallet.currency,
      source: sourceWallet._id,
      sourceType: "Wallet",
      sourceCurrency: sourceWallet.currency,
      beneficiary: newInvestment._id,
      beneficiaryType: "UserInvestment",
      beneficiaryCurrency: plan.currency,
      conversionRate: conversionRate, // Use the actual conversion rate
      description: notes || `Investment in ${plan.name}`,
      status: "completed",
      reference: transactionReference,
      metadata: {
        investmentId: newInvestment._id,
        planId: plan._id,
        planName: plan.name,
      },
      completedAt: new Date(),
    });

    await walletDebitTransaction.save({ session });

    // Create an investment transaction record (for investment-specific tracking)
    const investmentTransaction = new InvestmentTransaction({
      user: req.user._id,
      type: "credit",
      amount: investmentAmount, // Use converted amount in plan currency
      currency: plan.currency,
      source: sourceWallet._id,
      sourceType: "Wallet",
      sourceCurrency: sourceWallet.currency,
      beneficiary: newInvestment._id,
      beneficiaryType: "UserInvestment",
      beneficiaryCurrency: plan.currency,
      description: notes || `New investment in ${plan.name}`,
      status: "completed",
      reference: investmentReference,
    });

    await investmentTransaction.save({ session });

    // Add transactions to the investment's transactions array
    newInvestment.transactions.push(walletDebitTransaction._id);
    newInvestment.transactions.push(investmentTransaction._id);
    
    // Generate and store realistic daily growth schedule
    // Calculate maturity period in days
    const startDate = newInvestment.investedAt;
    const endDate = newInvestment.maturityDate;
    const maturityPeriodDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
    
    // Calculate total expected return
    const totalExpectedReturn = investmentAmount * (averageReturn / 100) * (maturityPeriodDays / 365);
    
    // Generate random daily returns with normal distribution
    const dailyReturns = [];
    let totalGeneratedReturn = 0;
    const avgDailyReturn = totalExpectedReturn / maturityPeriodDays;
    const volatility = 0.6; // Moderate volatility for realistic fluctuation
    const maxVariance = avgDailyReturn * volatility * 2;
    
    // First, generate random daily returns
    for (let i = 0; i < maturityPeriodDays; i++) {
      // Generate a random number with normal-ish distribution (using Box-Muller transform)
      let u = 0, v = 0;
      while (u === 0) u = Math.random();
      while (v === 0) v = Math.random();
      let standardNormal = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
      
      // Adjust the normal distribution to have our desired mean and variance
      let dailyReturn = avgDailyReturn + (standardNormal * (maxVariance / 4));
      
      // Ensure we don't have negative returns on most days (small chance is ok for realism)
      if (dailyReturn < -avgDailyReturn * 0.2) {
        dailyReturn = -avgDailyReturn * 0.2;
      }
      
      dailyReturns.push(dailyReturn);
      totalGeneratedReturn += dailyReturn;
    }
    
    // Adjust returns to ensure they sum to the expected total return
    const adjustmentFactor = totalExpectedReturn / totalGeneratedReturn;
    const adjustedDailyReturns = dailyReturns.map(dailyReturn => 
      parseFloat((dailyReturn * adjustmentFactor).toFixed(8))
    );
    
    // Store the growth schedule in investment metadata
    newInvestment.metadata = {
      growthSchedule: adjustedDailyReturns,
      lastGrowthDate: newInvestment.investedAt,
      nextGrowthIndex: 0
    };
    
    await newInvestment.save({ session });

    // Add transaction to the wallet's transactions array
    if (!sourceWallet.transactions) {
      sourceWallet.transactions = [];
    }
    sourceWallet.transactions.push(walletDebitTransaction._id);
    await sourceWallet.save({ session });

    // Update User collection to track this investment (safely)
    // Only add the investment ID if it's not already there
    await User.findByIdAndUpdate(
      req.user._id,
      { $addToSet: { investments: newInvestment._id } },
      { session }
    );

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Investment created successfully with growth schedule", {
      userId: req.user._id,
      investmentId: newInvestment._id,
      planId,
      amount: numericAmount,
      convertedAmount: investmentAmount,
      maturityDays: maturityPeriodDays,
      totalExpectedReturn,
      reference: investmentReference,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });

    return apiResponse.created(
      res,
      "Investment Created",
      "Investment created successfully",
      {
        investment: newInvestment,
        transaction: walletDebitTransaction,
        plan,
      }
    );
  } catch (error) {
    // Abort transaction on error
    await session.abortTransaction();
    session.endSession();

    logger.error("Error creating investment", {
      userId: req.user?._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });

    next(error);
  }
}

/**
 * @desc    Get investment projection to maturity
 * @route   GET /api/investments/:investmentId/projection
 * @access  Private
 */
exports.getInvestmentProjection = async (req, res, next) => {
  try {
    const { investmentId } = req.params;

    logger.info("Fetching investment projection", {
      userId: req.user._id,
      investmentId,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });

    // Check if ID is valid
    if (!mongoose.Types.ObjectId.isValid(investmentId)) {
      return apiResponse.badRequest(res, "Invalid investment ID format");
    }

    // Find the investment and ensure it belongs to the requesting user
    const investment = await UserInvestment.findOne({
      _id: investmentId,
      user: req.user._id,
    }).populate("plan");

    if (!investment) {
      return apiResponse.notFound(res, "Investment not found");
    }

    // Get the growth schedule from metadata
    const growthSchedule = investment.metadata?.growthSchedule || [];
    const nextGrowthIndex = investment.metadata?.nextGrowthIndex || 0;

    // Calculate remaining growth
    const remainingGrowth = growthSchedule.slice(nextGrowthIndex);
    const currentValue = parseFloat(investment.currentValue);

    // Generate projection dates and values
    const projection = [];
    let projectedValue = currentValue;

    for (let i = 0; i < remainingGrowth.length; i++) {
      const growthDate = new Date();
      growthDate.setDate(growthDate.getDate() + i + 1); // Start from tomorrow

      projectedValue += remainingGrowth[i];

      projection.push({
        date: growthDate.toISOString().split("T")[0],
        projectedValue: parseFloat(projectedValue.toFixed(2)),
        dailyGrowth: remainingGrowth[i],
      });
    }

    const maturityProjection = {
      initialValue: investment.amount,
      currentValue,
      projectedFinalValue:
        projection.length > 0
          ? projection[projection.length - 1].projectedValue
          : currentValue,
      totalProjectedReturn:
        projection.length > 0
          ? projection[projection.length - 1].projectedValue - investment.amount
          : currentValue - investment.amount,
      remainingDaysToMaturity: remainingGrowth.length,
      projection:
        projection.length > 50
          ? [
              ...projection.slice(0, 10), // First 10 days
              ...projection.slice(-10), // Last 10 days
            ]
          : projection, // Full projection if less than 50 days
    };

    return apiResponse.success(
      res,
      200,
      "Projection Retrieved",
      "Investment projection retrieved successfully",
      {
        investment: {
          _id: investment._id,
          label: investment.label,
          planName: investment.plan.name,
          investedAt: investment.investedAt,
          maturityDate: investment.maturityDate,
        },
        maturityProjection,
      }
    );
  } catch (error) {
    logger.error("Error generating investment projection", {
      userId: req.user._id,
      investmentId: req.params.investmentId,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });
    next(error);
  }
};

/**
 * @desc    Process daily growth for a specific user investment
 * @route   POST /api/investments/:investmentId/process-growth
 * @access  Admin
 */
exports.processInvestmentGrowth = async (req, res, next) => {
  try {
    const { investmentId } = req.params;

    logger.info("Processing growth for specific investment", {
      userId: req.user._id,
      investmentId,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });

    // Check if ID is valid
    if (!mongoose.Types.ObjectId.isValid(investmentId)) {
      return apiResponse.badRequest(res, "Invalid investment ID format");
    }

    // Find the investment
    const investment = await UserInvestment.findById(investmentId);

    if (!investment) {
      logger.warn("Investment not found", {
        userId: req.user._id,
        investmentId,
        requestId: req.id,
        timestamp: new Date().toISOString(),
      });
      return apiResponse.notFound(res, "Investment not found");
    }

    // Check if investment is active
    if (investment.status !== "active") {
      logger.warn("Cannot process growth for non-active investment", {
        userId: req.user._id,
        investmentId,
        status: investment.status,
        requestId: req.id,
        timestamp: new Date().toISOString(),
      });
      return apiResponse.badRequest(
        res,
        "Cannot process growth for non-active investment"
      );
    }

    // Process daily growth
    const result = await investmentGrowthService.processDailyGrowth(investment);

    if (!result.success) {
      return apiResponse.success(res, 200, "Skipped", result.message, {
        result,
      });
    }

    return apiResponse.success(
      res,
      200,
      "Growth Processed",
      "Investment growth processed successfully",
      {
        previousValue: result.previousValue,
        growthAmount: result.growthAmount,
        newValue: result.newValue,
        transaction: result.transaction,
        investment: await UserInvestment.findById(investmentId),
      }
    );
  } catch (error) {
    logger.error("Error processing investment growth", {
      userId: req.user._id,
      investmentId: req.params.investmentId,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });
    next(error);
  }
};

/**
 * @desc    Process daily growth for all active investments (admin endpoint)
 * @route   POST /api/investments/process-all-growth
 * @access  Admin
 */
exports.processAllInvestmentsGrowth = async (req, res, next) => {
  try {
    logger.info("Processing growth for all investments", {
      requestedBy: req.user._id,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });

    const results = await investmentGrowthService.processAllInvestmentsGrowth();

    logger.info("Bulk growth processing completed", {
      processed: results.processed,
      skipped: results.skipped,
      matured: results.matured,
      failed: results.failed,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });

    return apiResponse.success(
      res,
      200,
      "Bulk Processing Complete",
      `Successfully processed ${results.processed} investments`,
      { results }
    );
  } catch (error) {
    logger.error("Error in bulk growth processing", {
      userId: req.user._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });
    next(error);
  }
};

/**
 * Generate a random daily interest amount ensuring the sum equals the total expected return
 * @param {number} totalReturn - Total return expected over the entire period
 * @param {number} remainingDays - Number of days remaining in the investment period
 * @param {number} accumulatedInterest - Interest already accumulated so far
 * @returns {number} - Random daily interest amount
 */
const generateDailyInterestAmount = (
  totalReturn,
  remainingDays,
  accumulatedInterest
) => {
  // Calculate remaining interest to be distributed
  const remainingInterest = totalReturn - accumulatedInterest;

  // If it's the last day, return all remaining interest
  if (remainingDays === 1) {
    return remainingInterest;
  }

  // Calculate average daily interest for remaining days
  const avgDailyInterest = remainingInterest / remainingDays;

  // Add randomization (between 50% and 150% of the average)
  const minInterest = avgDailyInterest * 0.5;
  const maxInterest = avgDailyInterest * 1.5;

  // Ensure we don't exceed the total remaining interest
  const maxPossible = Math.min(maxInterest, remainingInterest * 0.9);

  // Generate random amount within bounds
  const randomInterest =
    Math.random() * (maxPossible - minInterest) + minInterest;

  // Round to 2 decimal places for currency
  return parseFloat(randomInterest.toFixed(2));
};

/**
 * @desc    Process daily interest for all active investments (to be called by a scheduled job)
 * @route   Internal function, not exposed via API
 * @access  Private
 */
exports.processDailyInterest = async () => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    logger.info("Processing daily interest for active investments", {
      timestamp: new Date().toISOString(),
    });

    // Get all active investments
    const activeInvestments = await UserInvestment.find({
      status: "active",
      maturityDate: { $gt: new Date() }, // Not yet matured
    })
      .populate("plan")
      .populate("user")
      .session(session);

    logger.info(
      `Found ${activeInvestments.length} active investments to process`
    );

    const interestRecords = [];
    const processedInvestments = [];

    // Process each investment
    for (const investment of activeInvestments) {
      try {
        // Skip if already processed today
        const today = new Date().setHours(0, 0, 0, 0);
        const lastInterestEntry =
          investment.interestHistory.length > 0
            ? investment.interestHistory[investment.interestHistory.length - 1]
            : null;

        if (
          lastInterestEntry &&
          new Date(lastInterestEntry.date).setHours(0, 0, 0, 0) === today
        ) {
          logger.debug(
            `Investment ${investment._id} already processed today, skipping`
          );
          continue;
        }

        // Get the total expected return
        const totalExpectedReturn = parseFloat(
          investment.expectedReturn.toString()
        );

        // Calculate days passed and remaining
        const startDate = new Date(investment.startDate);
        const maturityDate = new Date(investment.maturityDate);
        const currentDate = new Date();

        const totalDays = Math.ceil(
          (maturityDate - startDate) / (1000 * 60 * 60 * 24)
        );
        const elapsedDays = Math.ceil(
          (currentDate - startDate) / (1000 * 60 * 60 * 24)
        );
        const remainingDays = Math.max(1, totalDays - elapsedDays);

        // Calculate accumulated interest so far
        const accumulatedInterest = investment.interestHistory.reduce(
          (sum, record) => sum + record.amount,
          0
        );

        // Generate a random daily interest amount
        const dailyInterest = generateDailyInterestAmount(
          totalExpectedReturn,
          remainingDays,
          accumulatedInterest
        );

        logger.debug(
          `Generated daily interest for investment ${investment._id}`,
          {
            investmentId: investment._id,
            userId: investment.user._id,
            totalExpectedReturn,
            totalDays,
            elapsedDays,
            remainingDays,
            accumulatedInterest,
            dailyInterest,
          }
        );

        // Create an interest record for today
        const interestRecord = {
          date: new Date(),
          amount: dailyInterest,
          balance:
            parseFloat(investment.currentValue.toString()) + dailyInterest,
        };

        // Update the investment's current value
        const newValue = mongoose.Types.Decimal128.fromString(
          (
            parseFloat(investment.currentValue.toString()) + dailyInterest
          ).toFixed(2)
        );

        investment.currentValue = newValue;
        investment.interestHistory.push(interestRecord);

        await investment.save({ session });

        interestRecords.push({
          investmentId: investment._id,
          userId: investment.user._id,
          planName: investment.plan.name,
          interestAmount: dailyInterest,
          newBalance: newValue.toString(),
        });

        processedInvestments.push(investment._id);
      } catch (error) {
        logger.error(
          `Error processing interest for investment ${investment._id}`,
          {
            error: error.message,
            stack: error.stack,
            investmentId: investment._id,
            userId: investment.user._id,
          }
        );
        // Continue processing other investments
      }
    }

    // Commit transaction
    await session.commitTransaction();

    logger.info("Daily interest processing completed", {
      processedCount: interestRecords.length,
      failedCount: activeInvestments.length - interestRecords.length,
      timestamp: new Date().toISOString(),
    });

    return {
      status: "success",
      processed: interestRecords.length,
      records: interestRecords,
    };
  } catch (error) {
    // Abort transaction on error
    await session.abortTransaction();

    logger.error("Error processing daily interest", {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });

    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Redeem an investment (early or at maturity)
 * @route   POST /api/investments/:investmentId/redeem
 * @access  Private
 */
exports.redeemInvestment = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { investmentId } = req.params;
    const { destinationAccountId } = req.body;

    logger.info("Redeeming investment", {
      userId: req.user._id,
      investmentId,
      destinationAccountId,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });

    // Validate required fields
    if (!destinationAccountId) {
      logger.warn("Destination account ID is required", {
        userId: req.user._id,
        investmentId,
        requestId: req.id,
        timestamp: new Date().toISOString(),
      });
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Destination account ID is required"
      );
    }

    // Find the investment
    const investment = await UserInvestment.findOne({
      _id: investmentId,
      user: req.user._id,
      status: "active", // Only active investments can be redeemed
    })
      .populate("plan")
      .session(session);

    if (!investment) {
      logger.warn("Investment not found or not active", {
        userId: req.user._id,
        investmentId,
        requestId: req.id,
        timestamp: new Date().toISOString(),
      });
      return apiResponse.notFound(res, "Investment not found or not active");
    }

    // Find the destination account
    const destinationAccount = await Account.findOne({
      _id: destinationAccountId,
      user: req.user._id,
    }).session(session);

    if (!destinationAccount) {
      logger.warn("Destination account not found", {
        userId: req.user._id,
        destinationAccountId,
        requestId: req.id,
        timestamp: new Date().toISOString(),
      });
      return apiResponse.notFound(res, "Destination account not found");
    }

    // Check if investment is at maturity
    const currentDate = new Date();
    const maturityDate = new Date(investment.maturityDate);
    const isMature = currentDate >= maturityDate;

    // If not mature, apply early redemption penalty if configured
    let earlyRedemptionFee = 0;
    let redemptionAmount = parseFloat(investment.currentValue.toString());

    if (!isMature && investment.plan.earlyRedemptionFee) {
      earlyRedemptionFee =
        redemptionAmount * (investment.plan.earlyRedemptionFee / 100);
      redemptionAmount -= earlyRedemptionFee;

      logger.info("Early redemption fee applied", {
        userId: req.user._id,
        investmentId,
        fee: earlyRedemptionFee,
        redemptionAmount,
        requestId: req.id,
        timestamp: new Date().toISOString(),
      });
    }

    // Generate reference for the transaction
    const reference = `RED-${Date.now()}-${crypto
      .randomBytes(4)
      .toString("hex")}`;

    // Convert redemption amount to Decimal128
    const decimalRedemptionAmount = mongoose.Types.Decimal128.fromString(
      redemptionAmount.toFixed(2)
    );

    // Create transaction for the redemption
    const transaction = new Transaction({
      user: req.user._id,
      type: "credit",
      amount: decimalRedemptionAmount,
      source: "Investment",
      sourceType: "Investment",
      sourceCurrency: investment.plan.currency,
      sourceUser: req.user._id,
      destination: destinationAccount.accountNumber,
      destinationType: "Account",
      destinationCurrency: destinationAccount.currency || "USD",
      beneficiary: req.user._id,
      description: isMature
        ? `Matured investment in ${investment.plan.name}`
        : `Early redemption of investment in ${investment.plan.name}`,
      status: "completed",
      reference,
      metadata: {
        investmentPlan: investment.plan.name,
        planId: investment.plan._id,
        investmentId: investment._id,
        isEarlyRedemption: !isMature,
        earlyRedemptionFee: earlyRedemptionFee,
      },
      processedAt: new Date(),
    });

    // Update destination account balance
    const oldBalance = destinationAccount.availableBalance.toString();
    destinationAccount.availableBalance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(destinationAccount.availableBalance.toString()) +
        redemptionAmount
      ).toFixed(2)
    );

    // Also update ledger balance
    destinationAccount.ledgerBalance = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(destinationAccount.ledgerBalance.toString()) +
        redemptionAmount
      ).toFixed(2)
    );

    logger.debug("Updating destination account balance", {
      userId: req.user._id,
      destinationAccountId,
      oldBalance,
      amountAdded: redemptionAmount,
      newBalance: destinationAccount.availableBalance.toString(),
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });

    // Update investment status
    investment.status = "redeemed";
    investment.endDate = new Date();
    investment.transactions.push(transaction._id);

    // If early redemption, record the penalty
    if (!isMature) {
      investment.earlyRedemptionFee = mongoose.Types.Decimal128.fromString(
        earlyRedemptionFee.toFixed(2)
      );
    }

    // Update destination account
    if (!destinationAccount.transactions) {
      destinationAccount.transactions = [];
    }
    destinationAccount.transactions.push(transaction._id);

    // Save all changes
    await investment.save({ session });
    await destinationAccount.save({ session });
    await transaction.save({ session });

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Investment redeemed successfully", {
      userId: req.user._id,
      investmentId,
      destinationAccountId,
      redemptionAmount,
      isMature,
      reference,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });

    return apiResponse.success(
      res,
      200,
      "Investment Redeemed",
      "Investment redeemed successfully",
      {
        investment,
        transaction,
        redemptionAmount,
        isMature,
      }
    );
  } catch (error) {
    // Abort transaction on error
    await session.abortTransaction();
    session.endSession();

    logger.error("Error redeeming investment", {
      userId: req.user._id,
      investmentId: req.params.investmentId,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });

    next(error);
  }
};
