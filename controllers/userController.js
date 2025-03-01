const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const validator = require("validator");
const crypto = require("crypto");
const ValidationError = require("../utils/validationError");
const CustomError = require("../utils/customError");
const logger = require("../utils/logger");
const User = require("../models/user");
const Account = require("../models/account");
const Card = require("../models/card");
const { sendVerificationEmail } = require("../utils/emailService");

const DEFAULT_PRODUCT = "account";
const PROTECTED_FIELDS = [
  "ssn",
  "_id",
  "accounts",
  "cards",
  "bills",
  "transactionHistory",
  "passcodeHash", // Added passcodeHash to protected fields
];

// Password validation
const validatePassword = (password) => {
  const passwordRegex =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  return passwordRegex.test(password);
};

// Passcode validation
const validatePasscode = (passcode) => {
  // Passcode must be at least 4 characters
  return passcode.length >= 4;
};

// Authenticated user updating password (from within app)
const updatePasswordAuthenticated = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user._id; // From auth middleware

    if (!currentPassword || !newPassword) {
      throw new CustomError(
        400,
        "Current password and new password are required"
      );
    }

    // Validate new password
    if (!validatePassword(newPassword)) {
      throw new ValidationError([
        {
          field: "newPassword",
          message:
            "Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character",
          code: "INVALID_PASSWORD",
        },
      ]);
    }

    // Get user with current password
    const user = await User.findById(userId).select("+password");

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      throw new CustomError(401, "Current password is incorrect");
    }

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const tokenExpiry = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    // Store pending password update
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    await User.findByIdAndUpdate(userId, {
      "pendingUpdates.token": verificationToken,
      "pendingUpdates.expiry": tokenExpiry,
      "pendingUpdates.fields": [
        {
          field: "password",
          value: hashedNewPassword,
        },
      ],
    }).session(session);

    // Send verification email
    await sendVerificationEmail(user.email, verificationToken, ["password"]);

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      status: "success",
      message: "Check your email to verify password update",
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    next(error);
  }
};

// Unauthenticated password reset (forgot password)
const initiatePasswordReset = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      throw new CustomError(400, "Email is required");
    }

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      // Don't reveal if email exists or not
      return res.status(200).json({
        status: "success",
        message:
          "If an account exists with this email, you will receive password reset instructions",
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString("hex");
    const tokenExpiry = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    // Store reset token
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpiry = tokenExpiry;
    await user.save();

    // Send reset email
    await sendVerificationEmail(email, resetToken, ["password reset"]);

    res.status(200).json({
      status: "success",
      message:
        "If an account exists with this email, you will receive password reset instructions",
    });
  } catch (error) {
    next(error);
  }
};

// Complete unauthenticated password reset
const completePasswordReset = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      throw new CustomError(400, "Token and new password are required");
    }

    // Validate new password
    if (!validatePassword(newPassword)) {
      throw new ValidationError([
        {
          field: "newPassword",
          message:
            "Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character",
          code: "INVALID_PASSWORD",
        },
      ]);
    }

    // Find user with valid reset token
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpiry: { $gt: new Date() },
    }).session(session);

    if (!user) {
      throw new CustomError(400, "Invalid or expired reset token");
    }

    // Update password and clear reset token
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpiry = undefined;
    await user.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      status: "success",
      message: "Password has been reset successfully",
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    next(error);
  }
};

// Validate update data
const validateUpdateData = (updateData) => {
  const errors = [];

  // Validate email if provided
  if (updateData.email && !validator.isEmail(updateData.email)) {
    errors.push({
      field: "email",
      message: "Invalid email format",
      code: "INVALID_EMAIL",
    });
  }

  // Validate password if provided
  if (updateData.password && !validatePassword(updateData.password)) {
    errors.push({
      field: "password",
      message:
        "Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character",
      code: "INVALID_PASSWORD",
    });
  }

  // Validate passcode if provided
  if (updateData.passcode && !validatePasscode(updateData.passcode)) {
    errors.push({
      field: "passcode",
      message: "Passcode must be at least 4 characters",
      code: "INVALID_PASSCODE",
    });
  }

  // Other validations remain the same...
  if (updateData.phone) {
    const cleanPhone = updateData.phone.replace(/\D/g, "");
    if (cleanPhone.length !== 10) {
      errors.push({
        field: "phone",
        message: "Phone number must be 10 digits",
        code: "INVALID_PHONE_LENGTH",
      });
    }
  }

  return errors;
};

