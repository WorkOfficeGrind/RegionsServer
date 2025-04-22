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
const notificationService = require("../services/notificationService");

// Default banking information
const DEFAULT_BANK_INFO = {
  bank: process.env.DEFAULT_BANK || "Prime Banking",
  routingNumber: process.env.DEFAULT_ROUTING_NUMBER || "021000021", // Default routing number
  accountType: process.env.DEFAULT_ACCOUNT_TYPE || "checking",
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
      image:
        "https://res.cloudinary.com/dvvgaf1l9/image/upload/v1742350933/10PennyFund/important/bitcoin_awvbci.png",
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

    // Input validation
    if (!firstName || !lastName || !username || !email || !password) {
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Missing required fields",
        "MISSING_FIELDS"
      );
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [
        { email: email.toLowerCase() },
        { username: username.toLowerCase() },
      ],
    }).session(session);

    if (existingUser) {
      await session.abortTransaction();
      session.endSession();

      if (existingUser.email === email.toLowerCase()) {
        return apiResponse.badRequest(
          res,
          "Bad Request",
          "Email already in use",
          "EMAIL_IN_USE"
        );
      }
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Username already taken",
        "USERNAME_TAKEN"
      );
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

    // Create notification in the same transaction
    await notificationService.createNotification(
      user._id,
      "Successful Account Opening",
      `Your account has been created successfully.`,
      "system",
      { ...user }
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

    // Return user data and tokens using apiResponse utility
    return apiResponse.created(
      res,
      "Registration Successful",
      "User registered successfully",
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
      }
    );
  } catch (error) {
    // Abort transaction on error
    await session.abortTransaction();
    session.endSession();

    logger.error("Registration error", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(
      res,
      500,
      "Registration Failed",
      "Error registering user",
      "REGISTRATION_ERROR"
    );
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

    // Input validation
    if (!identifier || !password) {
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Email/username and password are required",
        "MISSING_CREDENTIALS"
      );
    }

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
        "Authentication Failed",
        "Invalid email/username or password",
        "INVALID_CREDENTIALS"
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
        "Account Restricted",
        `Your account is ${user.status}.`,
        "ACCOUNT_RESTRICTED"
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
          options: { sort: { processedAt: -1 }, limit: 20 }, // Limit transactions
          populate: [
            { path: "sourceUser", select: "fullName username" }, // Limit fields
            { path: "beneficiary", select: "name nickname" }, // Limit fields
          ],
        },
      })
      .populate({
        path: "wallets",
        select: "-securitySettings.twoFactorSecret",
        populate: {
          path: "transactions",
          options: { sort: { completedAt: -1 }, limit: 20 }, // Limit transactions
          populate: [
            { path: "source", select: "fullName username" }, // Limit fields
            { path: "beneficiary", select: "name nickname" }, // Limit fields
          ],
        },
      })
      .populate({
        path: "cards",
        select: "-cvv -cardNumber",
        populate: {
          path: "account",
          select: "accountNumber maskedAccountNumber type name bank",
        },
      })
      .populate("beneficiaries")
      .populate("walletBeneficiaries")
      .populate({
        path: "investments",
        populate: [
          { path: "plan" },
          {
            path: "transactions",
            options: { sort: { createdAt: -1 }, limit: 10 }, // Limit transactions
          },
        ],
      })
      .populate({
        path: "bills",
        options: { sort: { processedAt: -1 } },
        select: "title amount dueDate status provider paid account",
      })
      .populate({
        path: "pendingWallets",
        options: { sort: { processedAt: -1 } },
        select:
          "user currency status requestDate priority preloadedAccount processingNotes processedBy processedAt notificationSent notificationDate",
      });

    if (populatedUser.investments && populatedUser.investments.length > 0) {
      for (let investment of populatedUser.investments) {
        // Include the growth schedule metadata directly
        if (
          investment.metadata?.growthSchedule &&
          investment.metadata?.nextGrowthIndex !== undefined
        ) {
          const { growthSchedule, nextGrowthIndex } = investment.metadata;

          // Add today's expected growth amount
          if (nextGrowthIndex < growthSchedule.length) {
            investment.nextGrowthAmount = growthSchedule[nextGrowthIndex];
            investment.nextGrowthPercentage =
              (growthSchedule[nextGrowthIndex] / investment.currentValue) * 100;
          }

          // Include last processed growth (yesterday's growth)
          if (nextGrowthIndex > 0) {
            investment.lastGrowthAmount = growthSchedule[nextGrowthIndex - 1];

            // Calculate percentage based on value before yesterday's growth
            const valueBeforeLastGrowth =
              investment.currentValue - investment.lastGrowthAmount;
            investment.lastGrowthPercentage =
              (investment.lastGrowthAmount / valueBeforeLastGrowth) * 100;
          }
        }
      }
    }

    logger.info("User logged in", {
      userId: user._id,
      username: user.username,
      ip: req.ip,
      requestId: req.id,
    });

    // Return user data and tokens using apiResponse utility
    return apiResponse.success(
      res,
      200,
      "Login Successful",
      "Authentication successful",
      {
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
          investments: populatedUser.investments,
          walletBeneficiaries: populatedUser.walletBeneficiaries,
          bills: populatedUser.bills,
          pendingWallets: populatedUser.pendingWallets,

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
      }
    );
  } catch (error) {
    logger.error("Login error", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(
      res,
      500,
      "Login Failed",
      "Error during login",
      "LOGIN_ERROR"
    );
  }
};

