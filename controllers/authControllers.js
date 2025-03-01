// const bcrypt = require("bcryptjs");
// const crypto = require("crypto");
// const jwt = require("jsonwebtoken");
// const User = require("../models/user");
// const Account = require("../models/account");
// const CustomError = require("../utils/customError");
// const logger = require("../utils/logger");
// const Wallet = require("../models/wallet");
// const Transaction = require("../models/transaction");
// const Bill = require("../models/bill");
// const RefreshToken = require("../models/refreshToken");

// const generateRefreshToken = async (userId) => {
//   // Generate refresh token
//   const refreshToken = crypto.randomBytes(40).toString("hex");

//   // Save refresh token in database with expiry
//   const refreshTokenDoc = new RefreshToken({
//     token: refreshToken,
//     userId: userId,
//     expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
//   });

//   await refreshTokenDoc.save();
//   return refreshToken;
// };

// /**
//  * Login user and return user data with token
//  * @route POST /api/auth/login
//  * @access Public
//  */
// const loginUser = async (req, res, next) => {
//   try {
//     const { email, password } = req.body;

//     // Ensure all models are imported
//     const User = require("../models/user");
//     const Account = require("../models/account");
//     const Card = require("../models/card");

//     // Find the user
//     const user = await User.findOne({ email }).select("+password");

//     if (!user) {
//       throw new CustomError(401, "Invalid credentials");
//     }

//     // Verify password
//     const isMatch = await bcrypt.compare(password, user.password);
//     if (!isMatch) {
//       throw new CustomError(401, "Invalid credentials");
//     }

//     // Get user accounts with their transactions
//     let accounts = [];
//     if (user.accounts && user.accounts.length > 0) {
//       accounts = await Account.find({ _id: { $in: user.accounts } }).select(
//         "name accountNumber availableBalance ledgerBalance"
//       );

//       // Optionally populate transactions only if needed
//       // This is safer than trying to populate if we're not sure about the schema structure
//     }

//     // Get user cards
//     let cards = [];
//     if (user.cards && user.cards.length > 0) {
//       cards = await Card.find({ _id: { $in: user.cards } });
//       // .select(
//       //   "cardNumber cardType status expiryDate"
//       // );

//       // Optionally populate transactions only if needed
//     }

//     // Get transactions
//     let transactions = [];
//     if (user.transactions && user.transactions.length > 0) {
//       transactions = await Transaction.find({
//         _id: { $in: user.transactions },
//       });
//       // .select(
//       //   "cardNumber cardType status expiryDate"
//       // );

//       // Optionally populate transactions only if needed
//     }

//     // Get wallets
//     let wallets = [];
//     if (user.wallets && user.wallets.length > 0) {
//       wallets = await Wallet.find({
//         _id: { $in: user.wallets },
//       });
//       // .select(
//       //   "cardNumber cardType status expiryDate"
//       // );

//       // Optionally populate transactions only if needed
//     }

//     let bills = [];
//     if (user.bills && user.bills.length > 0) {
//       bills = await Bill.find({
//         _id: { $in: user.bills },
//       });
//       // .select(
//       //   "cardNumber cardType status expiryDate"
//       // );

//       // Optionally populate transactions only if needed
//     }

//     // Format the response
//     const userData = {
//       id: user._id.toString(),
//       name: `${user.firstName} ${user.lastName}`,
//       email: user.email,
//       role: user.role,
//       accounts: accounts.map((account) => ({
//         id: account._id.toString(),
//         name: account.name,
//         accountNumber: account.accountNumber,
//         availableBalance: account.availableBalance,
//         ledgerBalance: account.ledgerBalance,
//       })),
//       cards: cards.map((card) => ({
//         id: card._id.toString(),
//         cardNumber: card.cardNumber,
//         cardType: card.cardType,
//         status: card.status,
//         expiryDate: card.expiryDate,
//       })),
//       transactions: transactions.map((transaction) => ({
//         id: transaction._id.toString(),
//         ...transaction,
//       })),
//       wallets: wallets.map((wallet) => ({
//         id: wallet._id.toString(),
//         ...wallet,
//       })),
//       bills: bills.map((bill) => ({
//         id: bill._id.toString(),
//         ...bill,
//       })),
//     };

//     // Generate tokens
//     const token = jwt.sign(
//       { id: user._id, role: user.role },
//       process.env.JWT_SECRET,
//       { expiresIn: process.env.JWT_EXPIRES_IN || "1d" }
//     );

//     const refreshToken = await generateRefreshToken(user._id);

//     // Log successful login
//     logger.info("User logged in successfully", {
//       userId: user._id,
//       email: user.email,
//       ip: req.ip,
//       timestamp: new Date().toISOString(),
//       requestId: req.id,
//     });

