const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const ms = require("ms");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const User = require("../models/User");
const NameChange = require("../models/NameChange");
const EmailChange = require("../models/EmailChange");
const PhoneChange = require("../models/PhoneChange");
const AddressChange = require("../models/AddressChange");
const { logger } = require("../config/logger");
const apiResponse = require("../utils/apiResponse");
const config = require("../config/config");
const {
  sendEmailChangeVerification,
  sendEmailChangeConfirmation,
  sendSecurityAlert,
  sendEmailChangeRejection,
} = require("../services/emailService");
const notificationService = require("../services/notificationService");

const profileUtils = {
  /**
   * Start a MongoDB transaction session
   * @param {string} userId - User ID
   * @param {string} requestId - Request ID
   * @returns {Promise<Object>} Session object and sessionActive flag
   */
  startSession: async (userId, requestId) => {
    logger.debug("Starting MongoDB transaction", { userId, requestId });
    const session = await mongoose.startSession();
    session.startTransaction();
    return { session, sessionActive: true };
  },

  /**
   * End a MongoDB transaction session (commit or abort)
   * @param {Object} session - MongoDB session
   * @param {boolean} sessionActive - Flag indicating if session is active
   * @param {boolean} success - Whether to commit or abort the transaction
   * @param {string} requestId - Request ID
   */
  endSession: async (session, sessionActive, success, requestId) => {
    if (sessionActive) {
      try {
        if (success) {
          await session.commitTransaction();
          logger.debug("Transaction committed successfully", { requestId });
        } else {
          await session.abortTransaction();
          logger.debug("Transaction aborted", { requestId });
        }
        session.endSession();
      } catch (sessionError) {
        logger.error("Error ending transaction", {
          requestId,
          error: sessionError.message,
        });
        // Try to abort if commit failed
        if (success) {
          try {
            await session.abortTransaction();
            session.endSession();
          } catch (error) {
            logger.error("Error aborting transaction after failed commit", {
              requestId,
              error: error.message,
            });
          }
        }
      }
    }
  },

  /**
   * Find user by ID using session
   * @param {string} userId - User ID
   * @param {Object} session - MongoDB session
   * @param {string} requestId - Request ID
   * @returns {Promise<Object>} User document or null
   */
  findUserById: async (userId, session, requestId) => {
    try {
      const user = await User.findById(userId).session(session);
      if (!user) {
        logger.warn("User not found", { userId, requestId });
      }
      return user;
    } catch (error) {
      logger.error("Error finding user", {
        userId,
        requestId,
        error: error.message,
      });
      return null;
    }
  },

  /**
   * Verify required ID images are present
   * @param {Object} cloudinaryFiles - Uploaded files
   * @param {boolean} requireProofOfAddress - Whether to require proof of address
   * @returns {boolean} True if all required files are present
   */
  verifyRequiredImages: (cloudinaryFiles, requireProofOfAddress = false) => {
    if (!cloudinaryFiles) return false;

    const hasIdImages =
      cloudinaryFiles.frontIdImage && cloudinaryFiles.backIdImage;

    if (requireProofOfAddress) {
      return hasIdImages && cloudinaryFiles.proofOfAddressImage;
    }

    return hasIdImages;
  },

  /**
   * Handle operation start logging
   * @param {string} operationType - Type of operation being performed
   * @param {Object} req - Express request object
   * @returns {Object} Operation metadata including start time
   */
  logOperationStart: (operationType, req) => {
    const requestStartTime = Date.now();
    const requestId = req.id;
    const userId = req.user?._id;

    logger.info(`${operationType} operation started`, {
      userId,
      requestId,
      endpoint: `${req.method} ${req.originalUrl}`,
      fieldsToUpdate: Object.keys(req.body).join(", "),
      hasVerificationFiles: req.cloudinaryFiles
        ? Object.keys(req.cloudinaryFiles).length > 0
        : false,
    });

    return { requestStartTime, requestId, userId };
  },

  /**
   * Log operation completion
   * @param {string} operationType - Type of operation performed
   * @param {Object} metadata - Operation metadata
   * @param {Object} additionalInfo - Additional information to log
   */
  logOperationComplete: (
    operationType,
    { requestStartTime, requestId, userId },
    additionalInfo = {}
  ) => {
    const processingTime = Date.now() - requestStartTime;
    logger.info(`${operationType} completed successfully`, {
      userId,
      requestId,
      processingTime: `${processingTime}ms`,
      ...additionalInfo,
    });
  },

  /**
   * Handle operation error
   * @param {string} operationType - Type of operation being performed
   * @param {Error} error - Error object
   * @param {Object} metadata - Operation metadata
   * @param {Object} session - MongoDB session
   * @param {boolean} sessionActive - Flag indicating if session is active
   * @param {Object} res - Express response object
   * @returns {Object} Error response
   */
  handleOperationError: async (
    operationType,
    error,
    { requestStartTime, requestId, userId },
    session,
    sessionActive,
    res
  ) => {
    logger.error(`${operationType} critical error`, {
      userId,
      requestId,
      error: error.message,
      stack: error.stack,
      errorName: error.name,
      errorCode: error.code,
      processingTime: `${Date.now() - requestStartTime}ms`,
    });

    // Ensure transaction is aborted if still active
    await profileUtils.endSession(session, sessionActive, false, requestId);

    return apiResponse.error(res, 500, `Error during ${operationType}`, {
      errorId: requestId,
    });
  },
};

