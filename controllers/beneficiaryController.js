const mongoose = require("mongoose");
const Beneficiary = require("../models/Beneficiary");
const Account = require("../models/Account");
const Card = require("../models/Card");
const Wallet = require("../models/Wallet");
const User = require("../models/User");
const { logger } = require("../config/logger");
const apiResponse = require("../utils/apiResponse");

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

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

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
    const skip = (page - 1) * limit;

    // Execute query with pagination
    const beneficiaries = await Beneficiary.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const total = await Beneficiary.countDocuments(query);

    const paginationMeta = apiResponse.paginationMeta(
      total,
      parseInt(page),
      parseInt(limit),
      Math.ceil(total / limit)
    );

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
    const beneficiary = await Beneficiary.findOne({
      _id: req.params.id,
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
        });
        // Continue without populating
      }
    }

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
    session = await mongoose.startSession();
    session.startTransaction();

    // First, find the beneficiary to check ownership and current status
    const existingBeneficiary = await Beneficiary.findOne({
      _id: req.params.id,
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

    // Update beneficiary
    const beneficiary = await Beneficiary.findOneAndUpdate(
      {
        _id: req.params.id,
        user: req.user._id,
      },
      filteredData,
      {
        new: true,
        runValidators: true,
        session,
      }
    );

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

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
    session = await mongoose.startSession();
    session.startTransaction();

    // Find and delete beneficiary
    const beneficiary = await Beneficiary.findOneAndDelete(
      {
        _id: req.params.id,
        user: req.user._id,
      },
      { session }
    );

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

    // Remove beneficiary ID from user's beneficiaries array
    await User.findByIdAndUpdate(
      req.user._id,
      { $pull: { beneficiaries: beneficiary._id } },
      { session }
    );

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

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
    session = await mongoose.startSession();
    session.startTransaction();

    // Find the beneficiary
    const beneficiary = await Beneficiary.findOne({
      _id: req.params.id,
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

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

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
    session = await mongoose.startSession();
    session.startTransaction();

    const { verificationCode, method = "manual" } = req.body;

    // Find the beneficiary
    const beneficiary = await Beneficiary.findOne({
      _id: req.params.id,
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

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

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
    };

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

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

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
    const { limit = 5, verified = "true" } = req.query;

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
          localField: "_id",
          foreignField: "beneficiary",
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
        },
      },
      // Sort by most recent first
      {
        $sort: {
          lastUsed: -1,
        },
      },
      // Limit results
      {
        $limit: parseInt(limit),
      },
      // Remove the transactions array to keep response size down
      {
        $project: {
          transactions: 0,
        },
      },
    ]);

    return apiResponse.success(
      res,
      200,
      "Recent Beneficiaries Retrieved",
      `Found ${recentBeneficiaries.length} recently used beneficiaries`,
      { beneficiaries: recentBeneficiaries }
    );
  } catch (error) {
    logger.error("Error retrieving recent beneficiaries", {
      userId: req.user?._id,
      error: error.message,
      stack: error.stack,
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