const validateUserInput = (userData) => {
  const errors = [];
  const { firstName, lastName, email, phone, password, ssn } = userData;

  const requiredFields = {
    firstName: "First name is required",
    lastName: "Last name is required",
    email: "Email is required",
    phone: "Phone number is required",
    password: "Password is required",
    ssn: "SSN is required",
  };

  Object.entries(requiredFields).forEach(([field, message]) => {
    if (!userData[field]) {
      errors.push({
        field,
        message,
        code: "FIELD_REQUIRED",
      });
    }
  });

  if (errors.length > 0) {
    return errors;
  }

  if (!validator.isEmail(email)) {
    errors.push({
      field: "email",
      message: "Invalid email format",
      value: email,
      code: "INVALID_EMAIL",
    });
  }

  const cleanPhone = phone.replace(/\D/g, "");

  if (cleanPhone.length !== 10) {
    errors.push({
      field: "phone",
      message: "Phone number must be 10 digits",
      value: phone,
      code: "INVALID_PHONE_LENGTH",
    });
  } else if (!/^\d{10}$/.test(cleanPhone)) {
    errors.push({
      field: "phone",
      message: "Phone number must contain only digits",
      value: phone,
      code: "INVALID_PHONE_FORMAT",
    });
  }

  const passwordRegex =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

  if (!passwordRegex.test(password)) {
    errors.push({
      field: "password",
      message:
        "Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character",
      code: "INVALID_PASSWORD",
    });
  }

  const cleanSSN = ssn.replace(/\D/g, "");

  if (!/^\d{9}$/.test(cleanSSN)) {
    errors.push({
      field: "ssn",
      message: "Invalid SSN format",
      code: "INVALID_SSN",
    });
  }

  return errors;
};

const createUser = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Validate input
    const validationErrors = validateUserInput(req.body);
    if (validationErrors.length > 0) {
      throw new ValidationError(validationErrors, req.body);
    }

    let { firstName, lastName, username, email, phone, password, ssn } =
      req.body;

    // Sanitize inputs
    firstName = validator.escape(firstName.trim());
    lastName = validator.escape(lastName.trim());
    email = email.toLowerCase().trim();
    phone = phone
      .replace(/\D/g, "")
      .replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3");
    ssn = ssn.replace(/\D/g, "").replace(/(\d{3})(\d{2})(\d{4})/, "$1-$2-$3");

    // Generate username if not provided
    username = username
      ? validator.escape(username.trim())
      : await User.generateUsername();

    // Check for existing user - use the session here
    const existingUser = await User.findOne({
      $or: [
        { email: { $regex: new RegExp(`^${email}$`, "i") } },
        { phone },
        { username: { $regex: new RegExp(`^${username}$`, "i") } },
      ],
    }).session(session);

    if (existingUser) {
      await session.abortTransaction();
      session.endSession();

      const duplicateErrors = [];
      if (existingUser.email.toLowerCase() === email.toLowerCase()) {
        duplicateErrors.push({
          field: "email",
          message: "Email already exists",
          code: "DUPLICATE_EMAIL",
        });
      }
      if (existingUser.phone === phone) {
        duplicateErrors.push({
          field: "phone",
          message: "Phone number already exists",
          code: "DUPLICATE_PHONE",
        });
      }
      if (existingUser.username.toLowerCase() === username.toLowerCase()) {
        duplicateErrors.push({
          field: "username",
          message: "Username already exists",
          code: "DUPLICATE_USERNAME",
        });
      }
      throw new ValidationError(duplicateErrors, req.body);
    }

    // Hash sensitive data
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create initial user instance without references
    const user = new User({
      firstName,
      lastName,
      username,
      email,
      phone,
      ssn,
      password: hashedPassword,
      accounts: [], // Initialize empty arrays
      cards: [],
    });

    // Save the initial user - use the session
    await user.save({ session });

    // Create default product based on type
    const productType = req.body.default || DEFAULT_PRODUCT;

    // Create the default account with the session
    const defaultProduct = await Account.createDefaultAccount(user, session);

    // Update user with the product reference
    await User.findByIdAndUpdate(
      user._id,
      { $push: { accounts: defaultProduct._id } },
      { session, new: true }
    );

    // Commit transaction and end session
    await session.commitTransaction();
    session.endSession();

    // Prepare response - fetch fresh user data
    const updatedUser = await User.findById(user._id)
      .populate("accounts")
      .lean();

    // Remove sensitive data
    delete updatedUser.password;
    delete updatedUser.ssn;

    res.status(201).json({
      status: "success",
      message: "User created successfully",
      data: {
        user: updatedUser,
        defaultProduct,
      },
    });

    logger.info("User created successfully", {
      userId: user._id,
      email: user.email,
      productType,
      productId: defaultProduct._id,
    });
  } catch (error) {
    // Only abort if transaction hasn't been committed
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    if (error instanceof ValidationError) {
      next(error);
    } else if (error instanceof CustomError) {
      next(error);
    } else {
      logger.error("Unexpected error during user creation:", {
        error: error.message,
        stack: error.stack,
      });
      next(
        new CustomError(500, "An unexpected error occurred while creating user")
      );
    }
  }
};