/**
 * Update account transfer limits
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updateExpoPushToken = async (req, res) => {
  const metadata = profileUtils.logOperationStart(
    "Expo Push Token Update",
    req
  );
  const { requestId, userId } = metadata;

  let sessionActive = false;
  let session;

  try {
    // Start transaction
    ({ session, sessionActive } = await profileUtils.startSession(
      userId,
      requestId
    ));

    // Extract data from request body
    const { expoPushToken } = req.body;

    if (!expoPushToken) {
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Push token is required"
      );
    }

    await User.findByIdAndUpdate(userId, {
      expoPushToken: expoPushToken,
      updatedAt: new Date(),
    });

    // res.status(200).json({ message: "Push token saved successfully" });

    // Commit transaction
    await profileUtils.endSession(session, sessionActive, true, requestId);
    sessionActive = false;

    profileUtils.logOperationComplete("Expo Push Token Update", metadata, {
      userId,
    });

    return apiResponse.success(
      res,
      200,
      "Push token saved successfully!",
      "Your push token has been updated",
      {}
    );
  } catch (error) {
    return profileUtils.handleOperationError(
      "Push token update",
      error,
      metadata,
      session,
      sessionActive,
      res
    );
  }
};

/**
 * Update basic profile fields that don't require verification
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updateProfile = async (req, res) => {
  const metadata = profileUtils.logOperationStart("Profile update", req);
  const { requestId, userId } = metadata;

  let sessionActive = false;
  let session;

  try {
    // Start transaction
    ({ session, sessionActive } = await profileUtils.startSession(
      userId,
      requestId
    ));

    // Find current user
    const currentUser = await profileUtils.findUserById(
      userId,
      session,
      requestId
    );
    if (!currentUser) {
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.notFound(res, "User not found");
    }

    // Only handle basic profile updates here (no verification required)
    // Extract non-sensitive fields from request body
    const {
      // Exclude fields that require special verification
      firstName,
      lastName,
      email,
      phone,
      address,
      // Other basic profile fields that don't require verification
      preferences,
      settings,
      language,
      timezone,
      theme,
    } = req.body;

    // Check if sensitive updates are being requested
    if (firstName !== undefined || lastName !== undefined) {
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Name changes must be requested through the dedicated updateName endpoint"
      );
    }

    if (email !== undefined && email !== currentUser.email) {
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Email changes must be requested through the dedicated updateEmail endpoint"
      );
    }

    if (phone !== undefined && phone !== currentUser.phone) {
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Phone changes must be requested through the dedicated updatePhone endpoint"
      );
    }

    if (address !== undefined) {
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Address changes must be requested through the dedicated updateAddress endpoint"
      );
    }

    // Prepare update data object based on provided fields
    const updateData = {};
    const updateLog = [];

    // Handle basic preference updates
    if (preferences !== undefined) {
      updateData.preferences = preferences;
      updateLog.push("preferences");
    }

    if (settings !== undefined) {
      updateData.settings = settings;
      updateLog.push("settings");
    }

    if (language !== undefined) {
      updateData.language = language;
      updateLog.push("language");
    }

    if (timezone !== undefined) {
      updateData.timezone = timezone;
      updateLog.push("timezone");
    }

    if (theme !== undefined) {
      updateData.theme = theme;
      updateLog.push("theme");
    }

    // Update user if there are changes
    if (Object.keys(updateData).length > 0) {
      logger.debug("Updating user profile fields", {
        userId,
        requestId,
        fieldsToUpdate: Object.keys(updateData).join(", "),
      });

      await User.findByIdAndUpdate(userId, updateData, { session });
    } else {
      logger.debug("No fields to update", { userId, requestId });
    }

    // Commit the transaction
    await profileUtils.endSession(session, sessionActive, true, requestId);
    sessionActive = false;

    profileUtils.logOperationComplete("Profile update", metadata, {
      updatedFields: updateLog.join(", "),
    });

    return apiResponse.success(
      res,
      200,
      "Update successful!",
      "Profile Updated Successfully",
      { updatedFields: updateLog }
    );
  } catch (error) {
    return profileUtils.handleOperationError(
      "Profile update",
      error,
      metadata,
      session,
      sessionActive,
      res
    );
  }
};

/**
 * Request email change with verification
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updateEmail = async (req, res) => {
  // console.log("ggg", req.body);
  const metadata = profileUtils.logOperationStart("Email update", req);
  const { requestId, userId } = metadata;

  let sessionActive = false;
  let session;

  try {
    // Start transaction
    ({ session, sessionActive } = await profileUtils.startSession(
      userId,
      requestId
    ));

    // Extract email from request body
    const { email } = req.body;

    if (!email) {
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.badRequest(res, "Bad Request", "Email is required");
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.badRequest(res, "Bad Request", "Invalid email format");
    }

    // Find current user
    const currentUser = await profileUtils.findUserById(
      userId,
      session,
      requestId
    );
    if (!currentUser) {
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.notFound(res, "User not found");
    }

    // Check if email is actually changing
    const isEmailChangeRequested = email !== currentUser.email;
    if (!isEmailChangeRequested) {
      logger.debug("Email unchanged, skipping verification process", {
        userId,
        requestId,
      });

      await profileUtils.endSession(session, sessionActive, true, requestId);
      sessionActive = false;

      profileUtils.logOperationComplete("Email update", metadata, {
        status: "unchanged",
      });

      return apiResponse.success(
        res,
        200,
        "Email updated successfully",
        "Your email remains unchanged",
        { status: "unchanged" }
      );
    }

    logger.debug("Email change requested", {
      userId,
      requestId,
      currentEmail: currentUser.email,
      requestedEmail: email,
    });

    // Verify the requested email is not already in use
    const existingUser = await User.findOne({ email }).session(session);
    if (existingUser && existingUser._id.toString() !== userId.toString()) {
      logger.warn("Email already in use", {
        userId,
        requestId,
        requestedEmail: email,
      });
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Email address is already in use"
      );
    }

    // Generate verification code
    const verificationCode = Math.floor(
      100000 + Math.random() * 900000
    ).toString();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Create email change request
    const emailChange = new EmailChange({
      userId,
      currentEmail: currentUser.email,
      requestedEmail: email,
      verificationCode,
      verificationExpires,
      status: "pending_verification",
      requestDate: new Date(),
    });

    await emailChange.save({ session });

    logger.debug("Email change request created", {
      userId,
      requestId,
      emailChangeId: emailChange._id,
    });

    // Send verification email using Brevo email service
    try {
      await sendEmailChangeVerification({
        to: email,
        name: `${currentUser.firstName} ${currentUser.lastName}`,
        verificationCode,
        requestId,
      });

      logger.debug("Email change verification sent", {
        userId,
        requestId,
        emailChangeId: emailChange._id,
        sentTo: email,
      });
    } catch (emailError) {
      logger.error("Failed to send email verification", {
        userId,
        requestId,
        error: emailError.message,
      });
      // Continue with the transaction, user can request resend later
    }

    // Commit transaction
    await profileUtils.endSession(session, sessionActive, true, requestId);
    sessionActive = false;

    profileUtils.logOperationComplete("Email update", metadata, {
      emailChangeId: emailChange._id,
      status: "pending_verification",
    });

    // Return success response
    return apiResponse.success(
      res,
      200,
      "Email change request submitted successfully",
      "Your email change request requires verification. Please check your new email inbox.",
      {
        emailChangeId: emailChange._id,
        status: "pending_verification",
        message:
          "Your email change request requires verification. Please check your new email inbox.",
      }
    );
  } catch (error) {
    return profileUtils.handleOperationError(
      "Email update",
      error,
      metadata,
      session,
      sessionActive,
      res
    );
  }
};

/**
 * Request name change with verification
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updateName = async (req, res) => {
  const metadata = profileUtils.logOperationStart("Name update", req);
  const { requestId, userId } = metadata;

  let sessionActive = false;
  let session;

  try {
    // Start transaction
    ({ session, sessionActive } = await profileUtils.startSession(
      userId,
      requestId
    ));

    // Extract name fields from request body
    const { firstName, lastName } = req.body;

    if (!firstName && !lastName) {
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "At least one of firstName or lastName must be provided"
      );
    }

    // Find current user
    const currentUser = await profileUtils.findUserById(
      userId,
      session,
      requestId
    );
    if (!currentUser) {
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.notFound(res, "User not found");
    }

    // Determine new name values
    const newFirstName =
      firstName !== undefined ? firstName : currentUser.firstName;
    const newLastName =
      lastName !== undefined ? lastName : currentUser.lastName;
    const currentFirstName = currentUser.firstName;
    const currentLastName = currentUser.lastName;

    // Check if name is actually changing
    const isNameChanging =
      newFirstName !== currentFirstName || newLastName !== currentLastName;

    if (!isNameChanging) {
      logger.debug("Name unchanged, skipping verification process", {
        userId,
        requestId,
      });

      await profileUtils.endSession(session, sessionActive, true, requestId);
      sessionActive = false;

      profileUtils.logOperationComplete("Name update", metadata, {
        status: "unchanged",
      });

      return apiResponse.success(
        res,
        200,
        "Name updated successfully",
        "Your name remains unchanged",
        { status: "unchanged" }
      );
    }

    logger.debug("Name change requested", {
      userId,
      requestId,
      currentName: `${currentFirstName} ${currentLastName}`,
      requestedName: `${newFirstName} ${newLastName}`,
    });

    // Check if ID verification images are provided for name change
    if (!profileUtils.verifyRequiredImages(req.cloudinaryFiles)) {
      logger.warn("Missing verification images for name change", {
        userId,
        requestId,
      });
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "ID verification images (front and back) are required for name changes"
      );
    }

    // Create name change request
    const nameChange = new NameChange({
      userId,
      currentFirstName,
      currentLastName,
      requestedFirstName: newFirstName,
      requestedLastName: newLastName,
      frontIdUrl: req.cloudinaryFiles.frontIdImage.secure_url,
      frontIdPublicId: req.cloudinaryFiles.frontIdImage.public_id,
      backIdUrl: req.cloudinaryFiles.backIdImage.secure_url,
      backIdPublicId: req.cloudinaryFiles.backIdImage.public_id,
      status: "pending_review",
      requestDate: new Date(),
    });

    await nameChange.save({ session });

    logger.debug("Name change request created", {
      userId,
      requestId,
      nameChangeId: nameChange._id,
    });

    // Commit transaction
    await profileUtils.endSession(session, sessionActive, true, requestId);
    sessionActive = false;

    profileUtils.logOperationComplete("Name update", metadata, {
      nameChangeId: nameChange._id,
      status: "pending_review",
    });

    // Return success response
    return apiResponse.success(
      res,
      200,
      "Name change request submitted successfully",
      "Your name change request is pending verification",
      {
        nameChangeId: nameChange._id,
        status: "pending_review",
        message: "Your name change request is pending verification",
      }
    );
  } catch (error) {
    return profileUtils.handleOperationError(
      "Name update",
      error,
      metadata,
      session,
      sessionActive,
      res
    );
  }
};

/**
 * Update user address with verification
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updateAddress = async (req, res) => {
  const metadata = profileUtils.logOperationStart("Address update", req);
  const { requestId, userId } = metadata;

  let sessionActive = false;
  let session;

  try {
    // Start transaction
    ({ session, sessionActive } = await profileUtils.startSession(
      userId,
      requestId
    ));

    // Extract address data from request body
    const { address } = req.body;
    let addressData;

    try {
      // Handle both string JSON and object formats
      addressData = typeof address === "string" ? JSON.parse(address) : address;
    } catch (error) {
      logger.warn("Invalid address data format", {
        userId,
        requestId,
        error: error.message,
      });
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Invalid address data format"
      );
    }

    // Validate required address fields
    if (
      !addressData ||
      !addressData.street ||
      !addressData.city ||
      !addressData.state ||
      !addressData.zipCode
    ) {
      logger.warn("Missing required address fields", {
        userId,
        requestId,
        providedFields: Object.keys(addressData || {}).join(", "),
      });

      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Address must include street, city, state, and zipCode"
      );
    }

    // Find current user
    const currentUser = await profileUtils.findUserById(
      userId,
      session,
      requestId
    );
    if (!currentUser) {
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.notFound(res, "User not found");
    }

    // Check if address is actually changing
    const currentAddress = currentUser.address || {};
    const isAddressChanging =
      addressData.street !== currentAddress.street1 ||
      addressData.city !== currentAddress.city ||
      addressData.state !== currentAddress.state ||
      addressData.zipCode !== currentAddress.zipCode ||
      (addressData.country && addressData.country !== currentAddress.country);

    if (!isAddressChanging) {
      logger.debug("Address unchanged, skipping verification process", {
        userId,
        requestId,
      });

      // Update with the same address (no verification needed)
      await User.findByIdAndUpdate(
        userId,
        {
          address: {
            street1: addressData.street,
            street2: addressData.street2 || "",
            city: addressData.city,
            state: addressData.state,
            zipCode: addressData.zipCode,
            country: addressData.country || "US",
          },
        },
        { session }
      );

      await profileUtils.endSession(session, sessionActive, true, requestId);
      sessionActive = false;

      profileUtils.logOperationComplete("Address update", metadata, {
        status: "unchanged",
      });

      return apiResponse.success(
        res,
        200,
        "Address updated successfully",
        "Your address has been updated",
        { status: "completed" }
      );
    }

    // For address changes, require proof of address verification
    if (!profileUtils.verifyRequiredImages(req.cloudinaryFiles, true)) {
      logger.warn("Missing verification images for address change", {
        userId,
        requestId,
      });
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "ID verification images (front and back) and proof of address are required for address changes"
      );
    }

    // Create address change request
    const addressChange = new AddressChange({
      userId,
      // Current address
      currentStreet1: currentAddress.street1 || "",
      currentStreet2: currentAddress.street2 || "",
      currentCity: currentAddress.city || "",
      currentState: currentAddress.state || "",
      currentZipCode: currentAddress.zipCode || "",
      currentCountry: currentAddress.country || "US",
      // Requested address
      requestedStreet1: addressData.street,
      requestedStreet2: addressData.street2 || "",
      requestedCity: addressData.city,
      requestedState: addressData.state,
      requestedZipCode: addressData.zipCode,
      requestedCountry: addressData.country || "US",
      // Verification images
      frontIdUrl: req.cloudinaryFiles.frontIdImage.secure_url,
      frontIdPublicId: req.cloudinaryFiles.frontIdImage.public_id,
      backIdUrl: req.cloudinaryFiles.backIdImage.secure_url,
      backIdPublicId: req.cloudinaryFiles.backIdImage.public_id,
      proofOfAddressUrl: req.cloudinaryFiles.proofOfAddressImage.secure_url,
      proofOfAddressPublicId: req.cloudinaryFiles.proofOfAddressImage.public_id,
      // Status
      status: "pending_review",
      requestDate: new Date(),
    });

    await addressChange.save({ session });

    logger.debug("Address change request created", {
      userId,
      requestId,
      addressChangeId: addressChange._id,
    });

    // Commit transaction
    await profileUtils.endSession(session, sessionActive, true, requestId);
    sessionActive = false;

    profileUtils.logOperationComplete("Address update", metadata, {
      addressChangeId: addressChange._id,
      status: "pending_review",
    });

    // Return success response
    return apiResponse.success(
      res,
      200,
      "Address change request submitted successfully",
      "Your address change request is pending verification",
      {
        addressChangeId: addressChange._id,
        status: "pending_review",
        message: "Your address change request is pending verification",
      }
    );
  } catch (error) {
    return profileUtils.handleOperationError(
      "Address update",
      error,
      metadata,
      session,
      sessionActive,
      res
    );
  }
};

/**
 * Update user phone number with verification
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updatePhone = async (req, res) => {
  const metadata = profileUtils.logOperationStart("Phone update", req);
  const { requestId, userId } = metadata;

  let sessionActive = false;
  let session;

  try {
    // Start transaction
    ({ session, sessionActive } = await profileUtils.startSession(
      userId,
      requestId
    ));

    // Extract phone from request body
    const { phone } = req.body;

    if (!phone) {
      logger.warn("Missing phone number", {
        userId,
        requestId,
      });
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Phone number is required"
      );
    }

    // Clean phone number (remove non-digit characters)
    const cleanedPhone = phone.replace(/\D/g, "");

    // Basic validation (ensure it has at least 10 digits)
    if (cleanedPhone.length < 10) {
      logger.warn("Invalid phone number format", {
        userId,
        requestId,
        phoneLength: cleanedPhone.length,
      });
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Invalid phone number format. Phone number must have at least 10 digits."
      );
    }

    // Find current user
    const currentUser = await profileUtils.findUserById(
      userId,
      session,
      requestId
    );
    if (!currentUser) {
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.notFound(res, "User not found");
    }

    // Format phone for consistency using standard format (XXX-XXX-XXXX)
    const formattedPhone =
      cleanedPhone.length === 10
        ? `${cleanedPhone.substring(0, 3)}-${cleanedPhone.substring(
            3,
            6
          )}-${cleanedPhone.substring(6, 10)}`
        : phone;

    // Check if phone is actually changing
    const isPhoneChanging = formattedPhone !== currentUser.phone;

    if (!isPhoneChanging) {
      logger.debug("Phone unchanged, skipping verification process", {
        userId,
        requestId,
      });

      // Update with the same phone (no verification needed)
      await User.findByIdAndUpdate(
        userId,
        { phone: formattedPhone },
        { session }
      );

      await profileUtils.endSession(session, sessionActive, true, requestId);
      sessionActive = false;

      profileUtils.logOperationComplete("Phone update", metadata, {
        status: "unchanged",
      });

      return apiResponse.success(
        res,
        200,
        "Phone updated successfully",
        "Your phone number has been updated",
        { status: "completed" }
      );
    }

    // Check for ID verification images for phone change
    if (!profileUtils.verifyRequiredImages(req.cloudinaryFiles)) {
      logger.warn("Missing verification images for phone change", {
        userId,
        requestId,
      });
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "ID verification images (front and back) are required for phone changes"
      );
    }

    // Create phone change request
    const phoneChange = new PhoneChange({
      userId,
      currentPhone: currentUser.phone || "",
      requestedPhone: formattedPhone,
      // Verification images
      frontIdUrl: req.cloudinaryFiles.frontIdImage.secure_url,
      frontIdPublicId: req.cloudinaryFiles.frontIdImage.public_id,
      backIdUrl: req.cloudinaryFiles.backIdImage.secure_url,
      backIdPublicId: req.cloudinaryFiles.backIdImage.public_id,
      // Status
      status: "pending_review",
      requestDate: new Date(),
    });

    await phoneChange.save({ session });

    logger.debug("Phone change request created", {
      userId,
      requestId,
      phoneChangeId: phoneChange._id,
    });

    // Commit transaction
    await profileUtils.endSession(session, sessionActive, true, requestId);
    sessionActive = false;

    profileUtils.logOperationComplete("Phone update", metadata, {
      phoneChangeId: phoneChange._id,
      status: "pending_review",
    });

    // Return success response
    return apiResponse.success(
      res,
      200,
      "Phone change request submitted successfully",
      "Your phone number change request is pending verification",
      {
        phoneChangeId: phoneChange._id,
        status: "pending_review",
        message: "Your phone number change request is pending verification",
      }
    );
  } catch (error) {
    return profileUtils.handleOperationError(
      "Phone update",
      error,
      metadata,
      session,
      sessionActive,
      res
    );
  }
};

/**
 * Update user phone number with verification
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.verifyPasscode = async (req, res) => {
  return apiResponse.success(
    res,
    200,
    "Verification successfully",
    "Current Passcode verified successfully",
    {
      user: req.user._id,
    }
  );
};

/**
 * Update user passcode
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updatePasscode = async (req, res) => {
  const metadata = profileUtils.logOperationStart("Passcode update", req);
  const { requestId, userId } = metadata;

  let sessionActive = false;
  let session;

  try {
    // Start transaction
    ({ session, sessionActive } = await profileUtils.startSession(
      userId,
      requestId
    ));

    // Extract passcodes from request body
    const { newPasscode, confirmPasscode } = req.body;

    // Validate passcodes
    if (!newPasscode || !confirmPasscode) {
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "New passcode and confirmation passcode are required"
      );
    }

    // Check if passcodes match
    if (newPasscode !== confirmPasscode) {
      logger.warn("Passcode mismatch", {
        userId,
        requestId,
      });
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "New passcode and confirmation passcode do not match"
      );
    }

    // Find current user
    const user = await User.findById(userId)
      .select("+passcodeHash")
      .session(session);

    if (!user) {
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.notFound(
        res,
        "Not Found",
        "User not found",
        "USER_NOT_FOUND"
      );
    }

    // Hash the passcode
    const salt = await bcrypt.genSalt(config.security.bcryptSaltRounds);
    user.passcodeHash = await bcrypt.hash(newPasscode, salt);
    user.passcodeAttemptLeft = config.security.passcodeMaxAttempts;

    await user.save({ session });

    logger.debug("User passcode updated", {
      userId,
      requestId,
    });

    // Commit transaction
    await profileUtils.endSession(session, sessionActive, true, requestId);
    sessionActive = false;

    profileUtils.logOperationComplete("Passcode update", metadata);

    return apiResponse.success(
      res,
      200,
      "Passcode Updated",
      "Your passcode has been updated successfully"
    );
  } catch (error) {
    return profileUtils.handleOperationError(
      "Passcode update",
      error,
      metadata,
      session,
      sessionActive,
      res
    );
  }
};

/**
 * Update user password
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updatePassword = async (req, res) => {
  const metadata = profileUtils.logOperationStart("Password update", req);
  const { requestId, userId } = metadata;

  let sessionActive = false;
  let session;

  try {
    // Start transaction
    ({ session, sessionActive } = await profileUtils.startSession(
      userId,
      requestId
    ));

    console.log("ffff", req.body);

    // Extract password data from request body
    const { oldPassword, newPassword } = req.body;

    // Validate password data
    if (!oldPassword || !newPassword) {
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Old password and new password are required"
      );
    }

    // Find current user with password included
    const user = await User.findById(userId)
      .select("+password")
      .session(session);

    if (!user) {
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.notFound(
        res,
        "Not Found",
        "User not found",
        "USER_NOT_FOUND"
      );
    }

    // Verify old password is correct
    const isMatch = await user.matchPassword(oldPassword);
    if (!isMatch) {
      logger.warn("Password mismatch during update attempt", {
        userId,
        requestId,
      });
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.unauthorized(
        res,
        "Unauthorized",
        "Current password is incorrect",
        "INVALID_PASSWORD"
      );
    }

    // Update password (will be hashed by the pre-save hook)
    user.password = newPassword;

    // Reset any security-related fields if needed
    // For example, if you have password attempt counters:
    user.passwordAttemptLeft = config.security.passwordMaxAttempts;

    await user.save({ session });

    logger.debug("User password updated", {
      userId,
      requestId,
    });

    // Commit transaction
    await profileUtils.endSession(session, sessionActive, true, requestId);
    sessionActive = false;

    profileUtils.logOperationComplete("Password update", metadata);

    return apiResponse.success(
      res,
      200,
      "Password Updated",
      "Your password has been updated successfully"
    );
  } catch (error) {
    return profileUtils.handleOperationError(
      "Password update",
      error,
      metadata,
      session,
      sessionActive,
      res
    );
  }
};

/**
 * Update account transfer limits
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updateAccountTransferLimits = async (req, res) => {
  const metadata = profileUtils.logOperationStart(
    "Account transfer limits update",
    req
  );
  const { requestId, userId } = metadata;

  let sessionActive = false;
  let session;

  try {
    // Start transaction
    ({ session, sessionActive } = await profileUtils.startSession(
      userId,
      requestId
    ));

    // Extract data from request body
    const { accountId, dailyLimit, limitPerTransaction } = req.body;

    if (!accountId) {
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Account ID is required"
      );
    }

    // Validate limits if provided
    if (dailyLimit !== undefined && (isNaN(dailyLimit) || dailyLimit < 0)) {
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Daily limit must be a non-negative number"
      );
    }

    if (
      limitPerTransaction !== undefined &&
      (isNaN(limitPerTransaction) || limitPerTransaction < 0)
    ) {
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Limit per transaction must be a non-negative number"
      );
    }

    // Find the account
    const Account = require("../models/Account");
    const account = await Account.findOne({
      _id: accountId,
      user: userId,
    }).session(session);

    if (!account) {
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.notFound(
        res,
        "Not Found",
        "Account not found or does not belong to the user"
      );
    }

    // Store original values for logging and response
    const originalDailyLimit = account.limits.dailyTransfer;
    const originalLimitPerTransaction =
      account.limits.maxTransferPerTransaction;

    logger.debug("Updating account transfer limits", {
      userId,
      requestId,
      accountId,
      currentDailyLimit: originalDailyLimit,
      newDailyLimit: dailyLimit,
      currentLimitPerTransaction: originalLimitPerTransaction,
      newLimitPerTransaction: limitPerTransaction,
    });

    // Update only the provided limits - directly on the account object for atomicity
    let isModified = false;
    const updatedFields = [];

    if (dailyLimit !== undefined) {
      account.limits.dailyTransfer = dailyLimit;
      updatedFields.push("dailyTransfer");
      isModified = true;
    }

    if (limitPerTransaction !== undefined) {
      account.limits.maxTransferPerTransaction = limitPerTransaction;
      updatedFields.push("maxTransferPerTransaction");
      isModified = true;
    }

    // If no updates, return success
    if (!isModified) {
      await profileUtils.endSession(session, sessionActive, true, requestId);
      sessionActive = false;

      return apiResponse.success(
        res,
        200,
        "No changes requested",
        "Account transfer limits remain unchanged",
        { accountId }
      );
    }

    // Save the updated account document
    await account.save({ session });

    await notificationService.createNotification(
      userId,
      "Successful Limit Update",
      `Your account transfer limits have been updated.`,
      "account",
      { accountId }
    );

    // Commit transaction
    await profileUtils.endSession(session, sessionActive, true, requestId);
    sessionActive = false;

    profileUtils.logOperationComplete(
      "Account transfer limits update",
      metadata,
      {
        accountId,
        updatedFields: updatedFields.join(", "),
      }
    );

    return apiResponse.success(
      res,
      200,
      "Account transfer limits updated successfully",
      "Your account transfer limits have been updated",
      {
        accountId,
        updatedLimits: {
          dailyTransfer:
            dailyLimit !== undefined ? dailyLimit : originalDailyLimit,
          maxTransferPerTransaction:
            limitPerTransaction !== undefined
              ? limitPerTransaction
              : originalLimitPerTransaction,
        },
      }
    );
  } catch (error) {
    return profileUtils.handleOperationError(
      "Account transfer limits update",
      error,
      metadata,
      session,
      sessionActive,
      res
    );
  }
};

/**
 * Update card limits
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updateCardLimits = async (req, res) => {
  const metadata = profileUtils.logOperationStart("Card limits update", req);
  const { requestId, userId } = metadata;

  let sessionActive = false;
  let session;

  try {
    // Start transaction
    ({ session, sessionActive } = await profileUtils.startSession(
      userId,
      requestId
    ));

    // Extract data from request body
    const {
      cardId,
      dailyTransferLimit,
      maxTransferPerTransaction,
      dailyWithdrawalLimit,
      maxWithdrawalPerTransaction,
    } = req.body;

    if (!cardId) {
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.badRequest(res, "Bad Request", "Card ID is required");
    }

    // Validate limits if provided
    const validateLimit = (value, name) => {
      if (value !== undefined && (isNaN(value) || value < 0)) {
        throw new Error(`${name} must be a non-negative number`);
      }
    };

    try {
      validateLimit(dailyTransferLimit, "Daily transfer limit");
      validateLimit(maxTransferPerTransaction, "Max transfer per transaction");
      validateLimit(dailyWithdrawalLimit, "Daily withdrawal limit");
      validateLimit(
        maxWithdrawalPerTransaction,
        "Max withdrawal per transaction"
      );
    } catch (validationError) {
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.badRequest(
        res,
        "Bad Request",
        validationError.message
      );
    }

    // Find the card
    const Card = require("../models/Card");
    const card = await Card.findOne({
      _id: cardId,
      user: userId,
    }).session(session);

    if (!card) {
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.notFound(
        res,
        "Not Found",
        "Card not found or does not belong to the user"
      );
    }

    // Store original values for logging and response
    const originalLimits = {
      dailyTransfer: card.limits.dailyTransfer,
      maxTransferPerTransaction: card.limits.maxTransferPerTransaction,
      dailyWithdrawal: card.limits.dailyWithdrawal,
      maxWithdrawalPerTransaction: card.limits.maxWithdrawalPerTransaction,
    };

    logger.debug("Updating card limits", {
      userId,
      requestId,
      cardId,
      currentLimits: originalLimits,
      requestedLimits: {
        dailyTransfer: dailyTransferLimit,
        maxTransferPerTransaction: maxTransferPerTransaction,
        dailyWithdrawal: dailyWithdrawalLimit,
        maxWithdrawalPerTransaction: maxWithdrawalPerTransaction,
      },
    });

    // Update only the provided limits - directly on the card object for atomicity
    let isModified = false;
    const updatedFields = [];

    if (dailyTransferLimit !== undefined) {
      card.limits.dailyTransfer = dailyTransferLimit;
      updatedFields.push("dailyTransfer");
      isModified = true;
    }

    if (maxTransferPerTransaction !== undefined) {
      card.limits.maxTransferPerTransaction = maxTransferPerTransaction;
      updatedFields.push("maxTransferPerTransaction");
      isModified = true;
    }

    if (dailyWithdrawalLimit !== undefined) {
      card.limits.dailyWithdrawal = dailyWithdrawalLimit;
      updatedFields.push("dailyWithdrawal");
      isModified = true;
    }

    if (maxWithdrawalPerTransaction !== undefined) {
      card.limits.maxWithdrawalPerTransaction = maxWithdrawalPerTransaction;
      updatedFields.push("maxWithdrawalPerTransaction");
      isModified = true;
    }

    // If no updates, return success
    if (!isModified) {
      await profileUtils.endSession(session, sessionActive, true, requestId);
      sessionActive = false;

      return apiResponse.success(
        res,
        200,
        "No changes requested",
        "Card limits remain unchanged",
        { cardId }
      );
    }

    // Save the updated card document
    await card.save({ session });

    // Commit transaction
    await profileUtils.endSession(session, sessionActive, true, requestId);
    sessionActive = false;

    profileUtils.logOperationComplete("Card limits update", metadata, {
      cardId,
      updatedFields: updatedFields.join(", "),
    });

    // Build updated limits response
    const updatedLimits = {
      dailyTransfer: card.limits.dailyTransfer,
      maxTransferPerTransaction: card.limits.maxTransferPerTransaction,
      dailyWithdrawal: card.limits.dailyWithdrawal,
      maxWithdrawalPerTransaction: card.limits.maxWithdrawalPerTransaction,
    };

    return apiResponse.success(
      res,
      200,
      "Card limits updated successfully",
      "Your card limits have been updated",
      {
        cardId,
        updatedLimits,
      }
    );
  } catch (error) {
    return profileUtils.handleOperationError(
      "Card limits update",
      error,
      metadata,
      session,
      sessionActive,
      res
    );
  }
};

/**
 * Update wallet limits
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updateWalletLimits = async (req, res) => {
  const metadata = profileUtils.logOperationStart("Wallet limits update", req);
  const { requestId, userId } = metadata;

  let sessionActive = false;
  let session;

  try {
    // Start transaction
    ({ session, sessionActive } = await profileUtils.startSession(
      userId,
      requestId
    ));

    // Extract data from request body
    const { walletId, dailyWithdrawalLimit, maxWithdrawalPerTransaction } =
      req.body;

    if (!walletId) {
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Wallet ID is required"
      );
    }

    // Validate limits if provided
    const validateLimit = (value, name) => {
      if (value !== undefined && (isNaN(value) || value < 0)) {
        throw new Error(`${name} must be a non-negative number`);
      }
    };

    try {
      validateLimit(dailyWithdrawalLimit, "Daily withdrawal limit");
      validateLimit(
        maxWithdrawalPerTransaction,
        "Max withdrawal per transaction"
      );
    } catch (validationError) {
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.badRequest(
        res,
        "Bad Request",
        validationError.message
      );
    }

    // Find the wallet
    const Wallet = require("../models/Wallet");
    const wallet = await Wallet.findOne({
      _id: walletId,
      user: userId,
    }).session(session);

    if (!wallet) {
      await profileUtils.endSession(session, sessionActive, false, requestId);
      return apiResponse.notFound(
        res,
        "Not Found",
        "Wallet not found or does not belong to the user"
      );
    }

    // Store original values for logging and response
    const originalLimits = {
      dailyWithdrawal: wallet.limits.dailyWithdrawal,
      maxWithdrawalPerTransaction: wallet.limits.maxWithdrawalPerTransaction,
    };

    logger.debug("Updating wallet limits", {
      userId,
      requestId,
      walletId,
      currentLimits: originalLimits,
      requestedLimits: {
        dailyWithdrawal: dailyWithdrawalLimit,
        maxWithdrawalPerTransaction: maxWithdrawalPerTransaction,
      },
    });

    // Update only the provided limits - directly on the wallet object for atomicity
    let isModified = false;
    const updatedFields = [];

    if (dailyWithdrawalLimit !== undefined) {
      wallet.limits.dailyWithdrawal = dailyWithdrawalLimit;
      updatedFields.push("dailyWithdrawal");
      isModified = true;
    }

    if (maxWithdrawalPerTransaction !== undefined) {
      wallet.limits.maxWithdrawalPerTransaction = maxWithdrawalPerTransaction;
      updatedFields.push("maxWithdrawalPerTransaction");
      isModified = true;
    }

    // If no updates, return success
    if (!isModified) {
      await profileUtils.endSession(session, sessionActive, true, requestId);
      sessionActive = false;

      return apiResponse.success(
        res,
        200,
        "No changes requested",
        "Wallet limits remain unchanged",
        { walletId }
      );
    }

    // Save the updated wallet document
    await wallet.save({ session });

    // Commit transaction
    await profileUtils.endSession(session, sessionActive, true, requestId);
    sessionActive = false;

    profileUtils.logOperationComplete("Wallet limits update", metadata, {
      walletId,
      updatedFields: updatedFields.join(", "),
    });

    // Build updated limits response
    const updatedLimits = {
      dailyWithdrawal: wallet.limits.dailyWithdrawal,
      maxWithdrawalPerTransaction: wallet.limits.maxWithdrawalPerTransaction,
    };

    return apiResponse.success(
      res,
      200,
      "Wallet limits updated successfully",
      "Your wallet limits have been updated",
      {
        walletId,
        updatedLimits,
      }
    );
  } catch (error) {
    return profileUtils.handleOperationError(
      "Wallet limits update",
      error,
      metadata,
      session,
      sessionActive,
      res
    );
  }
};

/**
 * Get all address change requests with optional filtering
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getAddressChangeRequests = async (req, res) => {
  const requestId = req.id;
  const adminId = req.user?._id;

  try {
    // Extract query parameters for filtering
    const {
      status,
      sortBy = "requestDate",
      sortOrder = "desc",
      page = 1,
      limit = 10,
    } = req.query;

    // Ensure AddressChange model exists
    const AddressChange = mongoose.models.AddressChange;
    if (!AddressChange) {
      return apiResponse.success(
        res,
        200,
        "Address change requests retrieved successfully",
        "Address Change Requests",
        {
          requests: [],
          pagination: {
            totalCount: 0,
            totalPages: 0,
            currentPage: parseInt(page),
            limit: parseInt(limit),
          },
        }
      );
    }

    // Build query based on filters
    const query = {};
    if (status) {
      query.status = status;
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;

    // Get total count for pagination
    const totalCount = await AddressChange.countDocuments(query);

    // Execute query with pagination and sorting
    const addressChangeRequests = await AddressChange.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .populate({
        path: "userId",
        select: "email firstName lastName fullName",
      })
      .populate({
        path: "reviewedBy",
        select: "email firstName lastName",
      });

    logger.info("Admin retrieved address change requests", {
      adminId,
      requestId,
      count: addressChangeRequests.length,
      filters: { status },
      pagination: { page, limit },
    });

    // Return paginated results with metadata
    return apiResponse.success(
      res,
      200,
      "Address change requests retrieved successfully",
      "Address Change Requests",
      {
        requests: addressChangeRequests,
        pagination: {
          totalCount,
          totalPages: Math.ceil(totalCount / parseInt(limit)),
          currentPage: parseInt(page),
          limit: parseInt(limit),
        },
      }
    );
  } catch (error) {
    logger.error("Error retrieving address change requests", {
      adminId,
      requestId,
      error: error.message,
      stack: error.stack,
    });

    return apiResponse.error(
      res,
      500,
      "Failed to retrieve address change requests",
      { errorId: requestId }
    );
  }
};

/**
 * Get a specific address change request by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getAddressChangeRequestById = async (req, res) => {
  const requestId = req.id;
  const adminId = req.user?._id;
  const { addressChangeId } = req.params;

  try {
    // Ensure AddressChange model exists
    const AddressChange = mongoose.models.AddressChange;
    if (!AddressChange) {
      return apiResponse.notFound(res, "Address change request not found");
    }

    const addressChangeRequest = await AddressChange.findById(addressChangeId)
      .populate({
        path: "userId",
        select: "email firstName lastName",
      })
      .populate({
        path: "reviewedBy",
        select: "email firstName lastName",
      });

    if (!addressChangeRequest) {
      logger.warn("Address change request not found", {
        adminId,
        requestId,
        addressChangeId,
      });

      return apiResponse.notFound(res, "Address change request not found");
    }

    logger.info("Admin retrieved address change request details", {
      adminId,
      requestId,
      addressChangeId,
      status: addressChangeRequest.status,
    });

    return apiResponse.success(
      res,
      200,
      "Address change request retrieved successfully",
      "Address Change Request Details",
      { request: addressChangeRequest }
    );
  } catch (error) {
    logger.error("Error retrieving address change request details", {
      adminId,
      requestId,
      addressChangeId,
      error: error.message,
      stack: error.stack,
    });

    return apiResponse.error(
      res,
      500,
      "Failed to retrieve address change request details",
      { errorId: requestId }
    );
  }
};

/**
 * Approve an address change request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.approveAddressChange = async (req, res) => {
  const requestId = req.id;
  const adminId = req.user?._id;
  const { addressChangeId } = req.params;
  const { notes } = req.body;

  // Track session state
  let sessionActive = false;
  const session = await mongoose.startSession();

  try {
    session.startTransaction();
    sessionActive = true;

    // Ensure AddressChange model exists
    const AddressChange = mongoose.models.AddressChange;
    if (!AddressChange) {
      await session.abortTransaction();
      session.endSession();
      sessionActive = false;
      return apiResponse.notFound(res, "Address change request not found");
    }

    // Find the address change request
    const addressChangeRequest = await AddressChange.findById(
      addressChangeId
    ).session(session);

    if (!addressChangeRequest) {
      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      logger.warn("Address change request not found during approval", {
        adminId,
        requestId,
        addressChangeId,
      });

      return apiResponse.notFound(res, "Address change request not found");
    }

    // Check if request is already processed
    if (addressChangeRequest.status !== "pending_review") {
      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      logger.warn("Address change request already processed", {
        adminId,
        requestId,
        addressChangeId,
        currentStatus: addressChangeRequest.status,
      });

      return apiResponse.badRequest(
        res,
        "Bad Request",
        "This address change request has already been processed"
      );
    }

    // Update address change request
    addressChangeRequest.status = "approved";
    addressChangeRequest.reviewedBy = adminId;
    addressChangeRequest.reviewDate = new Date();
    addressChangeRequest.completedDate = new Date();
    if (notes) {
      addressChangeRequest.notes = notes;
    }

    await addressChangeRequest.save({ session });

    // Update user with new address
    const updatedUser = await User.findByIdAndUpdate(
      addressChangeRequest.userId,
      {
        address: {
          street1: addressChangeRequest.requestedStreet1,
          street2: addressChangeRequest.requestedStreet2,
          city: addressChangeRequest.requestedCity,
          state: addressChangeRequest.requestedState,
          zipCode: addressChangeRequest.requestedZipCode,
          country: addressChangeRequest.requestedCountry,
        },
      },
      { new: true, session }
    );

    if (!updatedUser) {
      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      logger.error("User not found during address change approval", {
        adminId,
        requestId,
        addressChangeId,
        userId: addressChangeRequest.userId,
      });

      return apiResponse.error(
        res,
        500,
        "Failed to update user with new address",
        { errorId: requestId }
      );
    }

    // Commit transaction
    await session.commitTransaction();
    session.endSession();
    sessionActive = false;

    logger.info("Address change request approved successfully", {
      adminId,
      requestId,
      addressChangeId,
      userId: addressChangeRequest.userId,
      oldAddress: `${addressChangeRequest.currentStreet1}, ${addressChangeRequest.currentCity}, ${addressChangeRequest.currentState} ${addressChangeRequest.currentZipCode}`,
      newAddress: `${addressChangeRequest.requestedStreet1}, ${addressChangeRequest.requestedCity}, ${addressChangeRequest.requestedState} ${addressChangeRequest.requestedZipCode}`,
    });

    return apiResponse.success(
      res,
      200,
      "Address change approved",
      "Address Change Approved Successfully",
      {
        addressChangeId: addressChangeRequest._id,
        userId: addressChangeRequest.userId,
        newAddress: {
          street1: addressChangeRequest.requestedStreet1,
          street2: addressChangeRequest.requestedStreet2,
          city: addressChangeRequest.requestedCity,
          state: addressChangeRequest.requestedState,
          zipCode: addressChangeRequest.requestedZipCode,
          country: addressChangeRequest.requestedCountry,
        },
      }
    );
  } catch (error) {
    logger.error("Error approving address change request", {
      adminId,
      requestId,
      addressChangeId,
      error: error.message,
      stack: error.stack,
    });

    // Ensure transaction is aborted if still active
    if (sessionActive) {
      try {
        await session.abortTransaction();
        session.endSession();
        logger.debug("Transaction aborted due to error", { requestId });
      } catch (sessionError) {
        logger.error("Error aborting transaction", {
          requestId,
          error: sessionError.message,
        });
      }
    }

    return apiResponse.error(
      res,
      500,
      "Failed to approve address change request",
      { errorId: requestId }
    );
  }
};

/**
 * Reject an address change request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.rejectAddressChange = async (req, res) => {
  const requestId = req.id;
  const adminId = req.user?._id;
  const { addressChangeId } = req.params;
  const { rejectionReason, notes } = req.body;

  // Require rejection reason
  if (!rejectionReason) {
    logger.warn("Missing rejection reason", {
      adminId,
      requestId,
      addressChangeId,
    });

    return apiResponse.badRequest(
      res,
      "Bad Request",
      "Rejection reason is required"
    );
  }

  const session = await mongoose.startSession();
  let sessionActive = false;

  try {
    session.startTransaction();
    sessionActive = true;

    // Ensure AddressChange model exists
    const AddressChange = mongoose.models.AddressChange;
    if (!AddressChange) {
      await session.abortTransaction();
      session.endSession();
      sessionActive = false;
      return apiResponse.notFound(res, "Address change request not found");
    }

    // Find the address change request
    const addressChangeRequest = await AddressChange.findById(
      addressChangeId
    ).session(session);

    if (!addressChangeRequest) {
      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      logger.warn("Address change request not found during rejection", {
        adminId,
        requestId,
        addressChangeId,
      });

      return apiResponse.notFound(res, "Address change request not found");
    }

    // Check if request is already processed
    if (addressChangeRequest.status !== "pending_review") {
      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      logger.warn("Address change request already processed", {
        adminId,
        requestId,
        addressChangeId,
        currentStatus: addressChangeRequest.status,
      });

      return apiResponse.badRequest(
        res,
        "Bad Request",
        "This address change request has already been processed"
      );
    }

    // Update address change request
    addressChangeRequest.status = "rejected";
    addressChangeRequest.reviewedBy = adminId;
    addressChangeRequest.reviewDate = new Date();
    addressChangeRequest.completedDate = new Date();
    addressChangeRequest.rejectionReason = rejectionReason;
    if (notes) {
      addressChangeRequest.notes = notes;
    }

    await addressChangeRequest.save({ session });

    // Commit transaction
    await session.commitTransaction();
    session.endSession();
    sessionActive = false;

    logger.info("Address change request rejected", {
      adminId,
      requestId,
      addressChangeId,
      userId: addressChangeRequest.userId,
      requestedAddress: `${addressChangeRequest.requestedStreet1}, ${addressChangeRequest.requestedCity}, ${addressChangeRequest.requestedState} ${addressChangeRequest.requestedZipCode}`,
      rejectionReason,
    });

    return apiResponse.success(
      res,
      200,
      "Address change rejected",
      "Address Change Rejected",
      {
        addressChangeId: addressChangeRequest._id,
        userId: addressChangeRequest.userId,
        rejectionReason,
      }
    );
  } catch (error) {
    logger.error("Error rejecting address change request", {
      adminId,
      requestId,
      addressChangeId,
      error: error.message,
      stack: error.stack,
    });

    // Ensure transaction is aborted if still active
    if (sessionActive) {
      try {
        await session.abortTransaction();
        session.endSession();
        logger.debug("Transaction aborted due to error", { requestId });
      } catch (sessionError) {
        logger.error("Error aborting transaction", {
          requestId,
          error: sessionError.message,
        });
      }
    }

    return apiResponse.error(
      res,
      500,
      "Failed to reject address change request",
      { errorId: requestId }
    );
  }
};

/**
 * Get all phone change requests with optional filtering
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getPhoneChangeRequests = async (req, res) => {
  const requestId = req.id;
  const adminId = req.user?._id;

  try {
    // Extract query parameters for filtering
    const {
      status,
      sortBy = "requestDate",
      sortOrder = "desc",
      page = 1,
      limit = 10,
    } = req.query;

    // Build query based on filters
    const query = {};
    if (status) {
      query.status = status;
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;

    // Get total count for pagination
    const totalCount = await PhoneChange.countDocuments(query);

    // Execute query with pagination and sorting
    const phoneChangeRequests = await PhoneChange.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .populate({
        path: "userId",
        select: "email firstName lastName fullName",
      })
      .populate({
        path: "reviewedBy",
        select: "email firstName lastName",
      });

    logger.info("Admin retrieved phone change requests", {
      adminId,
      requestId,
      count: phoneChangeRequests.length,
      filters: { status },
      pagination: { page, limit },
    });

    // Return paginated results with metadata
    return apiResponse.success(
      res,
      200,
      "Phone change requests retrieved successfully",
      "Phone Change Requests",
      {
        requests: phoneChangeRequests,
        pagination: {
          totalCount,
          totalPages: Math.ceil(totalCount / parseInt(limit)),
          currentPage: parseInt(page),
          limit: parseInt(limit),
        },
      }
    );
  } catch (error) {
    logger.error("Error retrieving phone change requests", {
      adminId,
      requestId,
      error: error.message,
      stack: error.stack,
    });

    return apiResponse.error(
      res,
      500,
      "Failed to retrieve phone change requests",
      { errorId: requestId }
    );
  }
};

/**
 * Get a specific phone change request by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getPhoneChangeRequestById = async (req, res) => {
  const requestId = req.id;
  const adminId = req.user?._id;
  const { phoneChangeId } = req.params;

  try {
    const phoneChangeRequest = await PhoneChange.findById(phoneChangeId)
      .populate({
        path: "userId",
        select: "email firstName lastName",
      })
      .populate({
        path: "reviewedBy",
        select: "email firstName lastName",
      });

    if (!phoneChangeRequest) {
      logger.warn("Phone change request not found", {
        adminId,
        requestId,
        phoneChangeId,
      });

      return apiResponse.notFound(res, "Phone change request not found");
    }

    logger.info("Admin retrieved phone change request details", {
      adminId,
      requestId,
      phoneChangeId,
      status: phoneChangeRequest.status,
    });

    return apiResponse.success(
      res,
      200,
      "Phone change request retrieved successfully",
      "Phone Change Request Details",
      { request: phoneChangeRequest }
    );
  } catch (error) {
    logger.error("Error retrieving phone change request details", {
      adminId,
      requestId,
      phoneChangeId,
      error: error.message,
      stack: error.stack,
    });

    return apiResponse.error(
      res,
      500,
      "Failed to retrieve phone change request details",
      { errorId: requestId }
    );
  }
};

/**
 * Approve a phone change request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.approvePhoneChange = async (req, res) => {
  const requestId = req.id;
  const adminId = req.user?._id;
  const { phoneChangeId } = req.params;
  const { notes } = req.body;

  // Track session state
  let sessionActive = false;
  const session = await mongoose.startSession();

  try {
    session.startTransaction();
    sessionActive = true;

    // Find the phone change request
    const phoneChangeRequest = await PhoneChange.findById(
      phoneChangeId
    ).session(session);

    if (!phoneChangeRequest) {
      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      logger.warn("Phone change request not found during approval", {
        adminId,
        requestId,
        phoneChangeId,
      });

      return apiResponse.notFound(res, "Phone change request not found");
    }

    // Check if request is already processed
    if (phoneChangeRequest.status !== "pending_review") {
      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      logger.warn("Phone change request already processed", {
        adminId,
        requestId,
        phoneChangeId,
        currentStatus: phoneChangeRequest.status,
      });

      return apiResponse.badRequest(
        res,
        "Bad Request",
        "This phone change request has already been processed"
      );
    }

    // Update phone change request
    phoneChangeRequest.status = "approved";
    phoneChangeRequest.reviewedBy = adminId;
    phoneChangeRequest.reviewDate = new Date();
    phoneChangeRequest.completedDate = new Date();
    if (notes) {
      phoneChangeRequest.notes = notes;
    }

    await phoneChangeRequest.save({ session });

    // Update user with new phone number
    const updatedUser = await User.findByIdAndUpdate(
      phoneChangeRequest.userId,
      { phone: phoneChangeRequest.requestedPhone },
      { new: true, session }
    );

    if (!updatedUser) {
      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      logger.error("User not found during phone change approval", {
        adminId,
        requestId,
        phoneChangeId,
        userId: phoneChangeRequest.userId,
      });

      return apiResponse.error(
        res,
        500,
        "Failed to update user with new phone number",
        { errorId: requestId }
      );
    }

    // Commit transaction
    await session.commitTransaction();
    session.endSession();
    sessionActive = false;

    logger.info("Phone change request approved successfully", {
      adminId,
      requestId,
      phoneChangeId,
      userId: phoneChangeRequest.userId,
      oldPhone: phoneChangeRequest.currentPhone,
      newPhone: phoneChangeRequest.requestedPhone,
    });

    return apiResponse.success(
      res,
      200,
      "Phone change approved",
      "Phone Change Approved Successfully",
      {
        phoneChangeId: phoneChangeRequest._id,
        userId: phoneChangeRequest.userId,
        newPhone: phoneChangeRequest.requestedPhone,
      }
    );
  } catch (error) {
    logger.error("Error approving phone change request", {
      adminId,
      requestId,
      phoneChangeId,
      error: error.message,
      stack: error.stack,
    });

    // Ensure transaction is aborted if still active
    if (sessionActive) {
      try {
        await session.abortTransaction();
        session.endSession();
        logger.debug("Transaction aborted due to error", { requestId });
      } catch (sessionError) {
        logger.error("Error aborting transaction", {
          requestId,
          error: sessionError.message,
        });
      }
    }

    return apiResponse.error(
      res,
      500,
      "Failed to approve phone change request",
      { errorId: requestId }
    );
  }
};

/**
 * Reject a phone change request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.rejectPhoneChange = async (req, res) => {
  const requestId = req.id;
  const adminId = req.user?._id;
  const { phoneChangeId } = req.params;
  const { rejectionReason, notes } = req.body;

  // Require rejection reason
  if (!rejectionReason) {
    logger.warn("Missing rejection reason", {
      adminId,
      requestId,
      phoneChangeId,
    });

    return apiResponse.badRequest(
      res,
      "Bad Request",
      "Rejection reason is required"
    );
  }

  const session = await mongoose.startSession();
  let sessionActive = false;

  try {
    session.startTransaction();
    sessionActive = true;

    // Find the phone change request
    const phoneChangeRequest = await PhoneChange.findById(
      phoneChangeId
    ).session(session);

    if (!phoneChangeRequest) {
      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      logger.warn("Phone change request not found during rejection", {
        adminId,
        requestId,
        phoneChangeId,
      });

      return apiResponse.notFound(res, "Phone change request not found");
    }

    // Check if request is already processed
    if (phoneChangeRequest.status !== "pending_review") {
      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      logger.warn("Phone change request already processed", {
        adminId,
        requestId,
        phoneChangeId,
        currentStatus: phoneChangeRequest.status,
      });

      return apiResponse.badRequest(
        res,
        "Bad Request",
        "This phone change request has already been processed"
      );
    }

    // Update phone change request
    phoneChangeRequest.status = "rejected";
    phoneChangeRequest.reviewedBy = adminId;
    phoneChangeRequest.reviewDate = new Date();
    phoneChangeRequest.completedDate = new Date();
    phoneChangeRequest.rejectionReason = rejectionReason;
    if (notes) {
      phoneChangeRequest.notes = notes;
    }

    await phoneChangeRequest.save({ session });

    // Commit transaction
    await session.commitTransaction();
    session.endSession();
    sessionActive = false;

    logger.info("Phone change request rejected", {
      adminId,
      requestId,
      phoneChangeId,
      userId: phoneChangeRequest.userId,
      requestedPhone: phoneChangeRequest.requestedPhone,
      rejectionReason,
    });

    return apiResponse.success(
      res,
      200,
      "Phone change rejected",
      "Phone Change Rejected",
      {
        phoneChangeId: phoneChangeRequest._id,
        userId: phoneChangeRequest.userId,
        rejectionReason,
      }
    );
  } catch (error) {
    logger.error("Error rejecting phone change request", {
      adminId,
      requestId,
      phoneChangeId,
      error: error.message,
      stack: error.stack,
    });

    // Ensure transaction is aborted if still active
    if (sessionActive) {
      try {
        await session.abortTransaction();
        session.endSession();
        logger.debug("Transaction aborted due to error", { requestId });
      } catch (sessionError) {
        logger.error("Error aborting transaction", {
          requestId,
          error: sessionError.message,
        });
      }
    }

    return apiResponse.error(
      res,
      500,
      "Failed to reject phone change request",
      { errorId: requestId }
    );
  }
};

/**
 * Get all name change requests with optional filtering
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getNameChangeRequests = async (req, res) => {
  const requestId = req.id;
  const adminId = req.user?._id;

  try {
    // Extract query parameters for filtering
    const {
      status,
      sortBy = "requestDate",
      sortOrder = "desc",
      page = 1,
      limit = 10,
    } = req.query;

    // Build query based on filters
    const query = {};
    if (status) {
      query.status = status;
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;

    // Get total count for pagination
    const totalCount = await NameChange.countDocuments(query);

    // Execute query with pagination and sorting
    const nameChangeRequests = await NameChange.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .populate({
        path: "userId",
        select: "email firstName lastName fullName",
      })
      .populate({
        path: "reviewedBy",
        select: "email firstName lastName",
      });

    logger.info("Admin retrieved name change requests", {
      adminId,
      requestId,
      count: nameChangeRequests.length,
      filters: { status },
      pagination: { page, limit },
    });

    // Return paginated results with metadata
    return apiResponse.success(
      res,
      200,
      "Name change requests retrieved successfully",
      "Name Change Requests",
      {
        requests: nameChangeRequests,
        pagination: {
          totalCount,
          totalPages: Math.ceil(totalCount / parseInt(limit)),
          currentPage: parseInt(page),
          limit: parseInt(limit),
        },
      }
    );
  } catch (error) {
    logger.error("Error retrieving name change requests", {
      adminId,
      requestId,
      error: error.message,
      stack: error.stack,
    });

    return apiResponse.error(
      res,
      500,
      "Failed to retrieve name change requests",
      { errorId: requestId }
    );
  }
};

/**
 * Get a specific name change request by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getNameChangeRequestById = async (req, res) => {
  const requestId = req.id;
  const adminId = req.user?._id;
  const { nameChangeId } = req.params;

  try {
    const nameChangeRequest = await NameChange.findById(nameChangeId)
      .populate({
        path: "userId",
        select: "email firstName lastName",
      })
      .populate({
        path: "reviewedBy",
        select: "email firstName lastName",
      });

    if (!nameChangeRequest) {
      logger.warn("Name change request not found", {
        adminId,
        requestId,
        nameChangeId,
      });

      return apiResponse.notFound(res, "Name change request not found");
    }

    logger.info("Admin retrieved name change request details", {
      adminId,
      requestId,
      nameChangeId,
      status: nameChangeRequest.status,
    });

    return apiResponse.success(
      res,
      200,
      "Name change request retrieved successfully",
      "Name Change Request Details",
      { request: nameChangeRequest }
    );
  } catch (error) {
    logger.error("Error retrieving name change request details", {
      adminId,
      requestId,
      nameChangeId,
      error: error.message,
      stack: error.stack,
    });

    return apiResponse.error(
      res,
      500,
      "Failed to retrieve name change request details",
      { errorId: requestId }
    );
  }
};

/**
 * Approve a name change request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.approveNameChange = async (req, res) => {
  const requestId = req.id;
  const adminId = req.user?._id;
  const { nameChangeId } = req.params;
  const { notes } = req.body;

  // Track session state
  let sessionActive = false;
  const session = await mongoose.startSession();

  try {
    session.startTransaction();
    sessionActive = true;

    // Find the name change request
    const nameChangeRequest = await NameChange.findById(nameChangeId).session(
      session
    );

    if (!nameChangeRequest) {
      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      logger.warn("Name change request not found during approval", {
        adminId,
        requestId,
        nameChangeId,
      });

      return apiResponse.notFound(res, "Name change request not found");
    }

    // Check if request is already processed
    if (nameChangeRequest.status !== "pending_review") {
      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      logger.warn("Name change request already processed", {
        adminId,
        requestId,
        nameChangeId,
        currentStatus: nameChangeRequest.status,
      });

      return apiResponse.badRequest(
        res,
        "Bad Request",
        "This name change request has already been processed"
      );
    }

    // Update name change request
    nameChangeRequest.status = "approved";
    nameChangeRequest.reviewedBy = adminId;
    nameChangeRequest.reviewDate = new Date();
    nameChangeRequest.completedDate = new Date();
    if (notes) {
      nameChangeRequest.notes = notes;
    }

    await nameChangeRequest.save({ session });

    // Update user with new name
    const updatedUser = await User.findByIdAndUpdate(
      nameChangeRequest.userId,
      {
        firstName: nameChangeRequest.requestedFirstName,
        lastName: nameChangeRequest.requestedLastName,
        fullName: `${nameChangeRequest.requestedFirstName} ${nameChangeRequest.requestedLastName}`,
      },
      { new: true, session }
    );

    if (!updatedUser) {
      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      logger.error("User not found during name change approval", {
        adminId,
        requestId,
        nameChangeId,
        userId: nameChangeRequest.userId,
      });

      return apiResponse.error(
        res,
        500,
        "Failed to update user with new name",
        { errorId: requestId }
      );
    }

    // Commit transaction
    await session.commitTransaction();
    session.endSession();
    sessionActive = false;

    logger.info("Name change request approved successfully", {
      adminId,
      requestId,
      nameChangeId,
      userId: nameChangeRequest.userId,
      oldName: `${nameChangeRequest.currentFirstName} ${nameChangeRequest.currentLastName}`,
      newName: `${nameChangeRequest.requestedFirstName} ${nameChangeRequest.requestedLastName}`,
    });

    return apiResponse.success(
      res,
      200,
      "Name change approved",
      "Name Change Approved Successfully",
      {
        nameChangeId: nameChangeRequest._id,
        userId: nameChangeRequest.userId,
        newName: {
          firstName: nameChangeRequest.requestedFirstName,
          lastName: nameChangeRequest.requestedLastName,
        },
      }
    );
  } catch (error) {
    logger.error("Error approving name change request", {
      adminId,
      requestId,
      nameChangeId,
      error: error.message,
      stack: error.stack,
    });

    // Ensure transaction is aborted if still active
    if (sessionActive) {
      try {
        await session.abortTransaction();
        session.endSession();
        logger.debug("Transaction aborted due to error", { requestId });
      } catch (sessionError) {
        logger.error("Error aborting transaction", {
          requestId,
          error: sessionError.message,
        });
      }
    }

    return apiResponse.error(
      res,
      500,
      "Failed to approve name change request",
      { errorId: requestId }
    );
  }
};

/**
 * Reject a name change request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.rejectNameChange = async (req, res) => {
  const requestId = req.id;
  const adminId = req.user?._id;
  const { nameChangeId } = req.params;
  const { rejectionReason, notes } = req.body;

  // Require rejection reason
  if (!rejectionReason) {
    logger.warn("Missing rejection reason", {
      adminId,
      requestId,
      nameChangeId,
    });

    return apiResponse.badRequest(
      res,
      "Bad Request",
      "Rejection reason is required"
    );
  }

  const session = await mongoose.startSession();
  let sessionActive = false;

  try {
    session.startTransaction();
    sessionActive = true;

    // Find the name change request
    const nameChangeRequest = await NameChange.findById(nameChangeId).session(
      session
    );

    if (!nameChangeRequest) {
      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      logger.warn("Name change request not found during rejection", {
        adminId,
        requestId,
        nameChangeId,
      });

      return apiResponse.notFound(res, "Name change request not found");
    }

    // Check if request is already processed
    if (nameChangeRequest.status !== "pending_review") {
      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      logger.warn("Name change request already processed", {
        adminId,
        requestId,
        nameChangeId,
        currentStatus: nameChangeRequest.status,
      });

      return apiResponse.badRequest(
        res,
        "Bad Request",
        "This name change request has already been processed"
      );
    }

    // Update name change request
    nameChangeRequest.status = "rejected";
    nameChangeRequest.reviewedBy = adminId;
    nameChangeRequest.reviewDate = new Date();
    nameChangeRequest.completedDate = new Date();
    nameChangeRequest.rejectionReason = rejectionReason;
    if (notes) {
      nameChangeRequest.notes = notes;
    }

    await nameChangeRequest.save({ session });

    // Commit transaction
    await session.commitTransaction();
    session.endSession();
    sessionActive = false;

    logger.info("Name change request rejected", {
      adminId,
      requestId,
      nameChangeId,
      userId: nameChangeRequest.userId,
      requestedName: `${nameChangeRequest.requestedFirstName} ${nameChangeRequest.requestedLastName}`,
      rejectionReason,
    });

    return apiResponse.success(
      res,
      200,
      "Name change rejected",
      "Name Change Rejected",
      {
        nameChangeId: nameChangeRequest._id,
        userId: nameChangeRequest.userId,
        rejectionReason,
      }
    );
  } catch (error) {
    logger.error("Error rejecting name change request", {
      adminId,
      requestId,
      nameChangeId,
      error: error.message,
      stack: error.stack,
    });

    // Ensure transaction is aborted if still active
    if (sessionActive) {
      try {
        await session.abortTransaction();
        session.endSession();
        logger.debug("Transaction aborted due to error", { requestId });
      } catch (sessionError) {
        logger.error("Error aborting transaction", {
          requestId,
          error: sessionError.message,
        });
      }
    }

    return apiResponse.error(res, 500, "Failed to reject name change request", {
      errorId: requestId,
    });
  }
};

/**
 * Verify email change request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.verifyEmailChange = async (req, res) => {
  const requestStartTime = Date.now();
  const requestId = req.id;
  const userId = req.user?._id;

  logger.info("Email change verification started", {
    userId,
    requestId,
    endpoint: `${req.method} ${req.originalUrl}`,
  });

  // Track session state
  let sessionActive = false;
  const session = await mongoose.startSession();

  try {
    session.startTransaction();
    sessionActive = true;

    const { emailChangeId, verificationCode } = req.body;

    if (!emailChangeId || !verificationCode) {
      logger.warn("Missing required fields for email verification", {
        userId,
        requestId,
        hasEmailChangeId: !!emailChangeId,
        hasVerificationCode: !!verificationCode,
      });

      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Email change ID and verification code are required"
      );
    }

    // Find the email change request
    const emailChange = await EmailChange.findOne({
      _id: emailChangeId,
      userId,
    }).session(session);

    if (!emailChange) {
      logger.warn("Email change request not found", {
        userId,
        requestId,
        emailChangeId,
      });

      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      return apiResponse.notFound(res, "Email change request not found");
    }

    // Check if already verified
    if (emailChange.isVerified) {
      logger.info("Email already verified", {
        userId,
        requestId,
        emailChangeId,
      });

      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      return apiResponse.success(
        res,
        200,
        "Already verified",
        "This email change has already been verified and is awaiting review",
        { status: emailChange.status }
      );
    }

    // Check if expired
    if (new Date() > emailChange.verificationExpires) {
      logger.warn("Verification code expired", {
        userId,
        requestId,
        emailChangeId,
        expiredAt: emailChange.verificationExpires,
      });

      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Verification code has expired. Please request a new one."
      );
    }

    // Increment attempts counter
    emailChange.verificationAttempts += 1;

    // Check if max attempts reached (5 attempts)
    if (emailChange.verificationAttempts > 5) {
      logger.warn("Max verification attempts reached", {
        userId,
        requestId,
        emailChangeId,
        attempts: emailChange.verificationAttempts,
      });

      emailChange.status = "rejected";
      emailChange.rejectionReason = "Maximum verification attempts exceeded";
      emailChange.completedDate = new Date();
      await emailChange.save({ session });

      await session.commitTransaction();
      session.endSession();
      sessionActive = false;

      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Maximum verification attempts exceeded. Please start a new email change request."
      );
    }

    // Verify code
    if (emailChange.verificationCode !== verificationCode) {
      logger.warn("Invalid verification code", {
        userId,
        requestId,
        emailChangeId,
        attempts: emailChange.verificationAttempts,
      });

      await emailChange.save({ session });

      await session.commitTransaction();
      session.endSession();
      sessionActive = false;

      return apiResponse.badRequest(
        res,
        "Bad Request",
        `Invalid verification code. ${
          5 - emailChange.verificationAttempts
        } attempts remaining.`
      );
    }

    // Code is valid, update the request
    emailChange.isVerified = true;
    emailChange.status = "pending_review";
    await emailChange.save({ session });

    logger.info("Email change verified successfully", {
      userId,
      requestId,
      emailChangeId,
      newStatus: "pending_review",
    });

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();
    sessionActive = false;

    const processingTime = Date.now() - requestStartTime;
    logger.info("Email verification completed", {
      userId,
      requestId,
      processingTime: `${processingTime}ms`,
    });

    return apiResponse.success(
      res,
      200,
      "Email verified successfully",
      "Your email change has been verified and is now awaiting admin review",
      {
        status: "pending_review",
        emailChangeId: emailChange._id,
      }
    );
  } catch (error) {
    logger.error("Email verification critical error", {
      userId,
      requestId,
      error: error.message,
      stack: error.stack,
      errorName: error.name,
      errorCode: error.code,
      processingTime: `${Date.now() - requestStartTime}ms`,
    });

    // Ensure transaction is aborted if still active
    if (sessionActive) {
      try {
        await session.abortTransaction();
        session.endSession();
        logger.debug("Transaction aborted due to error", { requestId });
      } catch (sessionError) {
        logger.error("Error aborting transaction", {
          requestId,
          error: sessionError.message,
        });
      }
    }

    return apiResponse.error(res, 500, "Error verifying email change", {
      errorId: requestId,
    });
  }
};

/**
 * Resend email verification code
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.resendEmailVerification = async (req, res) => {
  const requestStartTime = Date.now();
  const requestId = req.id;
  const userId = req.user?._id;

  logger.info("Resend email verification started", {
    userId,
    requestId,
    endpoint: `${req.method} ${req.originalUrl}`,
  });

  // Track session state
  let sessionActive = false;
  const session = await mongoose.startSession();

  try {
    session.startTransaction();
    sessionActive = true;

    const { emailChangeId } = req.body;

    if (!emailChangeId) {
      logger.warn("Missing email change ID for resend verification", {
        userId,
        requestId,
      });

      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Email change ID is required"
      );
    }

    // Find the email change request
    const emailChange = await EmailChange.findOne({
      _id: emailChangeId,
      userId,
    }).session(session);

    if (!emailChange) {
      logger.warn("Email change request not found for resend", {
        userId,
        requestId,
        emailChangeId,
      });

      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      return apiResponse.notFound(res, "Email change request not found");
    }

    // Check if already verified
    if (emailChange.isVerified) {
      logger.info("Email already verified, cannot resend", {
        userId,
        requestId,
        emailChangeId,
      });

      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      return apiResponse.badRequest(
        res,
        "Bad Request",
        "This email change has already been verified"
      );
    }

    // Check status
    if (emailChange.status !== "pending_verification") {
      logger.warn("Cannot resend verification for non-pending email change", {
        userId,
        requestId,
        emailChangeId,
        currentStatus: emailChange.status,
      });

      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      return apiResponse.badRequest(
        res,
        "Bad Request",
        `Cannot resend verification code for email change with status: ${emailChange.status}`
      );
    }

    // Generate new verification code
    const newVerificationCode = Math.floor(
      100000 + Math.random() * 900000
    ).toString();
    const newExpiration = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Reset attempts counter
    emailChange.verificationCode = newVerificationCode;
    emailChange.verificationExpires = newExpiration;
    emailChange.verificationAttempts = 0;

    await emailChange.save({ session });

    // Fetch user information
    const user = await User.findById(userId).session(session);

    // Send verification email using Brevo service
    try {
      await sendEmailChangeVerification({
        to: emailChange.requestedEmail,
        name: `${user.firstName} ${user.lastName}`,
        verificationCode: newVerificationCode,
        requestId,
      });

      logger.debug("Email change verification resent", {
        userId,
        requestId,
        emailChangeId,
        sentTo: emailChange.requestedEmail,
      });
    } catch (emailError) {
      logger.error("Failed to resend email verification", {
        userId,
        requestId,
        error: emailError.message,
      });

      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      return apiResponse.error(res, 500, "Failed to send verification email", {
        errorId: requestId,
      });
    }

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();
    sessionActive = false;

    const processingTime = Date.now() - requestStartTime;
    logger.info("Email verification resent successfully", {
      userId,
      requestId,
      processingTime: `${processingTime}ms`,
    });

    return apiResponse.success(
      res,
      200,
      "Verification code resent successfully",
      "A new verification code has been sent to your email",
      {
        emailChangeId: emailChange._id,
        expiresAt: newExpiration,
      }
    );
  } catch (error) {
    logger.error("Resend verification critical error", {
      userId,
      requestId,
      error: error.message,
      stack: error.stack,
      errorName: error.name,
      errorCode: error.code,
      processingTime: `${Date.now() - requestStartTime}ms`,
    });

    // Ensure transaction is aborted if still active
    if (sessionActive) {
      try {
        await session.abortTransaction();
        session.endSession();
        logger.debug("Transaction aborted due to error", { requestId });
      } catch (sessionError) {
        logger.error("Error aborting transaction", {
          requestId,
          error: sessionError.message,
        });
      }
    }

    return apiResponse.error(res, 500, "Error resending verification code", {
      errorId: requestId,
    });
  }
};

/**
 * Get all email change requests for admin review
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getEmailChangeRequests = async (req, res) => {
  const requestId = req.id;
  const adminId = req.user?._id;

  logger.info("Admin retrieving email change requests", {
    adminId,
    requestId,
    endpoint: `${req.method} ${req.originalUrl}`,
  });

  try {
    // Extract query parameters
    const {
      status,
      page = 1,
      limit = 10,
      sortBy = "requestDate",
      sortOrder = "desc",
    } = req.query;

    // Build filter
    const filter = {};
    if (status) {
      filter.status = status;
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build sort options
    const sort = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;

    // Query with pagination and populate user details
    const emailChanges = await EmailChange.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .populate("userId", "firstName lastName email")
      .populate("reviewedBy", "firstName lastName email");

    // Get total count for pagination
    const totalCount = await EmailChange.countDocuments(filter);

    // Calculate total pages
    const totalPages = Math.ceil(totalCount / parseInt(limit));

    logger.info("Email change requests retrieved successfully", {
      adminId,
      requestId,
      count: emailChanges.length,
      totalCount,
      page,
      totalPages,
    });

    return apiResponse.success(
      res,
      200,
      "Email change requests retrieved successfully",
      "Email change requests retrieved successfully",
      {
        data: emailChanges,
        pagination: {
          totalCount,
          totalPages,
          currentPage: parseInt(page),
          pageSize: parseInt(limit),
        },
      }
    );
  } catch (error) {
    logger.error("Error retrieving email change requests", {
      adminId,
      requestId,
      error: error.message,
      stack: error.stack,
    });

    return apiResponse.error(
      res,
      500,
      "Error retrieving email change requests",
      {
        errorId: requestId,
      }
    );
  }
};

/**
 * Get a specific email change request details
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getEmailChangeById = async (req, res) => {
  const requestId = req.id;
  const adminId = req.user?._id;
  const { emailChangeId } = req.params;

  logger.info("Admin retrieving specific email change request", {
    adminId,
    requestId,
    emailChangeId,
    endpoint: `${req.method} ${req.originalUrl}`,
  });

  try {
    const emailChange = await EmailChange.findById(emailChangeId)
      .populate("userId", "firstName lastName email phone")
      .populate("reviewedBy", "firstName lastName email");

    if (!emailChange) {
      logger.warn("Email change request not found", {
        adminId,
        requestId,
        emailChangeId,
      });

      return apiResponse.notFound(res, "Email change request not found");
    }

    logger.info("Email change request details retrieved", {
      adminId,
      requestId,
      emailChangeId,
      status: emailChange.status,
    });

    return apiResponse.success(
      res,
      200,
      "Email change request details retrieved successfully",
      "Email change request details retrieved successfully",
      { data: emailChange }
    );
  } catch (error) {
    logger.error("Error retrieving email change request details", {
      adminId,
      requestId,
      emailChangeId,
      error: error.message,
      stack: error.stack,
    });

    return apiResponse.error(
      res,
      500,
      "Error retrieving email change request details",
      {
        errorId: requestId,
      }
    );
  }
};

/**
 * Approve an email change request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.approveEmailChange = async (req, res) => {
  const requestStartTime = Date.now();
  const requestId = req.id;
  const adminId = req.user?._id;
  const { emailChangeId } = req.params;
  const { notes } = req.body;

  logger.info("Admin approving email change request", {
    adminId,
    requestId,
    emailChangeId,
    endpoint: `${req.method} ${req.originalUrl}`,
  });

  // Track session state
  let sessionActive = false;
  const session = await mongoose.startSession();

  try {
    session.startTransaction();
    sessionActive = true;

    // Find the email change request
    const emailChange = await EmailChange.findById(emailChangeId).session(
      session
    );

    if (!emailChange) {
      logger.warn("Email change request not found for approval", {
        adminId,
        requestId,
        emailChangeId,
      });

      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      return apiResponse.notFound(res, "Email change request not found");
    }

    // Check if already processed
    if (
      emailChange.status === "approved" ||
      emailChange.status === "rejected"
    ) {
      logger.warn("Email change request already processed", {
        adminId,
        requestId,
        emailChangeId,
        currentStatus: emailChange.status,
      });

      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      return apiResponse.badRequest(
        res,
        "Bad Request",
        `This email change request has already been ${emailChange.status}`
      );
    }

    // Check if it's verified
    if (!emailChange.isVerified) {
      logger.warn("Cannot approve unverified email change", {
        adminId,
        requestId,
        emailChangeId,
        isVerified: emailChange.isVerified,
      });

      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Cannot approve an unverified email change request"
      );
    }

    // Get the user
    const user = await User.findById(emailChange.userId).session(session);

    if (!user) {
      logger.warn("User not found for email change approval", {
        adminId,
        requestId,
        emailChangeId,
        userId: emailChange.userId,
      });

      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      return apiResponse.notFound(res, "User not found");
    }

    // Update email change request
    emailChange.status = "approved";
    emailChange.reviewedBy = adminId;
    emailChange.reviewDate = new Date();
    emailChange.completedDate = new Date();
    if (notes) {
      emailChange.notes = notes;
    }

    await emailChange.save({ session });

    // Update user's email
    const previousEmail = user.email;
    user.email = emailChange.requestedEmail;
    await user.save({ session });

    logger.info("Email change approved and user updated", {
      adminId,
      requestId,
      emailChangeId,
      userId: user._id,
      previousEmail,
      newEmail: emailChange.requestedEmail,
    });

    // Send confirmation emails to both old and new email addresses using Brevo
    try {
      // Send confirmation to old email
      await sendEmailChangeConfirmation({
        to: previousEmail,
        name: `${user.firstName} ${user.lastName}`,
        newEmail: emailChange.requestedEmail,
        requestId,
      });

      // Send confirmation to new email
      await sendEmailChangeConfirmation({
        to: emailChange.requestedEmail,
        name: `${user.firstName} ${user.lastName}`,
        newEmail: emailChange.requestedEmail,
        requestId,
      });

      // Log successful email sending
      logger.debug("Email change confirmation emails sent", {
        adminId,
        requestId,
        emailChangeId,
        sentToOld: previousEmail,
        sentToNew: emailChange.requestedEmail,
      });

      // Send security alert about email change
      await sendSecurityAlert({
        to: emailChange.requestedEmail,
        name: `${user.firstName} ${user.lastName}`,
        alertType: "email_change",
        details: {
          previous_email: previousEmail,
          new_email: emailChange.requestedEmail,
          timestamp: new Date().toISOString(),
          ip_address: req.ip || "Unknown",
          location: req.headers["x-location"] || "Unknown",
          device: req.headers["user-agent"] || "Unknown",
        },
        requestId,
      });
    } catch (emailError) {
      // Log error but continue with the transaction
      logger.error("Failed to send confirmation emails", {
        adminId,
        requestId,
        error: emailError.message,
        stack: emailError.stack,
      });
    }

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();
    sessionActive = false;

    const processingTime = Date.now() - requestStartTime;
    logger.info("Email change approval completed", {
      adminId,
      requestId,
      processingTime: `${processingTime}ms`,
    });

    return apiResponse.success(
      res,
      200,
      "Email change approved successfully",
      "Email change has been approved and user's email has been updated",
      {
        emailChangeId: emailChange._id,
        userId: user._id,
        newEmail: emailChange.requestedEmail,
      }
    );
  } catch (error) {
    logger.error("Email change approval critical error", {
      adminId,
      requestId,
      emailChangeId,
      error: error.message,
      stack: error.stack,
      errorName: error.name,
      errorCode: error.code,
      processingTime: `${Date.now() - requestStartTime}ms`,
    });

    // Ensure transaction is aborted if still active
    if (sessionActive) {
      try {
        await session.abortTransaction();
        session.endSession();
        logger.debug("Transaction aborted due to error", { requestId });
      } catch (sessionError) {
        logger.error("Error aborting transaction", {
          requestId,
          error: sessionError.message,
        });
      }
    }

    return apiResponse.error(res, 500, "Error approving email change", {
      errorId: requestId,
    });
  }
};

/**
 * Reject an email change request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.rejectEmailChange = async (req, res) => {
  const requestStartTime = Date.now();
  const requestId = req.id;
  const adminId = req.user?._id;
  const { emailChangeId } = req.params;
  const { rejectionReason, notes } = req.body;

  logger.info("Admin rejecting email change request", {
    adminId,
    requestId,
    emailChangeId,
    endpoint: `${req.method} ${req.originalUrl}`,
  });

  if (!rejectionReason) {
    logger.warn("Rejection reason is required", {
      adminId,
      requestId,
      emailChangeId,
    });

    return apiResponse.badRequest(
      res,
      "Bad Request",
      "Rejection reason is required"
    );
  }

  // Track session state
  let sessionActive = false;
  const session = await mongoose.startSession();

  try {
    session.startTransaction();
    sessionActive = true;

    // Find the email change request
    const emailChange = await EmailChange.findById(emailChangeId).session(
      session
    );

    if (!emailChange) {
      logger.warn("Email change request not found for rejection", {
        adminId,
        requestId,
        emailChangeId,
      });

      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      return apiResponse.notFound(res, "Email change request not found");
    }

    // Check if already processed
    if (
      emailChange.status === "approved" ||
      emailChange.status === "rejected"
    ) {
      logger.warn("Email change request already processed", {
        adminId,
        requestId,
        emailChangeId,
        currentStatus: emailChange.status,
      });

      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      return apiResponse.badRequest(
        res,
        "Bad Request",
        `This email change request has already been ${emailChange.status}`
      );
    }

    // Get the user
    const user = await User.findById(emailChange.userId).session(session);

    if (!user) {
      logger.warn("User not found for email change rejection", {
        adminId,
        requestId,
        emailChangeId,
        userId: emailChange.userId,
      });

      await session.abortTransaction();
      session.endSession();
      sessionActive = false;

      return apiResponse.notFound(res, "User not found");
    }

    // Update email change request
    emailChange.status = "rejected";
    emailChange.rejectionReason = rejectionReason;
    emailChange.reviewedBy = adminId;
    emailChange.reviewDate = new Date();
    emailChange.completedDate = new Date();

    if (notes) {
      emailChange.notes = notes;
    }

    await emailChange.save({ session });

    logger.info("Email change rejected", {
      adminId,
      requestId,
      emailChangeId,
      userId: user._id,
      rejectionReason,
    });

    // Send rejection notification emails using Brevo
    try {
      // Send to current email
      await sendEmailChangeRejection({
        to: user.email, // Send to current email
        name: `${user.firstName} ${user.lastName}`,
        requestedEmail: emailChange.requestedEmail,
        rejectionReason,
        requestId,
      });

      // Also send notification to the requested email if it was verified
      if (emailChange.isVerified) {
        await sendEmailChangeRejection({
          to: emailChange.requestedEmail,
          name: `${user.firstName} ${user.lastName}`,
          requestedEmail: emailChange.requestedEmail,
          rejectionReason,
          requestId,
        });
      }

      logger.debug("Email change rejection notifications sent", {
        adminId,
        requestId,
        emailChangeId,
        sentToEmail: user.email,
        sentToRequestedEmail: emailChange.isVerified
          ? emailChange.requestedEmail
          : null,
      });
    } catch (emailError) {
      // Log error but continue with the transaction
      logger.error("Failed to send rejection notification", {
        adminId,
        requestId,
        error: emailError.message,
        stack: emailError.stack,
      });
    }

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();
    sessionActive = false;

    const processingTime = Date.now() - requestStartTime;
    logger.info("Email change rejection completed", {
      adminId,
      requestId,
      processingTime: `${processingTime}ms`,
    });

    return apiResponse.success(
      res,
      200,
      "Email change rejected successfully",
      "Email change request has been rejected",
      {
        emailChangeId: emailChange._id,
        userId: user._id,
        rejectionReason,
      }
    );
  } catch (error) {
    logger.error("Email change rejection critical error", {
      adminId,
      requestId,
      emailChangeId,
      error: error.message,
      stack: error.stack,
      errorName: error.name,
      errorCode: error.code,
      processingTime: `${Date.now() - requestStartTime}ms`,
    });

    // Ensure transaction is aborted if still active
    if (sessionActive) {
      try {
        await session.abortTransaction();
        session.endSession();
        logger.debug("Transaction aborted due to error", { requestId });
      } catch (sessionError) {
        logger.error("Error aborting transaction", {
          requestId,
          error: sessionError.message,
        });
      }
    }

    return apiResponse.error(res, 500, "Error rejecting email change", {
      errorId: requestId,
    });
  }
};

/**
 * Get email change statistics for admin dashboard
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getEmailChangeStats = async (req, res) => {
  const requestId = req.id;
  const adminId = req.user?._id;

  logger.info("Admin retrieving email change statistics", {
    adminId,
    requestId,
    endpoint: `${req.method} ${req.originalUrl}`,
  });

  try {
    // Get range parameters
    const { startDate, endDate } = req.query;

    // Build date filter
    const dateFilter = {};
    if (startDate) {
      dateFilter.createdAt = { $gte: new Date(startDate) };
    }

    if (endDate) {
      dateFilter.createdAt = {
        ...dateFilter.createdAt,
        $lte: new Date(endDate),
      };
    }

    // Get counts by status
    const totalRequests = await EmailChange.countDocuments(dateFilter);
    const pendingVerification = await EmailChange.countDocuments({
      ...dateFilter,
      status: "pending_verification",
    });
    const pendingReview = await EmailChange.countDocuments({
      ...dateFilter,
      status: "pending_review",
    });
    const approved = await EmailChange.countDocuments({
      ...dateFilter,
      status: "approved",
    });
    const rejected = await EmailChange.countDocuments({
      ...dateFilter,
      status: "rejected",
    });

    // Get verification stats
    const verified = await EmailChange.countDocuments({
      ...dateFilter,
      isVerified: true,
    });
    const unverified = await EmailChange.countDocuments({
      ...dateFilter,
      isVerified: false,
    });

    // Calculate average processing time for completed requests (time between request and completion)
    const completedRequests = await EmailChange.find({
      ...dateFilter,
      status: { $in: ["approved", "rejected"] },
      completedDate: { $exists: true },
    });

    let avgProcessingTime = 0;
    if (completedRequests.length > 0) {
      const totalProcessingTime = completedRequests.reduce((sum, request) => {
        return sum + (request.completedDate - request.requestDate);
      }, 0);
      avgProcessingTime =
        totalProcessingTime / completedRequests.length / (1000 * 60 * 60); // in hours
    }

    // Get recent email change trend (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const dailyStats = await EmailChange.aggregate([
      {
        $match: {
          createdAt: { $gte: sevenDaysAgo },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
            day: { $dayOfMonth: "$createdAt" },
          },
          count: { $sum: 1 },
        },
      },
      {
        $sort: {
          "_id.year": 1,
          "_id.month": 1,
          "_id.day": 1,
        },
      },
    ]);

    // Format the daily stats
    const trendData = dailyStats.map((stat) => {
      const date = new Date(stat._id.year, stat._id.month - 1, stat._id.day);
      return {
        date: date.toISOString().split("T")[0],
        count: stat.count,
      };
    });

    // Compile statistics
    const statistics = {
      summary: {
        totalRequests,
        pendingVerification,
        pendingReview,
        approved,
        rejected,
        verified,
        unverified,
      },
      performance: {
        avgProcessingTimeHours: parseFloat(avgProcessingTime.toFixed(2)),
        completedCount: completedRequests.length,
      },
      trend: trendData,
    };

    logger.info("Email change statistics retrieved successfully", {
      adminId,
      requestId,
      totalRequests,
      pendingReview,
    });

    return apiResponse.success(
      res,
      200,
      "Email change statistics retrieved successfully",
      "Email change statistics retrieved successfully",
      statistics
    );
  } catch (error) {
    logger.error("Error retrieving email change statistics", {
      adminId,
      requestId,
      error: error.message,
      stack: error.stack,
    });

    return apiResponse.error(
      res,
      500,
      "Error retrieving email change statistics",
      {
        errorId: requestId,
      }
    );
  }
};

/**
 * Get user dashboard data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getDashboard = async (req, res) => {
  try {
    // Get user with populated data
    const user = await User.findById(req.user._id)
      .populate({
        path: "accounts",
        select: "type name bank availableBalance ledgerBalance status",
        match: { status: "active" },
      })
      .populate({
        path: "cards",
        select: "type name bank brand last4 availableBalance status",
        match: { status: "active" },
      })
      .populate({
        path: "wallets",
        select: "currency balance name status",
        match: { status: "active" },
      })
      .populate({
        path: "bills",
        select: "title customName amount dueDate status provider",
        match: { status: { $in: ["pending", "overdue"] } },
        options: { sort: { dueDate: 1 }, limit: 5 },
      });

    if (!user) {
      return apiResponse.notFound(res, "User not found");
    }

    // Get total balance across all accounts
    const totalAccountBalance = user.accounts.reduce(
      (total, account) => total + account.availableBalance,
      0
    );

    // Get total balance across all cards
    const totalCardBalance = user.cards.reduce(
      (total, card) => total + card.availableBalance,
      0
    );

    // Get upcoming bills
    const upcomingBills = user.bills.slice(0, 3);

    // Get user investments
    const investments = await user.populate({
      path: "investments",
      select: "plan investedAmount currentValue status",
      populate: {
        path: "plan",
        select: "name symbol roi",
      },
      match: { status: "active" },
      options: { limit: 5 },
    });

    // Calculate total invested and current value
    const totalInvested = investments.investments
      ? investments.investments.reduce(
          (total, inv) => total + inv.investedAmount,
          0
        )
      : 0;

    const totalInvestmentValue = investments.investments
      ? investments.investments.reduce(
          (total, inv) => total + inv.currentValue,
          0
        )
      : 0;

    // Get recent transactions
    const Transaction = require("../models/Transaction");
    const recentTransactions = await Transaction.find({
      user: req.user._id,
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("sourceId", "name bank type currency")
      .populate("destinationId", "name bank type currency");

    logger.info("User dashboard retrieved", {
      userId: user._id,
      requestId: req.id,
    });

    return apiResponse.success(
      res,
      200,
      "Dashboard data retrieved successfully",
      {
        accounts: {
          count: user.accounts.length,
          totalBalance: totalAccountBalance,
          list: user.accounts,
        },
        cards: {
          count: user.cards.length,
          totalBalance: totalCardBalance,
          list: user.cards,
        },
        wallets: {
          count: user.wallets.length,
          list: user.wallets,
        },
        bills: {
          upcoming: upcomingBills,
          count: user.bills.length,
        },
        investments: {
          totalInvested,
          totalValue: totalInvestmentValue,
          profit: totalInvestmentValue - totalInvested,
          list: investments.investments || [],
        },
        recentTransactions,
      }
    );
  } catch (error) {
    logger.error("Error retrieving dashboard data", {
      userId: req.user._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(res, 500, "Error retrieving dashboard data");
  }
};

/**
 * Get user KYC status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getKycStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("kycStatus");

    if (!user) {
      return apiResponse.notFound(res, "User not found");
    }

    return apiResponse.success(res, 200, "KYC status retrieved successfully", {
      kycStatus: user.kycStatus,
    });
  } catch (error) {
    logger.error("Error retrieving KYC status", {
      userId: req.user._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(res, 500, "Error retrieving KYC status");
  }
};

/**
 * Update user KYC information
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updateKyc = async (req, res) => {
  try {
    const { dateOfBirth, ssn, address } = req.body;

    const user = await User.findById(req.user._id);

    if (!user) {
      return apiResponse.notFound(res, "User not found");
    }

    // Store KYC information
    if (dateOfBirth) user.dateOfBirth = dateOfBirth;
    if (ssn) user.ssn = ssn;
    if (address) user.address = address;

    // Update KYC status if not already verified
    if (user.kycStatus !== "verified") {
      user.kycStatus = "pending";
    }

    await user.save();

    logger.info("User KYC information updated", {
      userId: user._id,
      kycStatus: user.kycStatus,
      requestId: req.id,
    });

    return apiResponse.updated(res, "KYC information updated successfully", {
      kycStatus: user.kycStatus,
    });
  } catch (error) {
    logger.error("Error updating KYC information", {
      userId: req.user._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(res, 500, "Error updating KYC information");
  }
};

/**
 * Get user activity log
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getActivityLog = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    // Aggregate device activity, login history, transaction history
    const Transaction = require("../models/Transaction");
    const RefreshToken = require("../models/RefreshToken");

    // Get recent logins
    const logins = await RefreshToken.find({
      user: req.user._id,
    })
      .sort({ issuedAt: -1 })
      .limit(10)
      .select("issuedAt ipAddress userAgent device");

    // Get transaction history
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const transactions = await Transaction.find({
      user: req.user._id,
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select("type amount status createdAt description reference");

    // Get count of transactions for pagination
    const total = await Transaction.countDocuments({
      user: req.user._id,
    });

    const totalPages = Math.ceil(total / parseInt(limit));

    logger.info("User activity log retrieved", {
      userId: req.user._id,
      requestId: req.id,
    });

    return apiResponse.success(
      res,
      200,
      "Activity log retrieved successfully",
      {
        logins,
        transactions,
      },
      apiResponse.paginationMeta(
        total,
        parseInt(page),
        parseInt(limit),
        totalPages
      )
    );
  } catch (error) {
    logger.error("Error retrieving activity log", {
      userId: req.user._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(res, 500, "Error retrieving activity log");
  }
};

/**
 * Enable MFA
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.enableMfa = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return apiResponse.notFound(res, "User not found");
    }

    // Check if MFA is already enabled
    if (user.mfaEnabled) {
      return apiResponse.badRequest(res, "MFA is already enabled");
    }

    // Generate MFA secret and QR code
    // This is simplified - in a real implementation, you would use a library like speakeasy
    const mfaSecret = Math.random().toString(36).substring(2, 15);

    // Store MFA secret temporarily in pendingUpdates
    user.pendingUpdates = {
      mfaSecret,
    };

    await user.save();

    logger.info("MFA setup initiated", {
      userId: user._id,
      requestId: req.id,
    });

    return apiResponse.success(res, 200, "MFA setup initiated", {
      mfaSecret,
    });
  } catch (error) {
    logger.error("Error enabling MFA", {
      userId: req.user._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(res, 500, "Error enabling MFA");
  }
};

/**
 * Verify MFA setup
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.verifyMfa = async (req, res) => {
  try {
    const { code } = req.body;

    const user = await User.findById(req.user._id);

    if (!user) {
      return apiResponse.notFound(res, "User not found");
    }

    // Check if MFA setup is in progress
    if (!user.pendingUpdates || !user.pendingUpdates.mfaSecret) {
      return apiResponse.badRequest(res, "MFA setup not initiated");
    }

    // Verify MFA code
    // In a real implementation, you would use a library like speakeasy to verify the code
    const isValid = code === "123456"; // Simplified example

    if (!isValid) {
      logger.warn("Invalid MFA verification code", {
        userId: user._id,
        requestId: req.id,
      });

      return apiResponse.badRequest(res, "Invalid verification code");
    }

    // Enable MFA
    user.mfaEnabled = true;
    // In a real implementation, you would store the MFA secret securely
    user.pendingUpdates = {};

    await user.save();

    logger.info("MFA enabled", {
      userId: user._id,
      requestId: req.id,
    });

    return apiResponse.success(res, 200, "MFA enabled successfully");
  } catch (error) {
    logger.error("Error verifying MFA", {
      userId: req.user._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(res, 500, "Error verifying MFA");
  }
};

/**
 * Disable MFA
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.disableMfa = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return apiResponse.notFound(res, "User not found");
    }

    // Check if MFA is already disabled
    if (!user.mfaEnabled) {
      return apiResponse.badRequest(res, "MFA is already disabled");
    }

    // Disable MFA
    user.mfaEnabled = false;

    await user.save();

    logger.info("MFA disabled", {
      userId: user._id,
      requestId: req.id,
    });

    return apiResponse.success(res, 200, "MFA disabled successfully");
  } catch (error) {
    logger.error("Error disabling MFA", {
      userId: req.user._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(res, 500, "Error disabling MFA");
  }
};
