const mongoose = require("mongoose");
const User = require("../models/User");
const { logger } = require("../config/logger");
const apiResponse = require("../utils/apiResponse");
const config = require("../config/config");
const passport = require("../config/passport");

/**
 * Authentication middleware using passport-jwt
 * Authenticates user and adds user object to req
 */
const authenticate = (req, res, next) => {
  
  passport.authenticate("jwt", { session: false }, (err, user, info) => {
    if (err) {
      logger.error("Authentication error", {
        error: err.message,
        stack: err.stack,
        requestId: req.id,
      });
      return next(err);
    }

    if (!user) {
      logger.warn("Authentication failed", {
        info: info ? info.message : "No user found",
        ip: req.ip,
        requestId: req.id,
      });

      return res.status(401).json({
        status: "error",
        message: info ? info.message : "Authentication required",
      });
    }

    // Check if user is active
    if (user.status !== "active") {
      logger.warn("Access attempt by inactive user", {
        userId: user._id,
        status: user.status,
        requestId: req.id,
      });

      return res.status(403).json({
        status: "error",
        message: "Account is not active. Please contact support.",
      });
    }

    req.user = user;

    logger.info("User authenticated", {
      userId: user._id,
      username: user.username,
      requestId: req.id,
    });

    return next();
  })(req, res, next);
};

/**
 * Authorization middleware to restrict access based on user role
 * @param {Array} roles - Array of roles allowed to access the route
 */
const authorize = (roles = []) => {
  if (typeof roles === "string") {
    roles = [roles];
  }

  return (req, res, next) => {
    if (!req.user) {
      logger.error("Authorization attempted without authentication", {
        ip: req.ip,
        requestId: req.id,
      });

      return res.status(401).json({
        status: "error",
        message: "Authentication required",
      });
    }

    if (roles.length && !roles.includes(req.user.role)) {
      logger.warn("Unauthorized access attempt", {
        userId: req.user._id,
        userRole: req.user.role,
        requiredRoles: roles,
        requestId: req.id,
      });

      return res.status(403).json({
        status: "error",
        message: "You do not have permission to perform this action",
      });
    }

    logger.info("User authorized", {
      userId: req.user._id,
      userRole: req.user.role,
      requiredRoles: roles,
      requestId: req.id,
    });

    next();
  };
};

/**
 * Transaction verification middleware
 * Ensures user owns the resources they're trying to interact with
 */
const verifyResourceOwnership = (model) => async (req, res, next) => {
  try {
    const resourceId = req.params.id;

    if (!resourceId) {
      return res.status(400).json({
        status: "error",
        message: "Resource ID is required",
      });
    }

    const resource = await model.findById(resourceId);

    if (!resource) {
      return res.status(404).json({
        status: "error",
        message: "Resource not found",
      });
    }

    // Check if resource belongs to user
    if (resource.user && resource.user.toString() !== req.user._id.toString()) {
      logger.warn("Unauthorized resource access attempt", {
        userId: req.user._id,
        resourceId: resourceId,
        resourceType: model.modelName,
        requestId: req.id,
      });

      return res.status(403).json({
        status: "error",
        message: "You do not have permission to access this resource",
      });
    }

    // Add resource to request for further use
    req.resource = resource;
    next();
  } catch (error) {
    logger.error("Error verifying resource ownership", {
      error: error.message,
      stack: error.stack,
      userId: req.user ? req.user._id : "unauthenticated",
      requestId: req.id,
    });

    next(error);
  }
};

/**
 * Middleware to verify user passcode
 * Requires authentication middleware to be run first
 */
// const verifyPasscode = async (req, res, next) => {
//   try {
//     // Get passcode from custom header
//     const passcodeSecurity = req.headers["x-passcode-auth"];
//     const userId = req.user._id;

//     logger.debug("Passcode verification attempt", {
//       userId,
//       hasPasscodeHeader: !!passcodeSecurity,
//       requestId: req.id,
//     });

//     if (!passcodeSecurity) {
//       return apiResponse.badRequest(
//         res,
//         "Passcode header is required for this operation"
//       );
//     }

//     // Get user and explicitly select the passcodeHash, passcodeAttemptLeft, and status fields
//     const user = await User.findById(userId).select(
//       "+passcodeHash passcodeAttemptLeft status"
//     );

//     if (!user) {
//       return apiResponse.notFound(res, "User not found");
//     }

//     // Check if user has set a passcode
//     if (!user.passcodeHash) {
//       return apiResponse.badRequest(
//         res,
//         "Passcode not set. Please set a passcode first."
//       );
//     }

//     // Check if user is allowed to attempt passcode verification
//     if (user.passcodeAttemptLeft <= 0 || user.status !== "active") {
//       return apiResponse.forbidden(
//         res,
//         "Passcode attempts exhausted. Account is locked."
//       );
//     }

//     // Log detailed info about user's passcode status (only in development)
//     if (process.env.NODE_ENV === "development") {
//       logger.debug("Passcode verification details", {
//         userId,
//         hasPasscodeHash: !!user.passcodeHash,
//         passcodeAttemptLeft: user.passcodeAttemptLeft,
//         status: user.status,
//         requestId: req.id,
//       });
//     }

//     // Compare passcode hashes
//     if (passcodeSecurity !== user.passcodeHash) {
//       // Deduct one attempt
//       user.passcodeAttemptLeft -= 1;

//       // If attempts are exhausted, lock the account
//       if (user.passcodeAttemptLeft <= 0) {
//         user.status = "passcode_locked";
//       }

//       await user.save();