//     res.status(200).json({
//       status: "success",
//       message: "Login successful",
//       //   token,
//       data: {
//         user: { ...userData, hasPasscode: !!user.passcodeHash },
//         token: token,
//         refreshToken: refreshToken,
//       },
//     });
//   } catch (error) {
//     logger.error("Login error:", {
//       error: error.message,
//       stack: error.stack,
//       requestId: req.id,
//       ip: req.ip,
//       body: req.body,
//       timestamp: new Date().toISOString(),
//       url: req.url,
//       method: req.method,
//       query: req.query,
//       params: req.params,
//       user: "unauthenticated",
//     });

//     next(error);
//   }
// };

// /**
//  * Refresh access token using refresh token
//  * @route POST /api/auth/refresh-token
//  * @access Public
//  */
// const refreshToken = async (req, res, next) => {
//   try {
//     const { refreshToken } = req.body;

//     if (!refreshToken) {
//       throw new CustomError(400, "Refresh token is required");
//     }

//     // Find the refresh token in the database
//     const refreshTokenDoc = await RefreshToken.findOne({ 
//       token: refreshToken,
//       expiresAt: { $gt: new Date() } 
//     });

//     if (!refreshTokenDoc) {
//       throw new CustomError(401, "Invalid or expired refresh token");
//     }

//     // Get the user
//     const user = await User.findById(refreshTokenDoc.userId);
//     if (!user) {
//       throw new CustomError(401, "User not found");
//     }

//     // Delete the used refresh token
//     await RefreshToken.deleteOne({ _id: refreshTokenDoc._id });

//     // Generate new tokens
//     const newToken = jwt.sign(
//       { id: user._id, role: user.role },
//       process.env.JWT_SECRET,
//       { expiresIn: "1h" }
//     );
//     const newRefreshToken = await generateRefreshToken(user._id);

//     res.status(200).json({
//       success: true,
//       data: {
//         token: newToken,
//         refreshToken: newRefreshToken
//       }
//     });
//   } catch (error) {
//     logger.error("Token refresh error:", {
//       error: error.message,
//       stack: error.stack,
//       requestId: req.id,
//       ip: req.ip,
//       timestamp: new Date().toISOString(),
//     });
//     next(error);
//   }
// };

// /**
//  * Logout user (invalidate token on client side)
//  * @route POST /api/auth/logout
//  * @access Private
//  */
// const logoutUser = async (req, res, next) => {
//   console.log("Logout user", req.user);
//   try {
//     // Since JWT is stateless, we can't invalidate the token on the server side
//     // The client will need to remove the token from storage

//     // Log logout event
//     logger.info("User logged out", {
//       userId: req.user._id,
//       email: req.user.email,
//       requestId: req.id,
//       ip: req.ip,
//       timestamp: new Date().toISOString(),
//     });

//     res.status(200).json({
//       status: "success",
//       message: "Logged out successfully",
//     });
//   } catch (error) {
//     logger.error("Logout error:", {
//       error: error.message,
//       stack: error.stack,
//       requestId: req.id,
//       userId: req.user?._id,
//       ip: req.ip,
//       timestamp: new Date().toISOString(),
//     });

//     next(error);
//   }
// };

// /**
//  * Get current user data with their accounts and cards
//  * @route GET /api/auth/me
//  * @access Private
//  */
// const getCurrentUser = async (req, res, next) => {
//   try {
//     // Import required models
//     const User = require("../models/user");
//     const Account = require("../models/account");
//     const Card = require("../models/card");

//     // Fetch fresh user data (user is already available from auth middleware)
//     const userId = req.user._id;

//     // Get user with basic populated data
//     const user = await User.findById(userId).select("-password");

//     if (!user) {
//       throw new CustomError(404, "User not found");
//     }

//     // Get accounts with their details
//     let accounts = [];
//     if (user.accounts && user.accounts.length > 0) {
//       accounts = await Account.find({ _id: { $in: user.accounts } }).select(
//         "name accountNumber availableBalance ledgerBalance"
//       );

//       // If you have the transactions relationship properly set up, you can add:
//       // .populate({
//       //   path: "transactions",
//       //   select: "type amount description narration status createdAt",
//       //   options: { sort: { createdAt: -1 }, limit: 10 } // Get only recent transactions
//       // });
//     }

//     // Get cards with their details
//     let cards = [];
//     if (user.cards && user.cards.length > 0) {
//       cards = await Card.find({ _id: { $in: user.cards } }).select(
//         "cardNumber cardType status expiryDate"
//       );

//       // If you have the transactions relationship properly set up, you can add:
//       // .populate({
//       //   path: "transactions",
//       //   select: "type amount description narration status createdAt",
//       //   options: { sort: { createdAt: -1 }, limit: 10 } // Get only recent transactions
//       // });
//     }