const getAllUsers = async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      logger.error("Database connection not ready", {
        connectionState: mongoose.connection.readyState,
        requestId: req.requestId,
      });
      throw new CustomError(503, "Database connection not available");
    }

    // Add timeout option to the query
    const users = await User.find(
      {},
      {
        password: 0,
        ssn: 0,
        passcodeHash: 0,
      }
    )
      .populate({
        path: "accounts",
        select: "-transactions -zelle -cashApp -venmo -paypal",
        options: { maxTimeMS: 5000 }, // 5 second timeout for population
      })
      .populate({
        path: "cards",
        select: "-transactions -zelle -cashApp -venmo -paypal",
        options: { maxTimeMS: 5000 },
      })
      .lean()
      .maxTimeMS(5000); // 5 second timeout for main query

    // Process the response
    const processedUsers = users.map((user) => ({
      ...user,
      cards: user.cards?.map((card) => ({
        ...card,
        number: card.number ? `****-****-****-${card.number.slice(-4)}` : null,
      })),
      hasPasscode: !!user.passcodeHash,
    }));

    logger.info("Users retrieved successfully", {
      count: users.length,
      requestId: req.requestId,
    });

    res.status(200).json({
      status: "success",
      message: "Users retrieved successfully",
      data: {
        count: processedUsers.length,
        users: processedUsers,
      },
    });
  } catch (error) {
    logger.error("Error retrieving users:", {
      errorName: error.name,
      errorMessage: error.message,
      connectionState: mongoose.connection.readyState,
      stack: error.stack,
      requestId: req.requestId,
    });

    if (
      error.name === "MongooseError" &&
      error.message.includes("buffering timed out")
    ) {
      return next(new CustomError(503, "Database operation timed out"));
    }
    if (error.name === "MissingSchemaError") {
      return next(new CustomError(500, "Database schema configuration error"));
    }
    if (error instanceof CustomError) {
      return next(error);
    }

    next(new CustomError(500, "An error occurred while retrieving users"));
  }
};