/**
 * Refresh access token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Refresh token is required",
        "REFRESH_TOKEN_REQUIRED"
      );
    }

    // Find the refresh token in database
    const tokenDoc = await RefreshToken.findValid(refreshToken);

    if (!tokenDoc) {
      logger.warn("Invalid refresh token used", {
        token: refreshToken.substring(0, 10) + "...",
        ip: req.ip,
        requestId: req.id,
      });

      return apiResponse.unauthorized(
        res,
        "Unauthorized",
        "Invalid or expired refresh token",
        "INVALID_REFRESH_TOKEN"
      );
    }

    // Start a transaction for token refresh
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Get the user
      const user = await User.findById(tokenDoc.user).session(session);

      if (!user) {
        await session.abortTransaction();
        session.endSession();

        logger.warn("Refresh token used for non-existent user", {
          tokenId: tokenDoc._id,
          userId: tokenDoc.user,
          ip: req.ip,
          requestId: req.id,
        });

        return apiResponse.unauthorized(
          res,
          "Unauthorized",
          "User not found",
          "USER_NOT_FOUND"
        );
      }

      // Check if account is active
      if (user.status !== "active" && user.status !== "pendingVerification") {
        await session.abortTransaction();
        session.endSession();

        logger.warn("Token refresh attempt with inactive account", {
          userId: user._id,
          status: user.status,
          ip: req.ip,
          requestId: req.id,
        });

        return apiResponse.forbidden(
          res,
          "Account Restricted",
          `Your account is ${user.status}. Please contact support.`,
          "ACCOUNT_RESTRICTED"
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
      await tokenDoc.revoke(session);

      // Commit the transaction
      await session.commitTransaction();
      session.endSession();

      logger.info("Access token refreshed", {
        userId: user._id,
        username: user.username,
        ip: req.ip,
        requestId: req.id,
      });

      // Return new tokens using apiResponse utility
      return apiResponse.success(
        res,
        200,
        "Token Refreshed",
        "Token refreshed successfully",
        {
          token,
          refreshToken: newRefreshToken.token,
        }
      );
    } catch (error) {
      // Abort transaction on error
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  } catch (error) {
    logger.error("Token refresh error", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(
      res,
      500,
      "Token Refresh Failed",
      "Error refreshing token",
      "TOKEN_REFRESH_ERROR"
    );
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
        // Start a transaction for token revocation
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
          await tokenDoc.revoke(session);
          await session.commitTransaction();

          logger.info("User logged out (token revoked)", {
            userId: tokenDoc.user,
            tokenId: tokenDoc._id,
            ip: req.ip,
            requestId: req.id,
          });
        } catch (error) {
          await session.abortTransaction();
          throw error;
        } finally {
          session.endSession();
        }
      }
    }

    return apiResponse.success(
      res,
      200,
      "Logout Successful",
      "User logged out successfully"
    );
  } catch (error) {
    logger.error("Logout error", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(
      res,
      500,
      "Logout Failed",
      "Error during logout",
      "LOGOUT_ERROR"
    );
  }
};

/**
 * Get current logged in user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getMe = async (req, res) => {
  try {
    // Input validation
    if (!req.user || !req.user._id) {
      return apiResponse.unauthorized(
        res,
        "Unauthorized",
        "User not authenticated",
        "USER_NOT_AUTHENTICATED"
      );
    }

    // Get user with populated data
    const user = await User.findById(req.user._id)
      .populate({
        path: "accounts",
        select: "-createdIp -lastAccessedIp",
        populate: {
          path: "transactions",
          options: { sort: { processedAt: -1 }, limit: 20 }, // Limit transactions
          populate: [
            { path: "sourceUser", select: "fullName username" }, // Limit fields
            { path: "beneficiary", select: "name nickname" }, // Limit fields
          ],
        },
      })
      .populate({
        path: "wallets",
        select: "-securitySettings.twoFactorSecret",
        populate: {
          path: "transactions",
          options: { sort: { completedAt: -1 }, limit: 20 }, // Limit transactions
          populate: [
            { path: "source", select: "fullName username" }, // Limit fields
            { path: "beneficiary", select: "name nickname" }, // Limit fields
          ],
        },
      })
      .populate({
        path: "cards",
        select: "-cvv -cardNumber",
        populate: {
          path: "account",
          select: "accountNumber maskedAccountNumber type name bank",
        },
      })
      .populate("beneficiaries")
      .populate("walletBeneficiaries")
      .populate({
        path: "investments",
        populate: [
          { path: "plan" },
          {
            path: "transactions",
            options: { sort: { createdAt: -1 }, limit: 10 },
          },
        ],
      })
      .populate({
        path: "bills",
        options: { sort: { processedAt: -1 } },
        select: "title amount dueDate status provider paid account",
      })
      .populate({
        path: "pendingWallets",
        options: { sort: { processedAt: -1 } },
        select:
          "user currency status requestDate priority preloadedAccount processingNotes processedBy processedAt notificationSent notificationDate",
      });

    if (!user) {
      return apiResponse.notFound(
        res,
        "Not Found",
        "User not found",
        "USER_NOT_FOUND"
      );
    }

    logger.info("User profile retrieved", {
      userId: user._id,
      requestId: req.id,
    });

    return apiResponse.success(
      res,
      200,
      "Profile Retrieved",
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
          investments: user.investments,
          walletBeneficiaries: user.walletBeneficiaries,
          bills: user.bills,
          pendingWallets: user.pendingWallets,

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
      userId: req.user?._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(
      res,
      500,
      "Profile Retrieval Failed",
      "Error retrieving user profile",
      "PROFILE_ERROR"
    );
  }
};

/**
 * Set user passcode
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.setPasscode = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { passcode } = req.body;

    // Input validation
    if (!passcode || passcode.length < 4) {
      await session.abortTransaction();
      session.endSession();

      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Valid passcode is required (minimum 4 characters)",
        "INVALID_PASSCODE"
      );
    }

    // Get user
    const user = await User.findById(req.user._id)
      .select("+passcodeHash")
      .session(session);

    if (!user) {
      await session.abortTransaction();
      session.endSession();

      return apiResponse.notFound(
        res,
        "Not Found",
        "User not found",
        "USER_NOT_FOUND"
      );
    }

    // Hash the passcode
    const salt = await bcrypt.genSalt(config.security.bcryptSaltRounds);
    user.passcodeHash = await bcrypt.hash(passcode, salt);
    user.passcodeAttemptLeft = config.security.passcodeMaxAttempts;

    await user.save({ session });

    // Create notification
    await notificationService.createNotification(
      user._id,
      "Passcode Set Successfully",
      `Your passcode has been set successfully.`,
      "system",
      { userId: user._id }
    );

    await session.commitTransaction();
    session.endSession();

    logger.info("User passcode set", {
      userId: user._id,
      requestId: req.id,
    });

    return apiResponse.success(
      res,
      200,
      "Passcode Set",
      "Passcode set successfully"
    );
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    logger.error("Error setting passcode", {
      userId: req.user?._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(
      res,
      500,
      "Passcode Set Failed",
      "Error setting passcode",
      "PASSCODE_ERROR"
    );
  }
};

/**
 * Verify user passcode with challenge token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
exports.verifyPasscode = async (req, res, next) => {
  try {
    const { challengeToken, passcodeVerification } = req.body;
    const userId = req.user._id;

    // Validate required fields
    if (!challengeToken || !passcodeVerification) {
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Challenge token and passcode verification are required",
        "MISSING_VERIFICATION_FIELDS"
      );
    }

    // Validate challenge token
    const validationResult = validateChallengeToken(challengeToken, userId);
    if (!validationResult.valid) {
      logger.warn(`Invalid challenge token: ${validationResult.reason}`, {
        userId,
        requestId: req.id,
      });

      return apiResponse.badRequest(
        res,
        "Invalid Token",
        "Invalid or expired challenge token",
        "INVALID_CHALLENGE_TOKEN"
      );
    }

    // Start a transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Get user with passcode hash
      const user = await User.findById(userId)
        .select("+passcodeHash")
        .session(session);

      if (!user) {
        await session.abortTransaction();
        session.endSession();

        return apiResponse.notFound(
          res,
          "Not Found",
          "User not found",
          "USER_NOT_FOUND"
        );
      }

      // Check if passcode is set
      if (!user.passcodeHash) {
        await session.abortTransaction();
        session.endSession();

        return apiResponse.badRequest(
          res,
          "Bad Request",
          "Passcode not set",
          "PASSCODE_NOT_SET"
        );
      }

      // Check if passcode attempts are left
      if (user.passcodeAttemptLeft <= 0) {
        await session.abortTransaction();
        session.endSession();

        return apiResponse.forbidden(
          res,
          "Account Locked",
          "Account locked due to too many passcode attempts",
          "PASSCODE_ATTEMPTS_EXCEEDED"
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

        await user.save({ session });
        await session.commitTransaction();
        session.endSession();

        logger.warn("Invalid passcode attempt", {
          userId: user._id,
          attemptsLeft: user.passcodeAttemptLeft,
          requestId: req.id,
        });

        return apiResponse.badRequest(
          res,
          "Invalid Passcode",
          `Invalid passcode. ${user.passcodeAttemptLeft} attempts left.`,
          "INVALID_PASSCODE"
        );
      }

      // Reset attempts on successful verification
      user.passcodeAttemptLeft = config.security.passcodeMaxAttempts;
      await user.save({ session });
      await session.commitTransaction();
      session.endSession();

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
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  } catch (error) {
    logger.error("Error verifying passcode", {
      userId: req.user?._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(
      res,
      500,
      "Verification Failed",
      "Error verifying passcode",
      "PASSCODE_VERIFICATION_ERROR"
    );
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

    // Input validation
    if (!email) {
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Email is required",
        "EMAIL_REQUIRED"
      );
    }

    // Start a transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Find user by email
      const user = await User.findOne({ email: email.toLowerCase() }).session(
        session
      );

      if (!user) {
        // Don't reveal that the user doesn't exist
        await session.commitTransaction();
        session.endSession();

        return apiResponse.success(
          res,
          200,
          "Reset Instructions Sent",
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
      await user.save({ session, validateBeforeSave: false });

      // TODO: Send email with reset token
      // This would typically be implemented with an email service

      await session.commitTransaction();
      session.endSession();

      logger.info("Password reset requested", {
        userId: user._id,
        email: user.email,
        requestId: req.id,
      });

      return apiResponse.success(
        res,
        200,
        "Reset Instructions Sent",
        "Password reset instructions sent"
      );
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  } catch (error) {
    logger.error("Error requesting password reset", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(
      res,
      500,
      "Reset Request Failed",
      "Error requesting password reset",
      "PASSWORD_RESET_ERROR"
    );
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

    // Input validation
    if (!token || !password) {
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Token and new password are required",
        "MISSING_RESET_FIELDS"
      );
    }

    // Start a transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Hash token
      const resetPasswordToken = crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");

      // Find user by token and expiry
      const user = await User.findOne({
        resetPasswordToken,
        resetPasswordExpire: { $gt: Date.now() },
      }).session(session);

      if (!user) {
        await session.abortTransaction();
        session.endSession();

        return apiResponse.badRequest(
          res,
          "Invalid Token",
          "Invalid or expired token",
          "INVALID_RESET_TOKEN"
        );
      }

      // Set new password
      user.password = password;
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;

      await user.save({ session });

      // Revoke all refresh tokens for this user
      await RefreshToken.revokeAllForUser(user._id, session);

      await session.commitTransaction();
      session.endSession();

      logger.info("Password reset completed", {
        userId: user._id,
        email: user.email,
        requestId: req.id,
      });

      return apiResponse.success(
        res,
        200,
        "Password Reset",
        "Password reset successful"
      );
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  } catch (error) {
    logger.error("Error resetting password", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(
      res,
      500,
      "Reset Failed",
      "Error resetting password",
      "PASSWORD_RESET_ERROR"
    );
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

    // Input validation
    if (!currentPassword || !newPassword) {
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Current password and new password are required",
        "MISSING_PASSWORD_FIELDS"
      );
    }

    // Start a transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Get user with password
      const user = await User.findById(req.user._id)
        .select("+password")
        .session(session);

      if (!user) {
        await session.abortTransaction();
        session.endSession();

        return apiResponse.notFound(
          res,
          "Not Found",
          "User not found",
          "USER_NOT_FOUND"
        );
      }

      // Check current password
      if (!(await user.matchPassword(currentPassword))) {
        await session.abortTransaction();
        session.endSession();

        logger.warn("Invalid current password in update attempt", {
          userId: user._id,
          requestId: req.id,
        });

        return apiResponse.badRequest(
          res,
          "Invalid Password",
          "Current password is incorrect",
          "INVALID_CURRENT_PASSWORD"
        );
      }

      // Update password
      user.password = newPassword;
      await user.save({ session });

      // Revoke all refresh tokens for this user
      await RefreshToken.revokeAllForUser(user._id, session);

      // Create notification for password update
      await notificationService.createNotification(
        user._id,
        "Password updated Successfully",
        `Your password has been updated successfully.`,
        "system",
        {},
        session
      );

      await session.commitTransaction();
      session.endSession();

      logger.info("Password updated", {
        userId: user._id,
        requestId: req.id,
      });

      return apiResponse.success(
        res,
        200,
        "Password Updated",
        "Password updated successfully"
      );
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  } catch (error) {
    logger.error("Error updating password", {
      userId: req.user?._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(
      res,
      500,
      "Update Failed",
      "Error updating password",
      "PASSWORD_UPDATE_ERROR"
    );
  }
};

/**
 * Generate secure request token for sensitive operations
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.generateSecureRequestToken = (req, res) => {
  try {
    const userId = req.user._id;
    const { action } = req.body;

    // Validate required action
    if (!action) {
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Action is required",
        "ACTION_REQUIRED"
      );
    }

    // Generate challenge token for this user/action
    const challengeToken = generateChallengeToken(userId, action);

    logger.info("Challenge token generated", {
      userId,
      action,
      requestId: req.id,
    });

    return apiResponse.success(
      res,
      200,
      "Token Generated",
      "Challenge token generated",
      {
        challengeToken,
      }
    );
  } catch (error) {
    logger.error("Error generating challenge token", {
      userId: req.user?._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(
      res,
      500,
      "Token Generation Failed",
      "Error generating challenge token",
      "TOKEN_GENERATION_ERROR"
    );
  }
};