//     // Format the response data
//     const userData = {
//       id: user._id.toString(),
//       firstName: user.firstName,
//       lastName: user.lastName,
//       fullName: user.fullName || `${user.firstName} ${user.lastName}`,
//       email: user.email,
//       phone: user.phone,
//       username: user.username,
//       kycStatus: user.kycStatus,
//       role: user.role,
//       mfaEnabled: user.mfaEnabled,
//       dateOfBirth: user.dateOfBirth,
//       address: user.address,
//       picture: user.picture,
//       accounts: accounts.map((account) => ({
//         id: account._id.toString(),
//         name: account.name,
//         accountNumber: account.accountNumber,
//         availableBalance: account.availableBalance,
//         ledgerBalance: account.ledgerBalance,
//       })),
//       cards: cards.map((card) => ({
//         id: card._id.toString(),
//         cardNumber: card.cardNumber,
//         cardType: card.cardType,
//         status: card.status,
//         expiryDate: card.expiryDate,
//       })),
//       // Add any other required user data
//     };

//     // Return response
//     res.status(200).json({
//       status: "success",
//       message: "User data retrieved successfully",
//       data: {
//         user: userData,
//       },
//     });
//   } catch (error) {
//     logger.error("Get current user error:", {
//       error: error.message,
//       stack: error.stack,
//       userId: req.user?._id,
//       requestId: req.id,
//       ip: req.ip,
//       timestamp: new Date().toISOString(),
//     });

//     next(error);
//   }
// };

// /**
//  * Setup user passcode
//  * @route POST /api/auth/setup-passcode
//  * @access Private
//  */
// const setupPasscode = async (req, res, next) => {
//   try {
//     const { passcode } = req.body;
//     const userId = req.user._id;

//     if (!passcode || passcode.length < 4) {
//       throw new CustomError(400, "Passcode must be at least 4 characters");
//     }

//     // Hash the passcode
//     const passcodeHash = crypto
//       .createHash('sha256')
//       .update(passcode)
//       .digest('hex');

//     // Update user with passcode hash
//     await User.findByIdAndUpdate(userId, { passcodeHash });

//     res.status(200).json({
//       status: "success",
//       message: "Passcode set successfully"
//     });
//   } catch (error) {
//     logger.error("Setup passcode error:", {
//       error: error.message,
//       stack: error.stack,
//       userId: req.user?._id,
//       requestId: req.id,
//       timestamp: new Date().toISOString(),
//     });
//     next(error);
//   }
// };


// const changePasscode = async (req, res, next) => {
//   try {
//     const { newPasscode } = req.body;
//     const userId = req.user._id;

//     if (!newPasscode || newPasscode.length < 4) {
//       throw new CustomError(400, "New passcode must be at least 4 characters");
//     }

//     // The old passcode is verified by the verifyPasscodeAndAuth middleware
//     // So if we're here, the old passcode is valid

//     // Hash the new passcode
//     const passcodeHash = crypto
//       .createHash("sha256")
//       .update(newPasscode)
//       .digest("hex");

//     // Update user with new passcode hash
//     await User.findByIdAndUpdate(userId, { passcodeHash });

//     res.status(200).json({
//       success: true,
//       message: "Passcode changed successfully",
//     });
//   } catch (error) {
//     next(error);
//   }
// };


// /**
//  * Validate user passcode
//  * @route POST /api/auth/validate-passcode
//  * @access Private (requires passcode auth)
//  */
// const validatePasscode = async (req, res, next) => {
//   try {
//     // The passcode is verified by the verifyPasscodeAndAuth middleware
//     // So if we're here, the passcode is valid
    
//     res.status(200).json({
//       status: "success",
//       data: { valid: true }
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// const validatePin = (pin) => {
//   return /^\d{4}$/.test(pin);
// };

// /**
//  * Update PIN for authenticated user (requires current PIN)
//  * @route POST /api/pin/update
//  * @access Private (requires authentication and passcode verification)
//  */
// const updatePin = async (req, res, next) => {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   const requestId = req.id;
//   const userId = req.user._id;

//   try {
//     const { currentPin, newPin } = req.body;

//     logger.debug("PIN update request", {
//       requestId,
//       userId,
//     });

//     if (!currentPin || !newPin) {
//       throw new CustomError(400, "Current PIN and new PIN are required");
//     }

//     // Validate new PIN
//     if (!validatePin(newPin)) {
//       logger.warn("PIN update failed: Invalid new PIN format", {
//         requestId,
//         userId,
//       });

//       throw new ValidationError([
//         {
//           field: "newPin",
//           message: "PIN must be exactly 4 digits",
//           code: "INVALID_PIN",
//         },
//       ]);
//     }

//     // Get user with current PIN
//     const user = await User.findById(userId).select("+pin").session(session);

//     // Verify current PIN
//     const isPinMatch = await bcrypt.compare(currentPin, user.pin);
//     if (!isPinMatch) {
//       logger.warn("PIN update failed: Current PIN verification failed", {
//         requestId,
//         userId,
//       });

//       throw new CustomError(401, "Current PIN is incorrect");
//     }

//     // Generate verification token
//     const verificationToken = crypto.randomBytes(32).toString("hex");
//     const tokenExpiry = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

//     // Store pending PIN update
//     const hashedNewPin = await bcrypt.hash(newPin, 10);
//     await User.findByIdAndUpdate(userId, {
//       "pendingUpdates.token": verificationToken,
//       "pendingUpdates.expiry": tokenExpiry,
//       "pendingUpdates.fields": [
//         {
//           field: "pin",
//           value: hashedNewPin,
//         },
//       ],
//     }).session(session);