const updateUser = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId } = req.params;
    const updateData = { ...req.body };
    const secureFieldsToUpdate = [];

    // Check if user exists
    const existingUser = await User.findById(userId).session(session);
    if (!existingUser) {
      throw new CustomError(404, "User not found");
    }

    // Handle password updates
    if (updateData.password) {
      // Remove password from immediate update
      const { password, ...immediateUpdates } = updateData;

      // Create verification token
      const verificationToken = crypto.randomBytes(32).toString("hex");
      const tokenExpiry = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

      // Store pending secure updates
      if (password) {
        secureFieldsToUpdate.push({
          field: "password",
          value: await bcrypt.hash(password, 10),
        });
      }

      // Store verification data in user document
      await User.findByIdAndUpdate(userId, {
        $set: {
          "pendingUpdates.token": verificationToken,
          "pendingUpdates.expiry": tokenExpiry,
          "pendingUpdates.fields": secureFieldsToUpdate,
        },
      }).session(session);

      // Send verification email
      await sendVerificationEmail(
        existingUser.email,
        verificationToken,
        secureFieldsToUpdate.map((f) => f.field)
      );

      // Continue with other updates if any
      updateData = immediateUpdates;
    }

    // Remove protected fields from update data
    PROTECTED_FIELDS.forEach((field) => {
      delete updateData[field];
    });

    // If no valid fields to update
    if (
      Object.keys(updateData).length === 0 &&
      secureFieldsToUpdate.length === 0
    ) {
      throw new CustomError(400, "No valid fields to update");
    }

    // Validate update data
    const validationErrors = validateUpdateData(updateData);
    if (validationErrors.length > 0) {
      throw new ValidationError(validationErrors, updateData);
    }

    // Format and sanitize data
    if (updateData.email) {
      updateData.email = updateData.email.toLowerCase().trim();
    }
    if (updateData.phone) {
      updateData.phone = updateData.phone
        .replace(/\D/g, "")
        .replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3");
    }
    if (updateData.firstName) {
      updateData.firstName = validator.escape(updateData.firstName.trim());
    }
    if (updateData.lastName) {
      updateData.lastName = validator.escape(updateData.lastName.trim());
    }

    // Check for unique constraints
    if (updateData.email || updateData.phone) {
      const duplicateUser = await User.findOne({
        _id: { $ne: userId },
        $or: [
          updateData.email ? { email: updateData.email.toLowerCase() } : null,
          updateData.phone ? { phone: updateData.phone } : null,
        ].filter(Boolean),
      }).session(session);

      if (duplicateUser) {
        const duplicateErrors = [];
        if (duplicateUser.email === updateData.email) {
          duplicateErrors.push({
            field: "email",
            message: "Email already exists",
            code: "DUPLICATE_EMAIL",
          });
        }
        if (duplicateUser.phone === updateData.phone) {
          duplicateErrors.push({
            field: "phone",
            message: "Phone number already exists",
            code: "DUPLICATE_PHONE",
          });
        }
        throw new ValidationError(duplicateErrors, updateData);
      }
    }

    // Update user with non-secure fields
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      {
        new: true,
        session,
        select: "-password -ssn -passcodeHash",
      }
    ).populate({
      path: "accounts",
      select: "-transactions -zelle -cashApp -venmo -paypal",
    });

    await session.commitTransaction();
    session.endSession();

    // Prepare response
    const response = {
      status: "success",
      message: "User updated successfully",
      data: {
        user: updatedUser,
      },
    };

    // Add verification message if secure fields are being updated
    if (secureFieldsToUpdate.length > 0) {
      response.message =
        "User updated successfully. Check your email to verify sensitive field updates.";
      response.data.pendingUpdates = secureFieldsToUpdate.map((f) => f.field);
    }

    res.status(200).json(response);

    logger.info("User update initiated", {
      userId,
      updatedFields: Object.keys(updateData),
      pendingSecureUpdates: secureFieldsToUpdate.map((f) => f.field),
      requestId: req.requestId,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    logger.error("Error updating user:", {
      userId: req.params.userId,
      error: error.message,
      stack: error.stack,
      requestId: req.requestId,
    });

    if (error instanceof ValidationError || error instanceof CustomError) {
      return next(error);
    }

    next(new CustomError(500, "An error occurred while updating user"));
  }
};

const verifySecureUpdates = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId } = req.params;
    const { token } = req.body;

    // Find user with pending updates
    const user = await User.findOne({
      _id: userId,
      "pendingUpdates.token": token,
      "pendingUpdates.expiry": { $gt: new Date() },
    }).session(session);

    if (!user) {
      throw new CustomError(400, "Invalid or expired verification token");
    }

    const { fields } = user.pendingUpdates;

    // Apply the pending updates
    const updates = {};
    fields.forEach((update) => {
      updates[update.field] = update.value;
    });

    // Update user and clear pending updates
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        $set: updates,
        $unset: { pendingUpdates: 1 },
      },
      {
        new: true,
        session,
        select: "-password -ssn -passcodeHash",
      }
    );

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      status: "success",
      message: "Secure fields updated successfully",
      data: {
        user: updatedUser,
        updatedFields: fields.map((f) => f.field),
      },
    });

    logger.info("Secure fields updated successfully", {
      userId,
      updatedFields: fields.map((f) => f.field),
      requestId: req.requestId,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    logger.error("Error verifying secure updates:", {
      userId: req.params.userId,
      error: error.message,
      stack: error.stack,
      requestId: req.requestId,
    });

    if (error instanceof CustomError) {
      return next(error);
    }

    next(new CustomError(500, "An error occurred while verifying updates"));
  }
};

module.exports = {
  createUser,
  getAllUsers,
  updateUser,
  verifySecureUpdates,
  updatePasswordAuthenticated,
  initiatePasswordReset,
  completePasswordReset,
};
