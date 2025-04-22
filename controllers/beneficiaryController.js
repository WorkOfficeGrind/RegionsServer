const mongoose = require("mongoose");
const Beneficiary = require("../models/Beneficiary");
const Account = require("../models/Account");
const Card = require("../models/Card");
const Wallet = require("../models/Wallet");
const User = require("../models/User");
const { logger } = require("../config/logger");
const apiResponse = require("../utils/apiResponse");
const notificationService = require("../services/notificationService");

// Helper function to get entity model based on type
const getEntityModel = (entityType) => {
  switch (entityType) {
    case "account":
      return Account;
    case "card":
      return Card;
    case "wallet":
      return Wallet;
    default:
      return null;
  }
};

/**
 * Create a new beneficiary
 * @route POST /api/beneficiaries
 */
exports.createBeneficiary = async (req, res) => {
  let session = null;

  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const { entityType, entityId, ...beneficiaryData } = req.body;

    // Set user from authenticated request (this is the user who owns the beneficiary)
    beneficiaryData.user = req.user._id;

    // If this is an internal entity, validate it exists
    if (entityType !== "external" && entityId) {
      const EntityModel = getEntityModel(entityType);
      if (!EntityModel) {
        await session.abortTransaction();
        session.endSession();
        return apiResponse.badRequest(
          res,
          "Invalid Entity Type",
          `${entityType} is not a valid entity type`,
          "INVALID_ENTITY_TYPE"
        );
      }

      // Find entity without restricting to current user's ownership
      const entity = await EntityModel.findOne({
        _id: entityId,
      }).session(session);

      if (!entity) {
        await session.abortTransaction();
        session.endSession();
        return apiResponse.notFound(
          res,
          "Entity Not Found",
          `The ${entityType} you are trying to use could not be found`,
          "ENTITY_NOT_FOUND"
        );
      }

      // Check if it's the user's own entity or another user's
      const isSelfEntity = entity.user.toString() === req.user._id.toString();

      // Set entity reference
      beneficiaryData.entityId = entityId;
      beneficiaryData.entityModel = EntityModel.modelName;
      beneficiaryData.entityType = entityType;
      beneficiaryData.entityOwner = entity.user;
      beneficiaryData.isSelfEntity = isSelfEntity;

      // For security reasons, set verification requirements for external entities
      if (!isSelfEntity) {
        beneficiaryData.verification = {
          isVerified: false,
          method: "none",
          verifiedAt: null,
          verifiedBy: null,
        };
        beneficiaryData.status = "pending"; // Require verification for non-self entities
      }

      // Pre-populate details based on entity
      if (entityType === "account" && !beneficiaryData.accountDetails) {
        beneficiaryData.accountDetails = {
          accountNumber: entity.accountNumber,
          routingNumber: entity.routingNumber,
          bank: entity.bank,
          accountType: entity.type || "checking",
        };
      } else if (entityType === "card" && !beneficiaryData.cardDetails) {
        beneficiaryData.cardDetails = {
          last4: entity.last4,
          brand: entity.brand,
          expiryMonth: entity.month,
          expiryYear: entity.year,
        };
      } else if (entityType === "wallet" && !beneficiaryData.walletDetails) {
        beneficiaryData.walletDetails = {
          address: entity.address,
          currency: entity.currency,
          walletType: entity.type || "fiat",
        };
      }
    }

    // Check for duplicate beneficiary
    const existingBeneficiary = await Beneficiary.findOne({
      user: req.user._id,
      ...(entityType !== "external" && entityId ? { entityId } : {}),
      ...(entityType === "external" && beneficiaryData.accountDetails
        ? {
            "accountDetails.accountNumber":
              beneficiaryData.accountDetails.accountNumber,
            "accountDetails.routingNumber":
              beneficiaryData.accountDetails.routingNumber,
          }
        : {}),
      ...(entityType === "wallet" && beneficiaryData.walletDetails
        ? {
            "walletDetails.address": beneficiaryData.walletDetails.address,
          }
        : {}),
    }).session(session);

    if (existingBeneficiary) {
      await session.abortTransaction();
      session.endSession();
      return apiResponse.badRequest(
        res,
        "Duplicate Beneficiary",
        "A beneficiary with these details already exists",
        "DUPLICATE_BENEFICIARY"
      );
    }

    // Create new beneficiary
    const beneficiary = await Beneficiary.create([beneficiaryData], {
      session,
    });

    // Add beneficiary ID to user's beneficiaries array
    await User.findByIdAndUpdate(
      req.user._id,
      { $addToSet: { beneficiaries: beneficiary[0]._id } },
      { session }
    );

    // Create notification for the user
    await notificationService.createNotification(
      req.user._id,
      "Beneficiary Added",
      `${
        beneficiaryData.name || "New beneficiary"
      } has been added to your account.`,
      "system",
      { beneficiaryId: beneficiary[0]._id },
      session
    );

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Beneficiary created successfully", {
      userId: req.user._id,
      beneficiaryId: beneficiary[0]._id,
      entityType,
      requestId: req.id,
    });

    return apiResponse.created(
      res,
      "Beneficiary Created",
      "Beneficiary has been created successfully",
      { beneficiary: beneficiary[0] }
    );
  } catch (error) {
    // Abort transaction on error
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }

    logger.error("Error creating beneficiary", {
      userId: req.user?._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    // Handle specific validation errors
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => ({
        field: err.path,
        message: err.message,
      }));

      return apiResponse.error(
        res,
        400,
        "Validation Error",
        "The beneficiary data failed validation",
        "VALIDATION_ERROR",
        errors
      );
    }

    // Handle other errors
    return apiResponse.error(
      res,
      500,
      "Creation Failed",
      "Failed to create beneficiary due to an internal error",
      "CREATION_FAILED"
    );
  }
};

