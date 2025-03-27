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
  // console.log("pppp", req.body);
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

const hasRole = (roles = []) => {
  return (req, res, next) => {
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

      // Ensure roles is an array
      const allowedRoles = Array.isArray(roles) ? roles : [roles];

      // Get user's role
      const userRole = req.user.role;

      logger.debug("Role check", {
        userId: req.user._id,
        userRole,
        allowedRoles,
        requestId: req.id,
      });

      // Allow access if user is admin or has a required role
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
    })(req, res, next);
  };
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

const verifyPasscode = async (req, res, next) => {
  const requestStartTime = Date.now();
  const requestId = req.id;
  const userId = req.user?._id;

  // console.log("e enter", req.user._id);

  logger.info("Passcode verification started", {
    userId,
    requestId,
    endpoint: `${req.method} ${req.originalUrl}`,
    clientIP: req.ip,
    userAgent: req.headers["user-agent"],
  });

  // Track session state
  let sessionActive = false;
  const session = await mongoose.startSession();

  try {
    session.startTransaction();
    sessionActive = true;
    logger.debug("MongoDB transaction started", { requestId });

    const passcodeSecurity = req.headers["x-passcode-auth"];

    logger.debug("Passcode verification attempt details", {
      userId,
      hasPasscodeHeader: !!passcodeSecurity,
      headerLength: passcodeSecurity ? passcodeSecurity.length : 0,
      requestId,
      tokenPresent: !!req.headers.authorization,
      tokenPrefix: req.headers.authorization
        ? req.headers.authorization.substring(0, 10) + "..."
        : "none",
    });

    if (!passcodeSecurity) {
      logger.warn("Missing passcode header", { userId, requestId });
      await session.abortTransaction();
      session.endSession();
      sessionActive = false;
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Passcode header is required for this operation"
      );
    }

    const user = await User.findById(userId)
      .select("+passcodeHash passcodeAttemptLeft status")
      .session(session);

    if (!user) {
      logger.warn("User not found during passcode verification", {
        userId,
        requestId,
        userIdType: typeof userId,
      });
      await session.abortTransaction();
      session.endSession();
      sessionActive = false;
      return apiResponse.notFound(res, "User not found");
    }

    logger.debug("User found for passcode verification", {
      userId,
      requestId,
      hasPasscodeHash: !!user.passcodeHash,
      passcodeAttemptLeft: user.passcodeAttemptLeft,
      userStatus: user.status,
    });

    if (!user.passcodeHash) {
      logger.warn("User has no passcode hash set", { userId, requestId });
      await session.abortTransaction();
      session.endSession();
      sessionActive = false;
      return apiResponse.badRequest(
        res,
        "Bad Request",
        "Passcode not set. Please set a passcode first."
      );
    }

    if (user.passcodeAttemptLeft <= 0 || user.status !== "active") {
      logger.warn("Account locked or attempts exhausted", {
        userId,
        requestId,
        passcodeAttemptLeft: user.passcodeAttemptLeft,
        userStatus: user.status,
      });
      await session.abortTransaction();
      session.endSession();
      sessionActive = false;
      return apiResponse.forbidden(
        res,
        "Forbidden",
        "Passcode attempts exhausted. Account is locked."
      );
    }

    // Log before matching passcode
    logger.debug("Attempting to match passcode", {
      userId,
      requestId,
      passcodeAttemptLeft: user.passcodeAttemptLeft,
    });

    let isMatch = false;
    try {
      isMatch = await user.matchPasscode(passcodeSecurity);
      logger.debug("Passcode match result", {
        userId,
        requestId,
        isMatch,
      });
    } catch (matchError) {
      logger.error("Error during passcode matching", {
        userId,
        requestId,
        error: matchError.message,
        stack: matchError.stack,
      });
      throw matchError; // Re-throw to be caught by the outer try-catch
    }

    if (!isMatch) {
      user.passcodeAttemptLeft -= 1;

      logger.warn("Passcode verification failed", {
        userId,
        requestId,
        remainingAttempts: user.passcodeAttemptLeft,
        headerHashPrefix: passcodeSecurity
          ? passcodeSecurity.substring(0, 8) + "..."
          : "undefined",
        storedHashPrefix: user.passcodeHash
          ? user.passcodeHash.substring(0, 8) + "..."
          : "undefined",
      });

      if (user.passcodeAttemptLeft <= 0) {
        user.status = "passcode_locked";
        logger.warn("Account locked due to passcode attempts exhaustion", {
          userId,
          requestId,
        });
      }

      // Save the updated user with decremented attempts
      try {
        await user.save({ session });
        logger.debug("User attempts updated successfully", {
          userId,
          requestId,
          newAttemptCount: user.passcodeAttemptLeft,
          newStatus: user.status,
        });
      } catch (saveError) {
        logger.error("Error saving user after failed passcode attempt", {
          userId,
          requestId,
          error: saveError.message,
          stack: saveError.stack,
        });
        throw saveError; // Re-throw to be caught by the outer try-catch
      }

      await session.commitTransaction();
      session.endSession();
      sessionActive = false;

      return apiResponse.unvalidated(
        res,
        "Unauthorized",
        `Invalid passcode. ${user.passcodeAttemptLeft} attempt${
          user.passcodeAttemptLeft === 1 ? "" : "s"
        } left.`
      );
    }

    // If passcode is correct, reset attempts and unlock the account if needed
    const maxAttempts = config.security.passcodeMaxAttempts || 5;
    logger.debug("Passcode verification successful", {
      userId,
      requestId,
      currentAttempts: user.passcodeAttemptLeft,
      maxAttempts,
      currentStatus: user.status,
    });

    if (
      user.passcodeAttemptLeft < maxAttempts ||
      user.status === "passcode_locked"
    ) {
      const oldStatus = user.status;
      const oldAttempts = user.passcodeAttemptLeft;

      user.passcodeAttemptLeft = maxAttempts;

      if (user.status === "passcode_locked") {
        user.status = "active";
      }

      try {
        await user.save({ session });
        logger.info(
          "User attempts/status reset after successful verification",
          {
            userId,
            requestId,
            oldStatus,
            newStatus: user.status,
            oldAttempts,
            newAttempts: user.passcodeAttemptLeft,
          }
        );
      } catch (saveError) {
        logger.error("Error resetting user attempts/status", {
          userId,
          requestId,
          error: saveError.message,
          stack: saveError.stack,
        });
        throw saveError; // Re-throw to be caught by the outer try-catch
      }
    }

    await session.commitTransaction();
    session.endSession();
    sessionActive = false;

    const processingTime = Date.now() - requestStartTime;
    logger.info("Passcode verification completed successfully", {
      userId,
      requestId,
      processingTime: `${processingTime}ms`,
    });

    next();
  } catch (error) {
    logger.error("Passcode verification critical error", {
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

    return apiResponse.error(res, 500, "Error verifying passcode", {
      errorId: requestId,
    });
  }
};

/**
 * Middleware to authorize users based on roles
 * Requires authentication middleware to be run first
 * @param {string|string[]} roles - Role or array of roles allowed to access the route
 * @returns {Function} - Express middleware function
 */
const hasRole1 = (roles) => {
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