//     // Send verification email
//     await sendVerificationEmail(user.email, verificationToken, ["PIN"]);

//     await session.commitTransaction();
//     session.endSession();

//     logger.info("PIN update initiated: Verification email sent", {
//       requestId,
//       userId,
//       email: user.email,
//     });

//     res.status(200).json({
//       status: "success",
//       message: "Check your email to verify PIN update",
//     });
//   } catch (error) {
//     if (session.inTransaction()) {
//       await session.abortTransaction();
//     }
//     session.endSession();

//     logger.error("PIN update error:", {
//       error: error.message,
//       stack: error.stack,
//       requestId,
//       userId,
//     });

//     next(error);
//   }
// };

// /**
//  * Request PIN reset (for authenticated user who forgot PIN)
//  * @route POST /api/pin/reset-request
//  * @access Private (requires authentication)
//  */
// const requestPinReset = async (req, res, next) => {
//   const requestId = req.id;
//   const userId = req.user._id;

//   try {
//     // Get user data
//     const user = await User.findById(userId);

//     logger.debug("PIN reset request initiated", {
//       requestId,
//       userId,
//       email: user.email,
//     });

//     // Generate reset token
//     const resetToken = crypto.randomBytes(32).toString("hex");
//     const tokenExpiry = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

//     // Store reset token
//     user.pinResetToken = resetToken;
//     user.pinResetExpiry = tokenExpiry;
//     await user.save();

//     // Send email with reset link
//     await sendPinResetEmail(user.email, resetToken);

//     logger.info("PIN reset requested: Verification email sent", {
//       requestId,
//       userId,
//       email: user.email,
//     });

//     res.status(200).json({
//       status: "success",
//       message: "PIN reset instructions sent to your email",
//     });
//   } catch (error) {
//     logger.error("PIN reset request error:", {
//       error: error.message,
//       stack: error.stack,
//       requestId,
//       userId,
//     });
//     next(error);
//   }
// };

// /**
//  * Verify PIN reset and set new PIN
//  * @route POST /api/pin/verify-reset
//  * @access Private (requires authentication)
//  */
// const verifyPinReset = async (req, res, next) => {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   const requestId = req.id;
//   const userId = req.user._id;

//   try {
//     const { token, newPin } = req.body;

//     logger.debug("PIN reset verification attempt", {
//       requestId,
//       userId,
//     });

//     if (!token || !newPin) {
//       throw new CustomError(400, "Token and new PIN are required");
//     }

//     // Validate new PIN
//     if (!validatePin(newPin)) {
//       logger.warn("PIN reset failed: Invalid new PIN format", {
//         requestId,
//         userId,
//       });

//       throw new ValidationError([
//         {
//           field: "newPin",
//           message: "PIN must be exactly 4 digits",
//           code: "INVALID_PIN",
//         },
//       ]);
//     }

//     // Find user with valid reset token
//     const user = await User.findOne({
//       _id: userId,
//       pinResetToken: token,
//       pinResetExpiry: { $gt: new Date() },
//     }).session(session);

//     if (!user) {
//       logger.warn("PIN reset failed: Invalid or expired token", {
//         requestId,
//         userId,
//       });

//       throw new CustomError(400, "Invalid or expired reset token");
//     }

//     // Hash new PIN
//     const hashedPin = await bcrypt.hash(newPin, 10);

//     // Update PIN and clear reset token
//     user.pin = hashedPin;
//     user.pinResetToken = undefined;
//     user.pinResetExpiry = undefined;
//     await user.save({ session });

//     await session.commitTransaction();
//     session.endSession();

//     logger.info("PIN reset successful", {
//       requestId,
//       userId,
//     });

//     res.status(200).json({
//       status: "success",
//       message: "PIN has been reset successfully",
//     });
//   } catch (error) {
//     if (session.inTransaction()) {
//       await session.abortTransaction();
//     }
//     session.endSession();

//     logger.error("PIN reset verification error:", {
//       error: error.message,
//       stack: error.stack,
//       requestId,
//       userId,
//     });
//     next(error);
//   }
// };

// /**
//  * Admin reset user PIN (generates random PIN and sends to user)
//  * @route POST /api/pin/admin/reset/:userId
//  * @access Private (requires admin role)
//  */
// const adminResetPin = async (req, res, next) => {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   const requestId = req.id;
//   const adminId = req.user._id;
//   const targetUserId = req.params.userId;

//   try {
//     logger.debug("Admin PIN reset initiated", {
//       requestId,
//       adminId,
//       targetUserId,
//     });

//     // Check if target user exists
//     const user = await User.findById(targetUserId).session(session);
//     if (!user) {
//       throw new CustomError(404, "User not found");
//     }

//     // Generate secure random temporary PIN
//     const tempPin = Math.floor(1000 + Math.random() * 9000).toString();

