const jwt = require("jsonwebtoken");
const ms = require("ms");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const mongoose = require("mongoose");
const User = require("../models/User");
const Account = require("../models/Account");
const Wallet = require("../models/Wallet");
const Beneficiary = require("../models/Beneficiary");
const RefreshToken = require("../models/RefreshToken");
const { logger } = require("../config/logger");
const config = require("../config/config");
const apiResponse = require("../utils/apiResponse");
const {
  generateChallengeToken,
  validateChallengeToken,
} = require("../utils/encryption");

// Default banking information
const DEFAULT_BANK_INFO = {
  bank: "Prime Banking",
  routingNumber: "021000021", // Default routing number
  accountType: "checking",
};

/**
 * Generate a unique 10-digit account number
 * @returns {string} - Unique account number
 */
const generateAccountNumber = () => {
  // Generate a 10-digit random number
  const min = 1000000000;
  const max = 9999999999;
  return Math.floor(min + Math.random() * (max - min + 1)).toString();
};

/**
 * Generate realistic crypto wallet address for BTC
 * @returns {string} - Crypto wallet address
 */
const generateWalletAddress = () => {
  // Bitcoin address format (P2PKH) - starts with 1 or 3, 26-35 alphanumeric chars
  const btcPrefix = Math.random() < 0.5 ? "1" : "3";
  return btcPrefix + crypto.randomBytes(20).toString("hex").substring(0, 32);
};

/**
 * Generate wallet name based on existing user wallets count
 * @param {number} count - Number of existing wallets the user has
 * @returns {string} - Wallet name in format "Wallet XX"
 */
const generateWalletName = (count) => {
  // Generate a wallet name in the format "Wallet 01", "Wallet 02", etc.
  return `Wallet ${String(count + 1).padStart(2, "0")}`;
};

/**
 * Generate JWT token
 * @param {string} id - User ID
 * @param {string} role - User role
 * @returns {string} JWT token
 */
const generateToken = (id, role) => {
  return jwt.sign({ id, role }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });
};

/**
 * Generate refresh token
 * @param {string} userId - User ID
 * @param {string} ipAddress - IP address
 * @param {string} userAgent - User agent
 * @returns {Promise<object>} Refresh token object
 */