/**
 * Get all beneficiaries for the current user
 * @route GET /api/beneficiaries
 */
exports.getAllBeneficiaries = async (req, res) => {
  try {
    // Extract query parameters
    const {
      entityType,
      favorite,
      status,
      verification,
      selfEntity,
      sort,
      limit = 20,
      page = 1,
      search,
    } = req.query;

    // Build query
    const query = {
      user: req.user._id,
      ...(entityType ? { entityType } : {}),
      ...(favorite === "true" ? { isFavorite: true } : {}),
      ...(status ? { status } : { status: "active" }), // Default to active
      ...(verification === "verified"
        ? { "verification.isVerified": true }
        : {}),
      ...(verification === "unverified"
        ? { "verification.isVerified": false }
        : {}),
      ...(selfEntity === "true" ? { isSelfEntity: true } : {}),
      ...(selfEntity === "false" ? { isSelfEntity: false } : {}),
    };

    // Add search functionality
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { nickname: { $regex: search, $options: "i" } },
      ];
    }

    // Build sort options
    let sortOptions = {};
    if (sort) {
      sortOptions = sort.split(",").reduce((acc, field) => {
        const direction = field.startsWith("-") ? -1 : 1;
        const fieldName = field.startsWith("-") ? field.substring(1) : field;
        acc[fieldName] = direction;
        return acc;
      }, {});
    } else {
      // Default sort: favorites first, then by rank, then by name
      sortOptions = { isFavorite: -1, rank: -1, name: 1 };
    }

    // Calculate pagination
    const skip = (page - 1) * parseInt(limit);
    const parsedLimit = parseInt(limit);

    // Execute query with pagination
    const beneficiaries = await Beneficiary.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(parsedLimit);

    // Get total count for pagination
    const total = await Beneficiary.countDocuments(query);

    const paginationMeta = apiResponse.paginationMeta(
      total,
      parseInt(page),
      parsedLimit,
      Math.ceil(total / parsedLimit)
    );

    logger.info("Beneficiaries retrieved successfully", {
      userId: req.user._id,
      count: beneficiaries.length,
      total,
      requestId: req.id,
    });

    return apiResponse.success(
      res,
      200,
      "Beneficiaries Retrieved",
      `Found ${beneficiaries.length} beneficiaries`,
      { beneficiaries },
      paginationMeta
    );
  } catch (error) {
    logger.error("Error retrieving beneficiaries", {
      userId: req.user?._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(
      res,
      500,
      "Retrieval Failed",
      "Failed to retrieve beneficiaries due to an internal error",
      "RETRIEVAL_FAILED"
    );
  }
};

/**
 * Get a single beneficiary by ID
 * @route GET /api/beneficiaries/:id
 */
exports.getBeneficiary = async (req, res) => {
  try {
    const beneficiaryId = req.params.id;

    // Input validation
    if (!beneficiaryId || !mongoose.Types.ObjectId.isValid(beneficiaryId)) {
      return apiResponse.badRequest(
        res,
        "Invalid ID",
        "The provided beneficiary ID is invalid",
        "INVALID_ID"
      );
    }

    const beneficiary = await Beneficiary.findOne({
      _id: beneficiaryId,
      user: req.user._id,
    });

    if (!beneficiary) {
      return apiResponse.notFound(
        res,
        "Beneficiary Not Found",
        "The requested beneficiary could not be found",
        "BENEFICIARY_NOT_FOUND"
      );
    }

    // If this is an internal entity, populate its details
    if (beneficiary.entityId && beneficiary.entityModel) {
      try {
        const EntityModel = mongoose.model(beneficiary.entityModel);
        const entity = await EntityModel.findById(beneficiary.entityId);

        if (entity) {
          // Only include non-sensitive data based on ownership
          if (beneficiary.isSelfEntity) {
            // Include all details for self entities
            beneficiary._doc.entity = entity;
          } else {
            // Include limited details for other users' entities
            beneficiary._doc.entity = {
              _id: entity._id,
              name: entity.name,
              type: entity.type,
              status: entity.status,
            };
          }
        }
      } catch (populateError) {
        logger.warn("Could not populate entity for beneficiary", {
          beneficiaryId: beneficiary._id,
          entityModel: beneficiary.entityModel,
          entityId: beneficiary.entityId,
          error: populateError.message,
          requestId: req.id,
        });
        // Continue without populating
      }
    }

    logger.info("Beneficiary retrieved successfully", {
      userId: req.user._id,
      beneficiaryId: beneficiary._id,
      requestId: req.id,
    });

    return apiResponse.success(
      res,
      200,
      "Beneficiary Retrieved",
      "Beneficiary details retrieved successfully",
      { beneficiary }
    );
  } catch (error) {
    logger.error("Error retrieving beneficiary", {
      userId: req.user?._id,
      beneficiaryId: req.params.id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(
      res,
      500,
      "Retrieval Failed",
      "Failed to retrieve beneficiary due to an internal error",
      "RETRIEVAL_FAILED"
    );
  }
};

/**
 * Update a beneficiary
 * @route PATCH /api/beneficiaries/:id
 */
exports.updateBeneficiary = async (req, res) => {
  let session = null;

  try {
    const beneficiaryId = req.params.id;

    // Input validation
    if (!beneficiaryId || !mongoose.Types.ObjectId.isValid(beneficiaryId)) {
      return apiResponse.badRequest(
        res,
        "Invalid ID",
        "The provided beneficiary ID is invalid",
        "INVALID_ID"
      );
    }

    session = await mongoose.startSession();
    session.startTransaction();

    // First, find the beneficiary to check ownership and current status
    const existingBeneficiary = await Beneficiary.findOne({
      _id: beneficiaryId,
      user: req.user._id,
    }).session(session);

    if (!existingBeneficiary) {
      await session.abortTransaction();
      session.endSession();
      return apiResponse.notFound(
        res,
        "Beneficiary Not Found",
        "The beneficiary you are trying to update could not be found",
        "BENEFICIARY_NOT_FOUND"
      );
    }

    // Restricted fields that cannot be updated
    const restrictedFields = [
      "user",
      "entityId",
      "entityModel",
      "entityType",
      "entityOwner",
      "isSelfEntity",
      "verification.isVerified",
      "verification.verifiedAt",
      "verification.verifiedBy",
    ];

    // Filter out restricted fields
    const filteredData = Object.keys(req.body)
      .filter((key) => {
        // Handle nested fields
        if (key.includes(".")) {
          const [parent, child] = key.split(".");
          return !restrictedFields.includes(`${parent}.${child}`);
        }
        return !restrictedFields.includes(key);
      })
      .reduce((obj, key) => {
        obj[key] = req.body[key];
        return obj;
      }, {});

    // Check if there's anything to update
    if (Object.keys(filteredData).length === 0) {
      await session.abortTransaction();
      session.endSession();
      return apiResponse.badRequest(
        res,
        "No Changes",
        "No valid fields to update were provided",
        "NO_CHANGES"
      );
    }

    // Update beneficiary
    const beneficiary = await Beneficiary.findOneAndUpdate(
      {
        _id: beneficiaryId,
        user: req.user._id,
      },
      filteredData,
      {
        new: true,
        runValidators: true,
        session,
      }
    );

    // Create notification for significant updates
    if (filteredData.name || filteredData.nickname || filteredData.status) {
      await notificationService.createNotification(
        req.user._id,
        "Beneficiary Updated",
        `Your beneficiary ${
          beneficiary.nickname || beneficiary.name
        } has been updated.`,
        "system",
        { beneficiaryId: beneficiary._id },
        session
      );
    }

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Beneficiary updated successfully", {
      userId: req.user._id,
      beneficiaryId: beneficiary._id,
      fields: Object.keys(filteredData),
      requestId: req.id,
    });

    return apiResponse.updated(
      res,
      "Beneficiary Updated",
      "Beneficiary has been updated successfully",
      { beneficiary }
    );
  } catch (error) {
    // Abort transaction on error
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }

    logger.error("Error updating beneficiary", {
      userId: req.user?._id,
      beneficiaryId: req.params.id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    // Handle validation errors
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => ({
        field: err.path,
        message: err.message,
      }));

      return apiResponse.error(
        res,
        400,
        "Validation Error",
        "The beneficiary data failed validation",
        "VALIDATION_ERROR",
        errors
      );
    }

    // Handle other errors
    return apiResponse.error(
      res,
      500,
      "Update Failed",
      "Failed to update beneficiary due to an internal error",
      "UPDATE_FAILED"
    );
  }
};