//     // Hash the PIN
//     const hashedPin = await bcrypt.hash(tempPin, 10);

//     // Set force PIN change flag
//     user.pin = hashedPin;
//     user.forcePinChange = true;
//     await user.save({ session });

//     // Could send PIN via SMS in production
//     // For now, just log it and send via email
//     await sendPinResetEmail(
//       user.email,
//       null, // No token needed
//       tempPin
//     );

//     await session.commitTransaction();
//     session.endSession();

//     logger.info("Admin PIN reset successful", {
//       requestId,
//       adminId,
//       targetUserId,
//       email: user.email,
//     });

//     res.status(200).json({
//       status: "success",
//       message: "Temporary PIN generated and sent to user",
//       data: {
//         tempPin, // Only include in development environment
//       },
//     });
//   } catch (error) {
//     if (session.inTransaction()) {
//       await session.abortTransaction();
//     }
//     session.endSession();

//     logger.error("Admin PIN reset error:", {
//       error: error.message,
//       stack: error.stack,
//       requestId,
//       adminId,
//       targetUserId,
//     });
//     next(error);
//   }
// };

// /**
//  * Admin set user PIN directly
//  * @route POST /api/pin/admin/set/:userId
//  * @access Private (requires admin role)
//  */
// const adminSetPin = async (req, res, next) => {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   const requestId = req.id;
//   const adminId = req.user._id;
//   const targetUserId = req.params.userId;

//   try {
//     const { newPin, forcePinChange = true } = req.body;

//     logger.debug("Admin PIN set initiated", {
//       requestId,
//       adminId,
//       targetUserId,
//       forcePinChange,
//     });

//     if (!newPin) {
//       throw new CustomError(400, "New PIN is required");
//     }

//     // Validate PIN
//     if (!validatePin(newPin)) {
//       logger.warn("Admin PIN set failed: Invalid PIN format", {
//         requestId,
//         adminId,
//         targetUserId,
//       });

//       throw new ValidationError([
//         {
//           field: "newPin",
//           message: "PIN must be exactly 4 digits",
//           code: "INVALID_PIN",
//         },
//       ]);
//     }

//     // Check if target user exists
//     const user = await User.findById(targetUserId).session(session);
//     if (!user) {
//       throw new CustomError(404, "User not found");
//     }

//     // Hash the PIN
//     const hashedPin = await bcrypt.hash(newPin, 10);

//     // Update user with new PIN
//     user.pin = hashedPin;
//     user.forcePinChange = forcePinChange;
//     await user.save({ session });

//     // Create admin action log
//     await AdminActionLog.create(
//       {
//         adminId,
//         userId: targetUserId,
//         action: "SET_PIN",
//         metadata: { forcePinChange },
//       },
//       { session }
//     );

//     await session.commitTransaction();
//     session.endSession();

//     logger.info("Admin PIN set successful", {
//       requestId,
//       adminId,
//       targetUserId,
//       forcePinChange,
//     });

//     res.status(200).json({
//       status: "success",
//       message: `User PIN set successfully${
//         forcePinChange
//           ? ". User will be required to change PIN on next login"
//           : ""
//       }`,
//     });
//   } catch (error) {
//     if (session.inTransaction()) {
//       await session.abortTransaction();
//     }
//     session.endSession();

//     logger.error("Admin PIN set error:", {
//       error: error.message,
//       stack: error.stack,
//       requestId,
//       adminId,
//       targetUserId,
//     });
//     next(error);
//   }
// };

// module.exports = {
//   loginUser,
//   logoutUser,
//   getCurrentUser,
//   refreshToken,
//   setupPasscode,
//   changePasscode,
//   validatePasscode,
//   updatePin,
//   requestPinReset,
//   verifyPinReset,
//   adminResetPin,
//   adminSetPin

// };


const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const User = require("../models/user");
const Account = require("../models/account");
const CustomError = require("../utils/customError");
const logger = require("../utils/logger");
const Wallet = require("../models/wallet");
const Transaction = require("../models/transaction");
const Bill = require("../models/bill");
const RefreshToken = require("../models/refreshToken");

const generateRefreshToken = async (userId) => {
  // Generate refresh token
  const refreshToken = crypto.randomBytes(40).toString("hex");

  // Save refresh token in database with expiry
  const refreshTokenDoc = new RefreshToken({
    token: refreshToken,
    userId: userId,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
  });

  await refreshTokenDoc.save();
  return refreshToken;
};

/**
 * Login user and return user data with token
 * @route POST /api/auth/login
 * @access Public
 */