const generateRefreshToken = async (userId, ipAddress, userAgent) => {
  try {
    // Generate a random token
    const refreshToken = crypto.randomBytes(40).toString("hex");

    // Calculate expiry date
    const expiresAt = new Date(Date.now() + ms(config.jwt.refreshExpiresIn));

    // Create refresh token in database
    const tokenDoc = await RefreshToken.create({
      user: userId,
      token: refreshToken,
      expiresAt,
      ipAddress,
      userAgent,
    });

    return {
      token: refreshToken,
      expiresAt,
    };
  } catch (error) {
    logger.error("Error generating refresh token", {
      userId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

/**
 * Create default account and wallet for a new user
 * @param {ObjectId} userId - User ID
 * @param {Object} accountData - Optional account data
 * @param {Object} walletData - Optional wallet data
 * @param {mongoose.ClientSession} session - Mongoose session for transaction
 * @returns {Promise<{account: Object, wallet: Object}>}
 */
const createDefaultAccountAndWallet = async (
  userId,
  accountData = {},
  walletData = {},
  session
) => {
  try {
    // Create default account with 10-digit account number
    const accountNumber = accountData.accountNumber || generateAccountNumber();

    const account = new Account({
      user: userId,
      type: accountData.type || DEFAULT_BANK_INFO.accountType,
      status: "active",
      name: accountData.name || "Primary Checking",
      bank: accountData.bank || DEFAULT_BANK_INFO.bank,
      accountNumber: accountNumber,
      routingNumber:
        accountData.routingNumber || DEFAULT_BANK_INFO.routingNumber,
      availableBalance: 0,
      ledgerBalance: 0,
      isDefault: true,
      email: accountData.email,
      phone: accountData.phone,
      createdIp: accountData.createdIp,
    });

    await account.save({ session });

    // Generate wallet name (format: "Wallet 01")
    const walletName = walletData.name || "Wallet 01";

    // Generate or use provided wallet address
    const address = walletData.btcAddress || generateWalletAddress();

    // Create a single BTC wallet
    const wallet = new Wallet({
      user: userId,
      address,
      currency: "BTC",
      balance: 0,
      ledgerBalance: 0,
      name: walletName,
      status: "active",
      type: "crypto",
      isDefault: true,
      securitySettings: {
        transferLimit: {
          daily: walletData.dailyLimit || 5000,
          singleTransaction: walletData.transactionLimit || 2000,
        },
        requireConfirmation: true,
        twoFactorEnabled: false,
      },
    });

    await wallet.save({ session });

    return { account, wallet };
  } catch (error) {
    logger.error("Error creating default account and wallet", {
      userId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

/**
 * Register a new user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.register = async (req, res) => {
  // Start a MongoDB transaction session
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      firstName,
      lastName,
      username,
      email,
      password,
      phone,
      role,
      // Optional account/wallet data
      accountName,
      accountType,
      bankName,
      routingNumber,
      accountNumber,
      // Optional wallet address
      btcAddress,
      walletName,
    } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [
        { email: email.toLowerCase() },
        { username: username.toLowerCase() },
      ],
    });

    if (existingUser) {
      if (existingUser.email === email.toLowerCase()) {
        return apiResponse.badRequest(res, "Email already in use");
      }
      return apiResponse.badRequest(res, "Username already taken");
    }

    // Create new user
    const user = new User({
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`,
      username: username.toLowerCase(),
      email: email.toLowerCase(),
      password,
      phone,
      status: "pendingVerification",
      role: role || "user",
    });

    await user.save({ session });

    // Prepare account data from request (if provided)
    const accountData = {
      name: accountName,
      type: accountType,
      bank: bankName,
      routingNumber,
      accountNumber,
      email: email.toLowerCase(),
      phone,
      createdIp: req.ip,
    };

    // Prepare wallet data from request (if provided)
    const walletData = {
      btcAddress,
      name: walletName,
    };

    // Create default account and wallet
    const { account, wallet } = await createDefaultAccountAndWallet(
      user._id,
      accountData,
      walletData,
      session
    );

    // Update user with references to created entities
    user.accounts = [account._id];
    user.wallets = [wallet._id];
    await user.save({ session });

    // Generate JWT token
    const token = generateToken(user._id, user.role);

    // Generate refresh token
    const refreshToken = await generateRefreshToken(
      user._id,
      req.ip,
      req.get("user-agent") || "unknown"
    );

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("New user registered with default account and wallet", {
      userId: user._id,
      username: user.username,
      email: user.email,
      accountId: account._id,
      walletId: wallet._id,
      requestId: req.id,
    });

    // Return user data and tokens
    return apiResponse.created(res, "User registered successfully", {
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
        username: user.username,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
      },
      accountDetails: {
        accountNumber: account.accountNumber,
        maskedAccountNumber: account.maskedAccountNumber,
        type: account.type,
        bank: account.bank,
        routingNumber: account.routingNumber,
      },
      wallet: {
        _id: wallet._id,
        currency: wallet.currency,
        name: wallet.name,
        address: wallet.address,
        isDefault: wallet.isDefault,
      },
      token,
      refreshToken: refreshToken.token,
    });
  } catch (error) {
    // Abort transaction on error
    await session.abortTransaction();
    session.endSession();

    logger.error("Registration error", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(res, 500, "Error registering user");
  }
};

/**
 * Login user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.login = async (req, res) => {
  try {
    const { identifier, password } = req.body;

    // Find user by email or username
    const user = await User.findOne({
      $or: [
        { email: identifier.toLowerCase() },
        { username: identifier.toLowerCase() }, // supporting both email and username
      ],
    }).select("+password");

    // Check if user exists and password is correct
    if (!user || !(await user.matchPassword(password))) {
      logger.warn("Login failed: Invalid credentials", {
        identifier,
        ip: req.ip,
        requestId: req.id,
      });

      return apiResponse.unauthorized(
        res,
        "Invalid email/username or password"
      );
    }

    // Check if account is active
    if (user.status !== "active" && user.status !== "pendingVerification") {
      logger.warn("Login attempt with inactive account", {
        userId: user._id,
        status: user.status,
        ip: req.ip,
        requestId: req.id,
      });

      return apiResponse.forbidden(
        res,
        `Your account is ${user.status}. Please contact support.`
      );
    }

    // Update last login time
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    // Generate JWT token
    const token = generateToken(user._id, user.role);

    // Generate refresh token
    const refreshToken = await generateRefreshToken(
      user._id,
      req.ip,
      req.get("user-agent") || "unknown"
    );

    // Fetch fully populated user data for response
    const populatedUser = await User.findById(user._id)
      .populate({
        path: "accounts",
        select: "-createdIp -lastAccessedIp",
        populate: {
          path: "transactions",
        },
      })
      .populate({
        path: "wallets",
        select: "-securitySettings.twoFactorSecret",
      })
      .populate({
        path: "cards",
        select: "-cvv -cardNumber",
        populate: {
          path: "account",
          select: "accountNumber maskedAccountNumber type name bank",
        },
      })
      .populate({
        path: "beneficiaries",
        // select: "name bank accountNumber routingNumber nickname isFavorite",
      })
      .populate({
        path: "bills",
        select: "title amount dueDate status provider paid account",
      })
      .populate({
        path: "pendingWallets",
        select:
          "user currency status requestDate priority preloadedAccount processingNotes processedBy processedAt notificationSent notificationDate",
      });

    logger.info("User logged in", {
      userId: user._id,
      username: user.username,
      ip: req.ip,
      requestId: req.id,
    });

    // Return user data and tokens
    return apiResponse.success(res, 200, "Login successful", {
      user: {
        _id: populatedUser._id,
        firstName: populatedUser.firstName,
        lastName: populatedUser.lastName,
        fullName: populatedUser.fullName,
        username: populatedUser.username,
        email: populatedUser.email,
        phone: populatedUser.phone,
        role: populatedUser.role,
        status: populatedUser.status,
        picture: populatedUser.picture,

        // Include populated references
        accounts: populatedUser.accounts,
        wallets: populatedUser.wallets,
        cards: populatedUser.cards,
        beneficiaries: populatedUser.beneficiaries,
        bills: populatedUser.bills,
        pendingWallets: populatedUser.pendingWallets,
        // pendingWallets: [{ id: 1 }, { id: 2 }],

        // Include additional fields that are not sensitive
        lastLogin: populatedUser.lastLogin,
        createdAt: populatedUser.createdAt,
        updatedAt: populatedUser.updatedAt,
        address: populatedUser.address,
        dateOfBirth: populatedUser.dateOfBirth,
        kycStatus: populatedUser.kycStatus,
        preferences: populatedUser.preferences,
        notificationSettings: populatedUser.notificationSettings,
      },
      token,
      refreshToken: refreshToken.token,
    });
  } catch (error) {
    logger.error("Login error", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(res, 500, "Error during login");
  }
};

// Keep other functions unchanged

/**
 * Refresh access token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return apiResponse.badRequest(res, "Refresh token is required");
    }

    // Find the refresh token in database
    const tokenDoc = await RefreshToken.findValid(refreshToken);

    if (!tokenDoc) {
      logger.warn("Invalid refresh token used", {
        token: refreshToken.substring(0, 10) + "...",
        ip: req.ip,
        requestId: req.id,
      });

      return apiResponse.unauthorized(res, "Invalid or expired refresh token");
    }

    // Get the user
    const user = await User.findById(tokenDoc.user);

    if (!user) {
      logger.warn("Refresh token used for non-existent user", {
        tokenId: tokenDoc._id,
        userId: tokenDoc.user,
        ip: req.ip,
        requestId: req.id,
      });

      return apiResponse.unauthorized(res, "User not found");
    }

    // Check if account is active
    if (user.status !== "active" && user.status !== "pendingVerification") {
      logger.warn("Token refresh attempt with inactive account", {
        userId: user._id,
        status: user.status,
        ip: req.ip,
        requestId: req.id,
      });

      return apiResponse.forbidden(
        res,
        `Your account is ${user.status}. Please contact support.`
      );
    }

    // Generate new JWT token
    const token = generateToken(user._id, user.role);

    // Generate new refresh token
    const newRefreshToken = await generateRefreshToken(
      user._id,
      req.ip,
      req.get("user-agent") || "unknown"
    );

    // Revoke the old refresh token
    await tokenDoc.revoke();

    logger.info("Access token refreshed", {
      userId: user._id,
      username: user.username,
      ip: req.ip,
      requestId: req.id,
    });

    // Return new tokens
    return apiResponse.success(res, 200, "Token refreshed successfully", {
      token,
      refreshToken: newRefreshToken.token,
    });
  } catch (error) {
    logger.error("Token refresh error", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(res, 500, "Error refreshing token");
  }
};

/**
 * Logout user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    // If refresh token provided, revoke it
    if (refreshToken) {
      const tokenDoc = await RefreshToken.findOne({ token: refreshToken });

      if (tokenDoc) {
        await tokenDoc.revoke();

        logger.info("User logged out (token revoked)", {
          userId: tokenDoc.user,
          tokenId: tokenDoc._id,
          ip: req.ip,
          requestId: req.id,
        });
      }
    }

    return apiResponse.success(res, 200, "Logout successful");
  } catch (error) {
    logger.error("Logout error", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(res, 500, "Error during logout");
  }
};

// Keep the rest of your code (getMe, setPasscode, verifyPasscode, etc) unchanged
/**
 * Get current logged in user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getMe = async (req, res) => {
  try {
    // Get user with populated data
    const user = await User.findById(req.user._id)
      .populate({
        path: "accounts",
        select: "-createdIp -lastAccessedIp",
        populate: {
          path: "transactions",
        },
      })
      .populate({
        path: "wallets",
        select: "-securitySettings.twoFactorSecret",
      })
      .populate({
        path: "cards",
        select: "-cvv -cardNumber",
        populate: {
          path: "account",
          select: "accountNumber maskedAccountNumber type name bank",
        },
      })
      .populate({
        path: "beneficiaries",
        // select: "name bank accountNumber routingNumber nickname isFavorite",
      })
      .populate({
        path: "bills",
        select: "title amount dueDate status provider paid account",
      })
      .populate({
        path: "pendingWallets",
        select:
          "user currency status requestDate priority preloadedAccount processingNotes processedBy processedAt notificationSent notificationDate",
      });

    if (!user) {
      return apiResponse.notFound(res, "User not found");
    }

    logger.info("User profile retrieved", {
      userId: user._id,
      requestId: req.id,
    });

    return apiResponse.success(
      res,
      200,
      "User profile retrieved successfully",
      {
        user: {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName: user.fullName,
          username: user.username,
          email: user.email,
          phone: user.phone,
          role: user.role,
          status: user.status,
          picture: user.picture,

          // Include populated references
          accounts: user.accounts,
          wallets: user.wallets,
          cards: user.cards,
          beneficiaries: user.beneficiaries,
          bills: user.bills,
          pendingWallets: user.pendingWallets,
          // pendingWallets: [{ id: 1 }, { id: 2 }],

          // Include additional fields that are not sensitive
          lastLogin: user.lastLogin,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          address: user.address,
          dateOfBirth: user.dateOfBirth,
          kycStatus: user.kycStatus,
          preferences: user.preferences,
          notificationSettings: user.notificationSettings,
        },
      }
    );
  } catch (error) {
    logger.error("Error retrieving user profile", {
      userId: req.user._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(res, 500, "Error retrieving user profile");
  }
};

/**
 * Set user passcode
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.setPasscode = async (req, res) => {
  try {
    const { passcode } = req.body;

    // Get user
    const user = await User.findById(req.user._id).select("+passcodeHash");

    if (!user) {
      return apiResponse.notFound(res, "User not found");
    }

    // Hash the passcode
    const salt = await bcrypt.genSalt(config.security.bcryptSaltRounds);
    user.passcodeHash = await bcrypt.hash(passcode, salt);
    user.passcodeAttemptLeft = config.security.passcodeMaxAttempts;

    await user.save();

    logger.info("User passcode set", {
      userId: user._id,
      requestId: req.id,
    });

    return apiResponse.success(res, 200, "Passcode set successfully");
  } catch (error) {
    logger.error("Error setting passcode", {
      userId: req.user._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(res, 500, "Error setting passcode");
  }
};

/**
 * Verify user passcode
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
// exports.verifyPasscode = async (req, res) => {
//   try {
//     const { passcode } = req.body;

//     // Get user
//     const user = await User.findById(req.user._id).select("+passcodeHash");

//     if (!user) {
//       return apiResponse.notFound(res, "User not found");
//     }

//     // Check if passcode is set
//     if (!user.passcodeHash) {
//       return apiResponse.badRequest(res, "Passcode not set");
//     }

//     // Check if passcode attempts are left
//     if (user.passcodeAttemptLeft <= 0) {
//       return apiResponse.forbidden(
//         res,
//         "Account locked due to too many passcode attempts"
//       );
//     }

//     // Verify passcode
//     const isMatch = await user.matchPasscode(passcode);

//     if (!isMatch) {
//       // Decrement attempts
//       user.passcodeAttemptLeft -= 1;

//       // If no attempts left, lock account
//       if (user.passcodeAttemptLeft <= 0) {
//         user.status = "locked";

//         logger.warn("Account locked due to passcode attempts", {
//           userId: user._id,
//           requestId: req.id,
//         });
//       }

//       await user.save();

//       logger.warn("Invalid passcode attempt", {
//         userId: user._id,
//         attemptsLeft: user.passcodeAttemptLeft,
//         requestId: req.id,
//       });

//       return apiResponse.badRequest(
//         res,
//         `Invalid passcode. ${user.passcodeAttemptLeft} attempts left.`
//       );
//     }

//     // Reset attempts on successful verification
//     user.passcodeAttemptLeft = config.security.passcodeMaxAttempts;
//     await user.save();

//     logger.info("Passcode verified successfully", {
//       userId: user._id,
//       requestId: req.id,
//     });

//     return apiResponse.success(res, 200, "Passcode verified successfully");
//   } catch (error) {
//     logger.error("Error verifying passcode", {
//       userId: req.user._id,
//       error: error.message,
//       stack: error.stack,
//       requestId: req.id,
//     });

//     return apiResponse.error(res, 500, "Error verifying passcode");
//   }
// };

exports.verifyPasscode = async (req, res, next) => {
  try {
    const { challengeToken, passcodeVerification } = req.body;
    const userId = req.user._id;

    // Validate required fields
    if (!challengeToken || !passcodeVerification) {
      return apiResponse.badRequest(
        res,
        "Challenge token and passcode verification are required"
      );
    }

    // Validate challenge token
    const validationResult = validateChallengeToken(challengeToken, userId);
    if (!validationResult.valid) {
      logger.warn(`Invalid challenge token: ${validationResult.reason}`, {
        userId,
        requestId: req.id,
      });

      return apiResponse.badRequest(res, `Invalid or expired challenge token`);
    }

    // Get user with passcode hash
    const user = await User.findById(userId).select("+passcodeHash");

    if (!user) {
      return apiResponse.notFound(res, "User not found");
    }

    // Check if passcode is set
    if (!user.passcodeHash) {
      return apiResponse.badRequest(res, "Passcode not set");
    }

    // Check if passcode attempts are left
    if (user.passcodeAttemptLeft <= 0) {
      return apiResponse.forbidden(
        res,
        "Account locked due to too many passcode attempts"
      );
    }

    // Compute expected hash using challenge token
    const expectedHash = crypto
      .createHash("sha256")
      .update(user.passcodeHash + challengeToken)
      .digest("hex");

    // Compare with provided verification hash
    if (passcodeVerification !== expectedHash) {
      // Decrement attempts
      user.passcodeAttemptLeft -= 1;

      // If no attempts left, lock account
      if (user.passcodeAttemptLeft <= 0) {
        user.status = "locked";

        logger.warn("Account locked due to passcode attempts", {
          userId: user._id,
          requestId: req.id,
        });
      }

      await user.save();

      logger.warn("Invalid passcode attempt", {
        userId: user._id,
        attemptsLeft: user.passcodeAttemptLeft,
        requestId: req.id,
      });

      return apiResponse.badRequest(
        res,
        `Invalid passcode. ${user.passcodeAttemptLeft} attempts left.`
      );
    }

    // Reset attempts on successful verification
    user.passcodeAttemptLeft = config.security.passcodeMaxAttempts;
    await user.save();

    logger.info("Passcode verified successfully", {
      userId: user._id,
      action: validationResult.action,
      requestId: req.id,
    });

    // Add the action to the request for downstream middleware
    req.verifiedAction = validationResult.action;

    // Proceed to next middleware/handler
    next();
  } catch (error) {
    logger.error("Error verifying passcode", {
      userId: req.user._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(res, 500, "Error verifying passcode");
  }
};

/**
 * Forgot password
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      // Don't reveal that the user doesn't exist
      return apiResponse.success(
        res,
        200,
        "Password reset instructions sent if email exists"
      );
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString("hex");

    // Hash token and set to resetPasswordToken field
    const resetPasswordToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    // Set expiry
    const resetPasswordExpire =
      Date.now() + config.security.passwordResetExpires;

    // Save to user
    user.resetPasswordToken = resetPasswordToken;
    user.resetPasswordExpire = resetPasswordExpire;
    await user.save({ validateBeforeSave: false });

    // TODO: Send email with reset token

    logger.info("Password reset requested", {
      userId: user._id,
      email: user.email,
      requestId: req.id,
    });

    return apiResponse.success(res, 200, "Password reset instructions sent");
  } catch (error) {
    logger.error("Error requesting password reset", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(res, 500, "Error requesting password reset");
  }
};

/**
 * Reset password
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;

    // Hash token
    const resetPasswordToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    // Find user by token and expiry
    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user) {
      return apiResponse.badRequest(res, "Invalid or expired token");
    }

    // Set new password
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;

    await user.save();

    // Revoke all refresh tokens for this user
    await RefreshToken.revokeAllForUser(user._id);

    logger.info("Password reset completed", {
      userId: user._id,
      email: user.email,
      requestId: req.id,
    });

    return apiResponse.success(res, 200, "Password reset successful");
  } catch (error) {
    logger.error("Error resetting password", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(res, 500, "Error resetting password");
  }
};

/**
 * Update password
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Get user with password
    const user = await User.findById(req.user._id).select("+password");

    if (!user) {
      return apiResponse.notFound(res, "User not found");
    }

    // Check current password
    if (!(await user.matchPassword(currentPassword))) {
      logger.warn("Invalid current password in update attempt", {
        userId: user._id,
        requestId: req.id,
      });

      return apiResponse.badRequest(res, "Current password is incorrect");
    }

    // Update password
    user.password = newPassword;
    await user.save();

    // Revoke all refresh tokens for this user
    await RefreshToken.revokeAllForUser(user._id);

    logger.info("Password updated", {
      userId: user._id,
      requestId: req.id,
    });

    return apiResponse.success(res, 200, "Password updated successfully");
  } catch (error) {
    logger.error("Error updating password", {
      userId: req.user._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(res, 500, "Error updating password");
  }
};

exports.generateSecureRequestToken = (req, res) => {
  try {
    const userId = req.user._id;
    const { action } = req.body;

    // Validate required action
    if (!action) {
      return apiResponse.badRequest(res, "Action is required");
    }

    // Generate challenge token for this user/action
    const challengeToken = generateChallengeToken(userId, action);

    logger.info("Challenge token generated", {
      userId,
      action,
      requestId: req.id,
    });

    return apiResponse.success(res, 200, "Challenge token generated", {
      challengeToken,
    });
  } catch (error) {
    logger.error("Error generating challenge token", {
      userId: req.user?._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(res, 500, "Error generating challenge token");
  }
};