/**
 * Delete a beneficiary
 * @route DELETE /api/beneficiaries/:id
 */
exports.deleteBeneficiary = async (req, res) => {
  let session = null;

  try {
    const beneficiaryId = req.params.id;

    // Input validation
    if (!beneficiaryId || !mongoose.Types.ObjectId.isValid(beneficiaryId)) {
      return apiResponse.badRequest(
        res,
        "Invalid ID",
        "The provided beneficiary ID is invalid",
        "INVALID_ID"
      );
    }

    session = await mongoose.startSession();
    session.startTransaction();

    // Find beneficiary first to store name for notification
    const beneficiary = await Beneficiary.findOne({
      _id: beneficiaryId,
      user: req.user._id,
    }).session(session);

    if (!beneficiary) {
      await session.abortTransaction();
      session.endSession();
      return apiResponse.notFound(
        res,
        "Beneficiary Not Found",
        "The beneficiary you are trying to delete could not be found",
        "BENEFICIARY_NOT_FOUND"
      );
    }

    // Store beneficiary name for notification
    const beneficiaryName = beneficiary.nickname || beneficiary.name;

    // Delete the beneficiary
    await Beneficiary.findByIdAndDelete(beneficiary._id, { session });

    // Remove beneficiary ID from user's beneficiaries array
    await User.findByIdAndUpdate(
      req.user._id,
      { $pull: { beneficiaries: beneficiary._id } },
      { session }
    );

    // Create notification for deletion
    await notificationService.createNotification(
      req.user._id,
      "Beneficiary Removed",
      `Beneficiary "${beneficiaryName}" has been removed from your account.`,
      "system",
      { beneficiaryType: beneficiary.entityType },
      session
    );

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Beneficiary deleted successfully", {
      userId: req.user._id,
      beneficiaryId: beneficiary._id,
      beneficiaryName,
      requestId: req.id,
    });

    return apiResponse.deleted(
      res,
      "Beneficiary Deleted",
      "Beneficiary has been deleted successfully"
    );
  } catch (error) {
    // Abort transaction on error
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }

    logger.error("Error deleting beneficiary", {
      userId: req.user?._id,
      beneficiaryId: req.params.id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    // Handle error response
    return apiResponse.error(
      res,
      500,
      "Deletion Failed",
      "Failed to delete beneficiary due to an internal error",
      "DELETION_FAILED"
    );
  }
};