const loginUser = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Find the user
    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      throw new CustomError(401, "Invalid credentials");
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new CustomError(401, "Invalid credentials");
    }

    // Get user accounts with their transactions
    let accounts = [];
    if (user.accounts && user.accounts.length > 0) {
      accounts = await Account.find({ _id: { $in: user.accounts } }).select(
        "name accountNumber availableBalance ledgerBalance"
      );
    }

    // Get user cards, transactions, wallets, and bills
    let cards = [];
    if (user.cards && user.cards.length > 0) {
      cards = await Card.find({ _id: { $in: user.cards } });
    }

    let transactions = [];
    if (user.transactions && user.transactions.length > 0) {
      transactions = await Transaction.find({
        _id: { $in: user.transactions },
      });
    }

    let wallets = [];
    if (user.wallets && user.wallets.length > 0) {
      wallets = await Wallet.find({ _id: { $in: user.wallets } });
    }

    let bills = [];
    if (user.bills && user.bills.length > 0) {
      bills = await Bill.find({ _id: { $in: user.bills } });
    }

    // Format the response
    const userData = {
      id: user._id.toString(),
      name: `${user.firstName} ${user.lastName}`,
      email: user.email,
      role: user.role,
      accounts: accounts.map((account) => ({
        id: account._id.toString(),
        name: account.name,
        accountNumber: account.accountNumber,
        availableBalance: account.availableBalance,
        ledgerBalance: account.ledgerBalance,
      })),
      cards: cards.map((card) => ({
        id: card._id.toString(),
        cardNumber: card.cardNumber,
        cardType: card.cardType,
        status: card.status,
        expiryDate: card.expiryDate,
      })),
      transactions: transactions.map((transaction) => ({
        id: transaction._id.toString(),
        ...transaction,
      })),
      wallets: wallets.map((wallet) => ({
        id: wallet._id.toString(),
        ...wallet,
      })),
      bills: bills.map((bill) => ({
        id: bill._id.toString(),
        ...bill,
      })),
    };

    // Generate tokens
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "1d" }
    );

    const refreshToken = await generateRefreshToken(user._id);

    // Log successful login
    logger.info("User logged in successfully", {
      userId: user._id,
      email: user.email,
      ip: req.ip,
      timestamp: new Date().toISOString(),
      requestId: req.id,
    });

    res.status(200).json({
      status: "success",
      message: "Login successful",
      data: {
        user: { ...userData, hasPasscode: !!user.passcodeHash },
        token: token,
        refreshToken: refreshToken,
      },
    });
  } catch (error) {
    logger.error("Login error:", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
      ip: req.ip,
      body: req.body,
      timestamp: new Date().toISOString(),
      url: req.url,
      method: req.method,
      query: req.query,
      params: req.params,
      user: "unauthenticated",
    });

    next(error);
  }
};

/**
 * Refresh access token using refresh token
 * @route POST /api/auth/refresh-token
 * @access Public
 */