//       if (process.env.NODE_ENV === "development") {
//         logger.debug("Passcode hash mismatch", {
//           userId,
//           headerHashPrefix: passcodeSecurity.substring(0, 8) + "...",
//           storedHashPrefix: user.passcodeHash
//             ? user.passcodeHash.substring(0, 8) + "..."
//             : "undefined",
//           remainingAttempts: user.passcodeAttemptLeft,
//           requestId: req.id,
//         });
//       }

//       return apiResponse.unauthorized(
//         res,
//         `Invalid passcode. ${user.passcodeAttemptLeft} attempts left.`
//       );
//     }

//     // If passcode is confirmed, reset attempts to max value if needed and ensure account status is active
//     const maxAttempts = config.security.passcodeMaxAttempts || 5;

//     if (
//       user.passcodeAttemptLeft < maxAttempts ||
//       user.status === "passcode_locked"
//     ) {
//       user.passcodeAttemptLeft = maxAttempts;

//       // Only update status if it's passcode_locked
//       if (user.status === "passcode_locked") {
//         user.status = "active";
//       }

//       await user.save();
//     }

//     logger.debug("Passcode verification successful", {
//       userId,
//       requestId: req.id,
//     });

//     next();
//   } catch (error) {
//     logger.error("Passcode verification error:", {
//       error: error.message,
//       stack: error.stack,
//       userId: req.user?._id,
//       requestId: req.id,
//     });

//     return apiResponse.error(res, 500, "Error verifying passcode");
//   }
// };

const verifyPasscode = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const passcodeSecurity = req.headers["x-passcode-auth"];
    const userId = req.user._id;

    logger.debug("Passcode verification attempt", {
      userId,
      hasPasscodeHeader: !!passcodeSecurity,
      requestId: req.id,
    });

    if (!passcodeSecurity) {
      await session.abortTransaction();
      session.endSession();
      return apiResponse.badRequest(
        res,
        "Passcode header is required for this operation"
      );
    }

    const user = await User.findById(userId)
      .select("+passcodeHash passcodeAttemptLeft status")
      .session(session); // Ensure session is used

    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return apiResponse.notFound(res, "User not found");
    }

    if (!user.passcodeHash) {
      await session.abortTransaction();
      session.endSession();
      return apiResponse.badRequest(
        res,
        "Passcode not set. Please set a passcode first."
      );
    }

    if (user.passcodeAttemptLeft <= 0 || user.status !== "active") {
      await session.abortTransaction();
      session.endSession();
      return apiResponse.forbidden(
        res,
        "Passcode attempts exhausted. Account is locked."
      );
    }

    const isMatch = await user.matchPasscode(passcodeSecurity);





    if (!isMatch) {
      user.passcodeAttemptLeft -= 1;

      if (user.passcodeAttemptLeft <= 0) {
        user.status = "passcode_locked";
      }

      await user.save({ session });

      if (process.env.NODE_ENV === "development") {
        logger.debug("Passcode hash mismatch", {
          userId,
          headerHashPrefix: passcodeSecurity.substring(0, 8) + "...",
          storedHashPrefix: user.passcodeHash
            ? user.passcodeHash.substring(0, 8) + "..."
            : "undefined",
          remainingAttempts: user.passcodeAttemptLeft,
          requestId: req.id,
        });
      }

      await session.commitTransaction();
      session.endSession();

      return apiResponse.unauthorized(
        res,
        `Invalid passcode. ${user.passcodeAttemptLeft} attempts left.`
      );
    }

    // If passcode is correct, reset attempts and unlock the account if needed
    const maxAttempts = config.security.passcodeMaxAttempts || 5;

    if (
      user.passcodeAttemptLeft < maxAttempts ||
      user.status === "passcode_locked"
    ) {
      user.passcodeAttemptLeft = maxAttempts;

      if (user.status === "passcode_locked") {
        user.status = "active";
      }

      await user.save({ session });
    }

    await session.commitTransaction();
    session.endSession();

    logger.debug("Passcode verification successful", {
      userId,
      requestId: req.id,
    });

    next();
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    logger.error("Passcode verification error:", {
      error: error.message,
      stack: error.stack,
      userId: req.user?._id,
      requestId: req.id,
    });

    return apiResponse.error(res, 500, "Error verifying passcode");
  }
};



/**
 * Middleware to authorize users based on roles
 * Requires authentication middleware to be run first
 * @param {string|string[]} roles - Role or array of roles allowed to access the route
 * @returns {Function} - Express middleware function
 */
const hasRole = (roles) => {
  return (req, res, next) => {
    try {
      // Make sure user object exists (auth middleware should have set this)
      if (!req.user) {
        logger.warn("Role check attempted without authentication", {
          path: req.originalUrl,
          method: req.method,
          requestId: req.id,
        });

        return apiResponse.unauthorized(res, "Authentication required");
      }

      // Convert single role to array
      const allowedRoles = Array.isArray(roles) ? roles : [roles];

      // Get user's role from auth middleware
      const userRole = req.user.role;

      logger.debug("Role check", {
        userId: req.user._id,
        userRole,
        allowedRoles,
        requestId: req.id,
      });

      // Always allow 'admin' role for any endpoint
      if (userRole === "admin" || allowedRoles.includes(userRole)) {
        return next();
      }

      // If role check fails, log and return forbidden
      logger.warn("Unauthorized role access attempt", {
        userId: req.user._id,
        userRole,
        allowedRoles,
        path: req.originalUrl,
        method: req.method,
        requestId: req.id,
      });

      return apiResponse.forbidden(
        res,
        "You don't have permission to perform this action"
      );
    } catch (error) {
      logger.error("Role check error", {
        error: error.message,
        stack: error.stack,
        userId: req.user?._id,
        requestId: req.id,
      });

      return apiResponse.error(res, 500, "Error checking permissions");
    }
  };
};

module.exports = {
  authenticate,
  authorize,
  verifyResourceOwnership,
  verifyPasscode,
  hasRole,
};