/**
 * Toggle favorite status
 * @route PATCH /api/beneficiaries/:id/favorite
 */
exports.toggleFavorite = async (req, res) => {
  let session = null;

  try {
    const beneficiaryId = req.params.id;

    // Input validation
    if (!beneficiaryId || !mongoose.Types.ObjectId.isValid(beneficiaryId)) {
      return apiResponse.badRequest(
        res,
        "Invalid ID",
        "The provided beneficiary ID is invalid",
        "INVALID_ID"
      );
    }

    session = await mongoose.startSession();
    session.startTransaction();

    // Find the beneficiary
    const beneficiary = await Beneficiary.findOne({
      _id: beneficiaryId,
      user: req.user._id,
    }).session(session);

    if (!beneficiary) {
      await session.abortTransaction();
      session.endSession();
      return apiResponse.notFound(
        res,
        "Beneficiary Not Found",
        "The beneficiary you are trying to modify could not be found",
        "BENEFICIARY_NOT_FOUND"
      );
    }

    // Toggle favorite status
    const result = await beneficiary.toggleFavorite();

    // If this operation involves adding to favorites, we might want to notify
    if (result.isFavorite) {
      await notificationService.createNotification(
        req.user._id,
        "Beneficiary Added to Favorites",
        `${
          beneficiary.nickname || beneficiary.name
        } has been added to your favorites.`,
        "system",
        { beneficiaryId: beneficiary._id },
        session
      );
    }

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Beneficiary favorite status toggled", {
      userId: req.user._id,
      beneficiaryId: beneficiary._id,
      isFavorite: result.isFavorite,
      requestId: req.id,
    });

    return apiResponse.updated(
      res,
      "Favorite Status Updated",
      `Beneficiary has been ${
        result.isFavorite ? "added to" : "removed from"
      } favorites`,
      {
        beneficiary,
        isFavorite: result.isFavorite,
      }
    );
  } catch (error) {
    // Abort transaction on error
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }

    logger.error("Error toggling beneficiary favorite", {
      userId: req.user?._id,
      beneficiaryId: req.params.id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    // Handle error response
    return apiResponse.error(
      res,
      500,
      "Favorite Toggle Failed",
      "Failed to update favorite status due to an internal error",
      "FAVORITE_TOGGLE_FAILED"
    );
  }
};