const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      throw new CustomError(400, "Refresh token is required");
    }

    // Find the refresh token in the database
    const refreshTokenDoc = await RefreshToken.findOne({
      token: refreshToken,
      expiresAt: { $gt: new Date() },
    });

    if (!refreshTokenDoc) {
      throw new CustomError(401, "Invalid or expired refresh token");
    }

    // Get the user
    const user = await User.findById(refreshTokenDoc.userId);
    if (!user) {
      throw new CustomError(401, "User not found");
    }

    // Delete the used refresh token
    await RefreshToken.deleteOne({ _id: refreshTokenDoc._id });

    // Generate new tokens
    const newToken = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    const newRefreshToken = await generateRefreshToken(user._id);

    res.status(200).json({
      success: true,
      data: {
        token: newToken,
        refreshToken: newRefreshToken,
      },
    });
  } catch (error) {
    logger.error("Token refresh error:", {
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
 * Logout user (invalidate token on client side)
 * @route POST /api/auth/logout
 * @access Private
 */
const logoutUser = async (req, res, next) => {
  try {
    // Since JWT is stateless, we can't invalidate the token on the server side
    // The client will need to remove the token from storage

    // Log logout event
    logger.info("User logged out", {
      userId: req.user._id,
      email: req.user.email,
      requestId: req.id,
      ip: req.ip,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      status: "success",
      message: "Logged out successfully",
    });
  } catch (error) {
    logger.error("Logout error:", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
      userId: req.user?._id,
      ip: req.ip,
      timestamp: new Date().toISOString(),
    });

    next(error);
  }
};

/**
 * Get current user data with their accounts and cards
 * @route GET /api/auth/me
 * @access Private
 */
const getCurrentUser = async (req, res, next) => {
  try {
    // Fetch fresh user data (user is already available from auth middleware)
    const userId = req.user._id;

    // Get user with basic populated data
    const user = await User.findById(userId).select("-password");

    if (!user) {
      throw new CustomError(404, "User not found");
    }

    // Get accounts with their details
    let accounts = [];
    if (user.accounts && user.accounts.length > 0) {
      accounts = await Account.find({ _id: { $in: user.accounts } }).select(
        "name accountNumber availableBalance ledgerBalance"
      );
    }

    // Get cards with their details
    let cards = [];
    if (user.cards && user.cards.length > 0) {
      cards = await Card.find({ _id: { $in: user.cards } }).select(
        "cardNumber cardType status expiryDate"
      );
    }

    // Format the response data
    const userData = {
      id: user._id.toString(),
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: user.fullName || `${user.firstName} ${user.lastName}`,
      email: user.email,
      phone: user.phone,
      username: user.username,
      kycStatus: user.kycStatus,
      role: user.role,
      mfaEnabled: user.mfaEnabled,
      dateOfBirth: user.dateOfBirth,
      address: user.address,
      picture: user.picture,
      accounts: accounts.map((account) => ({
        id: account._id.toString(),
        name: account.name,
        accountNumber: account.accountNumber,
        availableBalance: account.availableBalance,
        ledgerBalance: account.ledgerBalance,
      })),
      cards: cards.map((card) => ({
        id: card._id.toString(),
        cardNumber: card.cardNumber,
        cardType: card.cardType,
        status: card.status,
        expiryDate: card.expiryDate,
      })),
      hasPasscode: !!user.passcodeHash,
    };

    // Return response
    res.status(200).json({
      status: "success",
      message: "User data retrieved successfully",
      data: {
        user: userData,
      },
    });
  } catch (error) {
    logger.error("Get current user error:", {
      error: error.message,
      stack: error.stack,
      userId: req.user?._id,
      requestId: req.id,
      ip: req.ip,
      timestamp: new Date().toISOString(),
    });

    next(error);
  }
};

/**
 * Setup user passcode
 * @route POST /api/auth/setup-passcode
 * @access Private
 */
const setupPasscode = async (req, res, next) => {
  try {
    const { passcode } = req.body;
    const userId = req.user._id;

    if (!passcode || passcode.length < 4) {
      throw new CustomError(400, "Passcode must be at least 4 characters");
    }

    // Hash the passcode
    const passcodeHash = crypto
      .createHash("sha256")
      .update(passcode)
      .digest("hex");

    // Update user with passcode hash
    await User.findByIdAndUpdate(userId, { passcodeHash });

    res.status(200).json({
      status: "success",
      message: "Passcode set successfully",
    });
  } catch (error) {
    logger.error("Setup passcode error:", {
      error: error.message,
      stack: error.stack,
      userId: req.user?._id,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });
    next(error);
  }
};

/**
 * Change existing passcode
 * @route POST /api/auth/change-passcode
 * @access Private
 */
const changePasscode = async (req, res, next) => {
  try {
    const { currentPasscode, newPasscode } = req.body;
    const userId = req.user._id;

    if (!currentPasscode || !newPasscode) {
      throw new CustomError(
        400,
        "Current passcode and new passcode are required"
      );
    }

    if (newPasscode.length < 4) {
      throw new CustomError(400, "New passcode must be at least 4 characters");
    }

    // Get the user with passcode
    const user = await User.findById(userId);
    if (!user || !user.passcodeHash) {
      throw new CustomError(
        400,
        "Passcode not set up yet. Please setup a passcode first"
      );
    }

    // Verify current passcode
    const currentPasscodeHash = crypto
      .createHash("sha256")
      .update(currentPasscode)
      .digest("hex");

    if (currentPasscodeHash !== user.passcodeHash) {
      throw new CustomError(401, "Current passcode is incorrect");
    }

    // Hash the new passcode
    const newPasscodeHash = crypto
      .createHash("sha256")
      .update(newPasscode)
      .digest("hex");

    // Update user with new passcode hash
    await User.findByIdAndUpdate(userId, { passcodeHash: newPasscodeHash });

    res.status(200).json({
      success: true,
      message: "Passcode changed successfully",
    });
  } catch (error) {
    logger.error("Change passcode error:", {
      error: error.message,
      stack: error.stack,
      userId: req.user?._id,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });
    next(error);
  }
};

/**
 * Validate user passcode
 * @route POST /api/auth/validate-passcode
 * @access Private
 */
const validatePasscode = async (req, res, next) => {
  try {
    // Get passcode from custom header instead of request body
    const passcodeSecurity = req.headers["x-passcode-auth"];
    const userId = req.user._id;

    if (!passcodeSecurity) {
      throw new CustomError(400, "Passcode header is required");
    }

    // Get the user with passcode
    const user = await User.findById(userId);
    if (!user || !user.passcodeHash) {
      throw new CustomError(400, "Passcode not set up yet");
    }

    // Verify passcode - header should contain the hashed value
    const isValid = passcodeSecurity === user.passcodeHash;

    res.status(200).json({
      status: "success",
      data: { valid: isValid },
    });
  } catch (error) {
    logger.error("Validate passcode error:", {
      error: error.message,
      stack: error.stack,
      userId: req.user?._id,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });
    next(error);
  }
};

/**
 * Reset passcode (requires admin role)
 * @route POST /api/auth/admin/reset-passcode/:userId
 * @access Private (admin only)
 */
const adminResetPasscode = async (req, res, next) => {
  try {
    const targetUserId = req.params.userId;
    const adminId = req.user._id;

    // Check if admin
    if (req.user.role !== "admin") {
      throw new CustomError(
        403,
        "You don't have permission to perform this action"
      );
    }

    // Find target user
    const user = await User.findById(targetUserId);
    if (!user) {
      throw new CustomError(404, "User not found");
    }

    // Clear passcode hash
    await User.findByIdAndUpdate(targetUserId, { $unset: { passcodeHash: 1 } });

    logger.info("Admin reset user passcode", {
      adminId,
      targetUserId,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      status: "success",
      message:
        "User passcode has been reset. User needs to set up a new passcode.",
    });
  } catch (error) {
    logger.error("Admin reset passcode error:", {
      error: error.message,
      stack: error.stack,
      userId: req.user?._id,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });
    next(error);
  }
};


const adminSetPasscode = async (req, res, next) => {
  try {
    const targetUserId = req.params.userId;
    const adminId = req.user._id;
    const { passcode } = req.body;

    // Check if admin
    if (req.user.role !== "admin") {
      throw new CustomError(
        403,
        "You don't have permission to perform this action"
      );
    }

    // Validate passcode
    if (!passcode || passcode.length < 4) {
      throw new CustomError(400, "Passcode must be at least 4 characters");
    }

    // Find target user
    const user = await User.findById(targetUserId);
    if (!user) {
      throw new CustomError(404, "User not found");
    }

    // Hash the passcode
    const passcodeHash = crypto
      .createHash("sha256")
      .update(passcode)
      .digest("hex");

    // Set new passcode hash
    await User.findByIdAndUpdate(targetUserId, { passcodeHash });

    logger.info("Admin set user passcode", {
      adminId,
      targetUserId,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      status: "success",
      message: "User passcode has been set successfully.",
    });
  } catch (error) {
    logger.error("Admin set passcode error:", {
      error: error.message,
      stack: error.stack,
      userId: req.user?._id,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });
    next(error);
  }
};

/**
 * Get passcode status (Development only)
 * @route GET /api/auth/dev/passcode-status
 * @access Private (admin only, dev environment only)
 */
const getPasscodeStatus = async (req, res, next) => {
  try {
    // Only allow in development environment
    if (process.env.NODE_ENV !== "development") {
      throw new CustomError(403, "This endpoint is only available in development mode");
    }

    // Only allow for admins
    if (req.user.role !== "admin") {
      throw new CustomError(403, "Admin access required");
    }

    const { userId } = req.query;
    
    // If userId is provided, check that specific user
    // Otherwise check the current user
    const targetId = userId || req.user._id;

    // Find user and select passcodeHash
    const user = await User.findById(targetId).select("+passcodeHash");
    
    if (!user) {
      throw new CustomError(404, "User not found");
    }

    // Prepare response with masked hash for security
    const passcodeInfo = {
      userId: user._id,
      hasPasscode: !!user.passcodeHash,
      passcodeHashPrefix: user.passcodeHash ? 
        `${user.passcodeHash.substring(0, 8)}...${user.passcodeHash.substring(user.passcodeHash.length - 8)}` : 
        null,
    };

    res.status(200).json({
      status: "success",
      message: "Passcode status retrieved",
      data: passcodeInfo
    });

  } catch (error) {
    logger.error("Get passcode status error:", {
      error: error.message,
      stack: error.stack,
      userId: req.user?._id,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });
    next(error);
  }
};

/**
 * Admin tools for passcode management (Development only)
 * @route POST /api/auth/dev/hash-passcode
 * @access Private (admin only, dev environment only)
 */
const hashPasscodeForDev = async (req, res, next) => {
  try {
    // Only allow in development environment
    if (process.env.NODE_ENV !== "development") {
      throw new CustomError(403, "This endpoint is only available in development mode");
    }

    // Only allow for admins
    if (req.user.role !== "admin") {
      throw new CustomError(403, "Admin access required");
    }

    const { passcode, userId } = req.body;

    if (!passcode) {
      throw new CustomError(400, "Passcode is required");
    }

    // Generate hash from passcode
    const passcodeHash = crypto
      .createHash("sha256")
      .update(passcode)
      .digest("hex");

    let user = null;
    let matchResult = null;

    // If userId is provided, check against that user's passcode
    if (userId) {
      user = await User.findById(userId).select("+passcodeHash");
      
      if (!user) {
        throw new CustomError(404, "User not found");
      }

      matchResult = {
        userId: user._id,
        hasStoredPasscode: !!user.passcodeHash,
        isMatch: user.passcodeHash === passcodeHash
      };
    }

    // Return the hash and match info if applicable
    res.status(200).json({
      status: "success",
      data: {
        passcodeHash,
        passcodeForHeader: passcodeHash, // Add this line to make it clear this is what should go in the header
        matchResult
      }
    });

  } catch (error) {
    logger.error("Hash passcode error:", {
      error: error.message,
      stack: error.stack,
      userId: req.user?._id,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });
    next(error);
  }
};





module.exports = {
  loginUser,
  logoutUser,
  getCurrentUser,
  refreshToken,
  setupPasscode,
  changePasscode,
  validatePasscode,
  adminResetPasscode,
  adminSetPasscode,
  getPasscodeStatus,
  hashPasscodeForDev,
};