/**
 * Verify a beneficiary
 * @route PATCH /api/beneficiaries/:id/verify
 */
exports.verifyBeneficiary = async (req, res) => {
  let session = null;

  try {
    const beneficiaryId = req.params.id;

    // Input validation
    if (!beneficiaryId || !mongoose.Types.ObjectId.isValid(beneficiaryId)) {
      return apiResponse.badRequest(
        res,
        "Invalid ID",
        "The provided beneficiary ID is invalid",
        "INVALID_ID"
      );
    }

    session = await mongoose.startSession();
    session.startTransaction();

    const { verificationCode, method = "manual" } = req.body;

    // Find the beneficiary
    const beneficiary = await Beneficiary.findOne({
      _id: beneficiaryId,
      user: req.user._id,
    }).session(session);

    if (!beneficiary) {
      await session.abortTransaction();
      session.endSession();
      return apiResponse.notFound(
        res,
        "Beneficiary Not Found",
        "The beneficiary you are trying to verify could not be found",
        "BENEFICIARY_NOT_FOUND"
      );
    }

    // Skip verification for self beneficiaries
    if (beneficiary.isSelfEntity) {
      await session.abortTransaction();
      session.endSession();
      return apiResponse.badRequest(
        res,
        "Verification Not Required",
        "Self beneficiaries do not require verification",
        "VERIFICATION_NOT_REQUIRED"
      );
    }

    // If already verified
    if (beneficiary.verification.isVerified) {
      await session.abortTransaction();
      session.endSession();
      return apiResponse.badRequest(
        res,
        "Already Verified",
        "This beneficiary has already been verified",
        "ALREADY_VERIFIED"
      );
    }

    // In a real system, we would verify the verification code here
    // For now, we'll just mark it as verified

    // Perform verification
    const result = await beneficiary.verify(method, req.user._id);

    // Update status to active if it was pending
    if (beneficiary.status === "pending") {
      beneficiary.status = "active";
      await beneficiary.save({ session });
    }

    // Create notification for verification
    await notificationService.createNotification(
      req.user._id,
      "Beneficiary Verified",
      `${
        beneficiary.nickname || beneficiary.name
      } has been verified and is now ready for use.`,
      "system",
      { beneficiaryId: beneficiary._id },
      session
    );

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Beneficiary verified successfully", {
      userId: req.user._id,
      beneficiaryId: beneficiary._id,
      method,
      requestId: req.id,
    });

    return apiResponse.updated(
      res,
      "Beneficiary Verified",
      "Beneficiary has been successfully verified and can now be used for transactions",
      { beneficiary }
    );
  } catch (error) {
    // Abort transaction on error
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }

    logger.error("Error verifying beneficiary", {
      userId: req.user?._id,
      beneficiaryId: req.params.id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    // Handle error response
    return apiResponse.error(
      res,
      500,
      "Verification Failed",
      "Failed to verify beneficiary due to an internal error",
      "VERIFICATION_FAILED"
    );
  }
};

/**
 * Create beneficiary from an existing entity (account, card, wallet)
 * @route POST /api/beneficiaries/from-entity
 */
exports.createFromEntity = async (req, res) => {
  let session = null;

  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const { entityType, entityId, nickname } = req.body;

    // Input validation
    if (!entityType || !entityId) {
      await session.abortTransaction();
      session.endSession();
      return apiResponse.badRequest(
        res,
        "Missing Parameters",
        "Entity type and ID are required",
        "MISSING_PARAMETERS"
      );
    }

    if (!mongoose.Types.ObjectId.isValid(entityId)) {
      await session.abortTransaction();
      session.endSession();
      return apiResponse.badRequest(
        res,
        "Invalid Entity ID",
        "The provided entity ID is not valid",
        "INVALID_ENTITY_ID"
      );
    }

    const EntityModel = getEntityModel(entityType);
    if (!EntityModel) {
      await session.abortTransaction();
      session.endSession();
      return apiResponse.badRequest(
        res,
        "Invalid Entity Type",
        `${entityType} is not a valid entity type`,
        "INVALID_ENTITY_TYPE"
      );
    }

    // Find the entity without restricting to user ownership
    const entity = await EntityModel.findOne({
      _id: entityId,
    }).session(session);

    if (!entity) {
      await session.abortTransaction();
      session.endSession();
      return apiResponse.notFound(
        res,
        "Entity Not Found",
        `The ${entityType} you are trying to use could not be found`,
        "ENTITY_NOT_FOUND"
      );
    }

    // Check if it's the user's own entity or another user's
    const isSelfEntity = entity.user.toString() === req.user._id.toString();

    // Check if beneficiary already exists
    const existingBeneficiary = await Beneficiary.findOne({
      user: req.user._id,
      entityId: entity._id,
      entityType: entityType,
    }).session(session);

    if (existingBeneficiary) {
      await session.abortTransaction();
      session.endSession();
      return apiResponse.badRequest(
        res,
        "Duplicate Beneficiary",
        `A beneficiary for this ${entityType} already exists`,
        "DUPLICATE_BENEFICIARY"
      );
    }

    // Create the beneficiary
    const beneficiaryData = {
      user: req.user._id,
      name: entity.name,
      nickname: nickname || entity.name,
      entityType: entityType,
      entityId: entity._id,
      entityModel: EntityModel.modelName,
      entityOwner: entity.user,
      isSelfEntity: isSelfEntity,
      status: isSelfEntity ? "active" : "pending", // Set status based on ownership
    };

    // For security reasons, set verification requirements for external entities
    if (!isSelfEntity) {
      beneficiaryData.verification = {
        isVerified: false,
        method: "none",
        verifiedAt: null,
        verifiedBy: null,
      };
    }

    // Add type-specific details
    if (entityType === "account") {
      beneficiaryData.accountDetails = {
        accountNumber: entity.accountNumber,
        routingNumber: entity.routingNumber,
        bank: entity.bank,
        accountType: entity.type || "checking",
      };
    } else if (entityType === "card") {
      beneficiaryData.cardDetails = {
        last4: entity.last4,
        brand: entity.brand,
        expiryMonth: entity.month,
        expiryYear: entity.year,
      };
    } else if (entityType === "wallet") {
      beneficiaryData.walletDetails = {
        address: entity.address,
        currency: entity.currency,
        walletType: entity.type || "fiat",
      };
    }

    // Add common fields if available
    if (entity.email) beneficiaryData.email = entity.email;
    if (entity.phone) beneficiaryData.phone = entity.phone;

    // Create the beneficiary
    const beneficiary = await Beneficiary.create([beneficiaryData], {
      session,
    });

    // Add beneficiary ID to user's beneficiaries array
    await User.findByIdAndUpdate(
      req.user._id,
      { $addToSet: { beneficiaries: beneficiary[0]._id } },
      { session }
    );

    // Create notification
    await notificationService.createNotification(
      req.user._id,
      "Beneficiary Created",
      `${
        beneficiary[0].nickname || beneficiary[0].name
      } has been added to your beneficiaries.`,
      "system",
      {
        beneficiaryId: beneficiary[0]._id,
        entityType: entityType,
        requiresVerification: !isSelfEntity,
      },
      session
    );

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Beneficiary created from entity", {
      userId: req.user._id,
      beneficiaryId: beneficiary[0]._id,
      entityType,
      entityId,
      isSelfEntity,
      requestId: req.id,
    });

    return apiResponse.created(
      res,
      "Beneficiary Created",
      `Beneficiary created successfully from ${entityType}`,
      {
        beneficiary: beneficiary[0],
        requiresVerification: !isSelfEntity,
      }
    );
  } catch (error) {
    // Abort transaction on error
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }

    logger.error("Error creating beneficiary from entity", {
      userId: req.user?._id,
      entityData: req.body,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    // Handle specific validation errors
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => ({
        field: err.path,
        message: err.message,
      }));

      return apiResponse.error(
        res,
        400,
        "Validation Error",
        "The beneficiary data failed validation",
        "VALIDATION_ERROR",
        errors
      );
    }

    // Handle other errors
    return apiResponse.error(
      res,
      500,
      "Creation Failed",
      "Failed to create beneficiary from entity due to an internal error",
      "ENTITY_CREATION_FAILED"
    );
  }
};

/**
 * Get recently used beneficiaries
 * @route GET /api/beneficiaries/recent
 */
exports.getRecentBeneficiaries = async (req, res) => {
  try {
    const { limit = 5, verified = "true", days = 30 } = req.query;
    const parsedLimit = parseInt(limit);
    const parsedDays = parseInt(days);

    // Validate params
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
      return apiResponse.badRequest(
        res,
        "Invalid Parameter",
        "Limit must be a number between 1 and 50",
        "INVALID_LIMIT"
      );
    }

    if (isNaN(parsedDays) || parsedDays < 1 || parsedDays > 365) {
      return apiResponse.badRequest(
        res,
        "Invalid Parameter",
        "Days must be a number between 1 and 365",
        "INVALID_DAYS"
      );
    }

    // Calculate date threshold (e.g., within last 30 days)
    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - parsedDays);

    // Build match criteria
    const matchCriteria = {
      user: mongoose.Types.ObjectId(req.user._id),
      status: "active",
    };

    // Only include verified beneficiaries if requested
    if (verified === "true") {
      matchCriteria.$or = [
        { isSelfEntity: true },
        { "verification.isVerified": true },
      ];
    }

    // Get beneficiaries with recent transactions, ordered by most recent
    const recentBeneficiaries = await Beneficiary.aggregate([
      // Match only user's active beneficiaries
      { $match: matchCriteria },
      // Look up recent transactions
      {
        $lookup: {
          from: "transactions",
          let: { beneficiaryId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$beneficiary", "$$beneficiaryId"] },
                    { $gte: ["$createdAt", dateThreshold] },
                  ],
                },
              },
            },
            { $sort: { createdAt: -1 } },
            { $limit: 5 }, // Limit to most recent transactions per beneficiary
          ],
          as: "transactions",
        },
      },
      // Filter out beneficiaries with no transactions
      {
        $match: {
          "transactions.0": { $exists: true },
        },
      },
      // Add a field with the most recent transaction date
      {
        $addFields: {
          lastUsed: { $max: "$transactions.createdAt" },
          transactionCount: { $size: "$transactions" },
        },
      },
      // Sort by most recent first
      {
        $sort: {
          lastUsed: -1,
          transactionCount: -1,
          isFavorite: -1,
        },
      },
      // Limit results
      {
        $limit: parsedLimit,
      },
      // Shape the output to include relevant fields
      {
        $project: {
          _id: 1,
          name: 1,
          nickname: 1,
          entityType: 1,
          isFavorite: 1,
          status: 1,
          lastUsed: 1,
          transactionCount: 1,
          accountDetails: 1,
          walletDetails: 1,
          cardDetails: 1,
          "verification.isVerified": 1,
          // Include only the most recent transaction date
          lastTransaction: { $arrayElemAt: ["$transactions", 0] },
          // Remove full transactions array
          transactions: 0,
        },
      },
    ]);

    logger.info("Recent beneficiaries retrieved", {
      userId: req.user._id,
      count: recentBeneficiaries.length,
      days: parsedDays,
      requestId: req.id,
    });

    return apiResponse.success(
      res,
      200,
      "Recent Beneficiaries Retrieved",
      `Found ${recentBeneficiaries.length} recently used beneficiaries`,
      {
        beneficiaries: recentBeneficiaries,
        timeFrame: `${parsedDays} days`,
      }
    );
  } catch (error) {
    logger.error("Error retrieving recent beneficiaries", {
      userId: req.user?._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(
      res,
      500,
      "Retrieval Failed",
      "Failed to retrieve recent beneficiaries due to an internal error",
      "RECENT_RETRIEVAL_FAILED"
    );
  }
};
