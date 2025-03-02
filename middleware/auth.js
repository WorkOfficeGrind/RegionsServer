// const jwt = require("jsonwebtoken");
// const User = require("../models/user");
// const CustomError = require("../utils/customError");
// const logger = require("../utils/logger");

// // Main authentication middleware
// const auth = async (req, res, next) => {
//   try {
//     // Get token from header
//     const authHeader = req.header("Authorization");
//     if (!authHeader) {
//       throw new CustomError(401, "No authentication token provided");
//     }

//     // return;
//     // Check token format
//     if (!authHeader.startsWith("Bearer ")) {
//       throw new CustomError(401, "Invalid token format");
//     }

//     // Extract token
//     const token = authHeader.replace("Bearer ", "");

//     try {
//       // Verify token
//       const decoded = jwt.verify(token, process.env.JWT_SECRET);

//       console.log("auth middleware", decoded);

//       // Get user from database
//       const user = await User.findById(decoded.id)
//         .select("-password -pin -ssn")
//         .lean();

//       if (!user) {
//         throw new CustomError(401, "User not found");
//       }

//       // if (!user.isActive) {
//       //   throw new CustomError(401, "User account is deactivated");
//       // }

//       // Add user and token to request
//       req.user = user;
//       req.token = token;

//       next();
//     } catch (error) {
//       if (error.name === "JsonWebTokenError") {
//         logger.error("JsonWebTokenError error:", {
//           error: error.message,
//           stack: error.stack,
//           requestId: req.id,
//         });
//         throw new CustomError(401, "Invalid token");
//       }
//       if (error.name === "TokenExpiredError") {
//         logger.error("TokenExpiredError error:", {
//           error: error.message,
//           stack: error.stack,
//           requestId: req.id,
//         });
//         throw new CustomError(401, "Token has expired");
//       }
//       throw error;
//     }
//   } catch (error) {
//     logger.error("Authentication error:", {
//       error: error.message,
//       stack: error.stack,
//       requestId: req.id,
//     });
//     next(error);
//   }
// };

// // Role-based authentication middleware factory
// const hasRole = (...roles) => {
//   return (req, res, next) => {
//     if (!req.user) {
//       return next(new CustomError(401, "Authentication required"));
//     }

//     if (!roles.includes(req.user.role)) {
//       return next(new CustomError(403, "Insufficient permissions"));
//     }

//     next();
//   };
// };

// // Resource ownership verification middleware
// const isResourceOwner = async (req, res, next) => {
//   try {
//     const resourceId =
//       req.params.userId || req.params.accountId || req.params.cardId;

//     if (!resourceId) {
//       throw new CustomError(400, "Resource ID not provided");
//     }

//     if (!req.user) {
//       throw new CustomError(401, "Authentication required");
//     }

//     // Check if user owns the resource or is an admin
//     const isOwner =
//       req.user._id.toString() === resourceId ||
//       req.user.role === "admin" ||
//       (req.user.accounts && req.user.accounts.includes(resourceId)) ||
//       (req.user.cards && req.user.cards.includes(resourceId));

//     if (!isOwner) {
//       throw new CustomError(403, "Access denied");
//     }

//     next();
//   } catch (error) {
//     logger.error("Resource ownership verification error:", {
//       error: error.message,
//       requestId: req.id,
//       userId: req.user?._id,
//       resourceId:
//         req.params.userId || req.params.accountId || req.params.cardId,
//     });
//     next(error);
//   }
// };

// // Session validation middleware
// const validateSession = async (req, res, next) => {
//   try {
//     // Get session token from cookie or header
//     const sessionToken =
//       req.cookies.sessionToken || req.header("X-Session-Token");

//     if (!sessionToken) {
//       throw new CustomError(401, "No session token provided");
//     }

//     // Verify session in database
//     const session = await Session.findOne({
//       token: sessionToken,
//       userId: req.user._id,
//       expiresAt: { $gt: new Date() },
//     });

//     if (!session) {
//       throw new CustomError(401, "Invalid or expired session");
//     }

//     // Update last activity
//     session.lastActivity = new Date();
//     await session.save();

//     next();
//   } catch (error) {
//     logger.error("Session validation error:", {
//       error: error.message,
//       requestId: req.id,
//       userId: req.user?._id,
//     });
//     next(error);
//   }
// };

// // Rate limiting middleware for sensitive operations
// const rateLimit = new Map();

// const rateLimiter = async (req, res, next) => {
//   try {
//     const key = `${req.ip}-${req.path}`;
//     const now = Date.now();
//     const ttl = 60 * 60 * 1000;
//     const maxAttempts = 5;

//     // Get existing rate limit data or create new
//     const rateData = rateLimit.get(key) || {
//       attempts: 0,
//       resetTime: now + ttl,
//     };

//     // Reset if time expired
//     if (now > rateData.resetTime) {
//       rateData.attempts = 0;
//       rateData.resetTime = now + ttl;
//     }

//     // Increment attempts
//     rateData.attempts += 1;

//     // Update store
//     rateLimit.set(key, rateData);

//     // Check if over limit
//     if (rateData.attempts > maxAttempts) {
//       throw new CustomError(429, "Too many attempts. Please try again later.");
//     }

//     // Clean up old entries periodically
//     if (Math.random() < 0.1) {
//       // 10% chance to clean on each request
//       for (const [key, data] of rateLimit.entries()) {
//         if (now > data.resetTime) {
//           rateLimit.delete(key);
//         }
//       }
//     }

//     next();
//   } catch (error) {
//     logger.error("Rate limiting error:", {
//       error: error.message,
//       requestId: req.id,
//       ip: req.ip,
//     });
//     next(error);
//   }
// };

// // Combined ownership and role check middleware
// const hasAccessOrIsAdmin = async (req, res, next) => {
//   try {
//     const resourceId =
//       req.params.userId || req.params.accountId || req.params.cardId;

//     if (!resourceId) {
//       throw new CustomError(400, "Resource ID not provided");
//     }

//     if (!req.user) {
//       throw new CustomError(401, "Authentication required");
//     }

//     // Check if user is admin first
//     if (req.user.role === "admin") {
//       return next();
//     }

//     // If not admin, check resource ownership
//     const isOwner =
//       req.user._id.toString() === resourceId ||
//       (req.user.accounts && req.user.accounts.includes(resourceId)) ||
//       (req.user.cards && req.user.cards.includes(resourceId));

//     if (!isOwner) {
//       throw new CustomError(403, "Access denied");
//     }

//     next();
//   } catch (error) {
//     logger.error("Access verification error:", {
//       error: error.message,
//       requestId: req.id,
//       userId: req.user?._id,
//       resourceId:
//         req.params.userId || req.params.accountId || req.params.cardId,
//     });
//     next(error);
//   }
// };

// const verifyPasscodeAndAuth = async (req, res, next) => {
//   try {
//     // 1. Check for authentication token
//     const authHeader = req.headers.authorization;
//     if (!authHeader || !authHeader.startsWith("Bearer ")) {
//       return res.status(401).json({
//         success: false,
//         message: "Authentication required",
//       });
//     }

//     // Extract token
//     const token = authHeader.split(" ")[1];

//     // 2. Verify JWT token
//     let decodedToken;
//     try {
//       decodedToken = jwt.verify(token, process.env.JWT_SECRET);
//     } catch (error) {
//       return res.status(401).json({
//         success: false,
//         message: "Invalid or expired token",
//       });
//     }

//     // Get user ID from token
//     const userId = decodedToken.userId || decodedToken.id; // Added fallback for consistency

//     // 3. Check for passcode header
//     const passcodeHeader = req.headers["x-passcode-auth"];
//     if (!passcodeHeader) {
//       return res.status(401).json({
//         success: false,
//         message: "Passcode required for this operation",
//       });
//     }

//     // 4. Decode passcode header
//     let passcodeData;
//     try {
//       const decodedHeader = Buffer.from(passcodeHeader, "base64").toString(
//         "utf-8"
//       );
//       passcodeData = JSON.parse(decodedHeader);
//     } catch (error) {
//       return res.status(401).json({
//         success: false,
//         message: "Invalid passcode format",
//       });
//     }

//     const { hash: receivedHash, timestamp } = passcodeData;

//     // 5. Validate timestamp to prevent replay attacks (5 minute window)
//     const now = Date.now();
//     if (now - parseInt(timestamp, 10) > 5 * 60 * 1000) {
//       return res.status(401).json({
//         success: false,
//         message: "Passcode expired",
//       });
//     }

//     // 6. Get user and stored passcode hash
//     const user = await User.findById(userId);
//     if (!user) {
//       return res.status(401).json({
//         success: false,
//         message: "User not found",
//       });
//     }

//     if (!user.passcodeHash) {
//       return res.status(401).json({
//         success: false,
//         message: "No passcode set for this user",
//       });
//     }

//     // 7. Verify passcode hash
//     // First recreate the hash with the stored passcode and timestamp
//     const expectedHash = crypto
//       .createHash("sha256")
//       .update(`${user.passcodeHash}:${timestamp}`)
//       .digest("hex");

//     // Use constant-time comparison to avoid timing attacks
//     const receivedBuffer = Buffer.from(receivedHash, "hex");
//     const expectedBuffer = Buffer.from(expectedHash, "hex");

//     if (receivedBuffer.length !== expectedBuffer.length) {
//       return res.status(401).json({
//         success: false,
//         message: "Invalid passcode",
//       });
//     }

//     const isValid = crypto.timingSafeEqual(receivedBuffer, expectedBuffer);

//     if (!isValid) {
//       return res.status(401).json({
//         success: false,
//         message: "Invalid passcode",
//       });
//     }

//     // 8. All validations passed
//     // Attach user to request for route handlers to use
//     req.user = user;

//     // Continue to the route handler
//     next();
//   } catch (error) {
//     console.error("Authentication error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Authentication failed",
//     });
//   }
// };

// module.exports = {
//   auth,
//   hasRole,
//   isResourceOwner,
//   validateSession,
//   rateLimiter,
//   hasAccessOrIsAdmin,
//   verifyPasscodeAndAuth,
// };

const jwt = require("jsonwebtoken");
const User = require("../models/user");
const CustomError = require("../utils/customError");
const logger = require("../utils/logger");
const crypto = require("crypto"); // Added missing import

// Main authentication middleware
const auth = async (req, res, next) => {
  const requestId = req.id;
  const requestPath = req.path;
  const requestMethod = req.method;

  logger.info("Authentication attempt", {
    requestId,
    path: requestPath,
    method: requestMethod,
  });

  try {
    // Get token from header
    const authHeader = req.header("Authorization");
    if (!authHeader) {
      logger.warn("Authentication failed: No token provided", { requestId });
      throw new CustomError(401, "No authentication token provided");
    }

    // Check token format
    if (!authHeader.startsWith("Bearer ")) {
      logger.warn("Authentication failed: Invalid token format", { requestId });
      throw new CustomError(401, "Invalid token format");
    }

    // Extract token
    const token = authHeader.replace("Bearer ", "");

    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      logger.debug("Token verification successful", {
        requestId,
        userId: decoded.id,
      });

      // Get user from database
      const user = await User.findById(decoded.id)
        .select("-password -pin -ssn")
        .lean();

      if (!user) {
        logger.warn("Authentication failed: User not found", {
          requestId,
          userId: decoded.id,
        });
        throw new CustomError(401, "User not found");
      }

      // Add user and token to request
      req.user = user;
      req.token = token;

      logger.info("Authentication successful", {
        requestId,
        userId: user._id,
        userRole: user.role,
      });

      next();
    } catch (error) {
      if (error.name === "JsonWebTokenError") {
        logger.error("Authentication failed: JWT error", {
          error: error.message,
          stack: error.stack,
          requestId,
          tokenPrefix: token.substring(0, 10) + "...", // Log partial token for debugging
        });
        throw new CustomError(401, "Invalid token");
      }
      if (error.name === "TokenExpiredError") {
        logger.error("Authentication failed: Token expired", {
          error: error.message,
          stack: error.stack,
          requestId,
          expiredAt: error.expiredAt,
        });
        throw new CustomError(401, "Token has expired");
      }
      throw error;
    }
  } catch (error) {
    logger.error("Authentication error:", {
      error: error.message,
      stack: error.stack,
      requestId,
      path: requestPath,
      method: requestMethod,
    });
    next(error);
  }
};

// Role-based authentication middleware factory
const hasRole = (...roles) => {
  return (req, res, next) => {
    const requestId = req.id;

    if (!req.user) {
      logger.warn("Role check failed: No authenticated user", { requestId });
      return next(new CustomError(401, "Authentication required"));
    }

    logger.debug("Role check", {
      requestId,
      userId: req.user._id,
      userRole: req.user.role,
      requiredRoles: roles,
    });

    if (!roles.includes(req.user.role)) {
      logger.warn("Role check failed: Insufficient permissions", {
        requestId,
        userId: req.user._id,
        userRole: req.user.role,
        requiredRoles: roles,
      });
      return next(new CustomError(403, "Insufficient permissions"));
    }

    logger.info("Role check passed", {
      requestId,
      userId: req.user._id,
      userRole: req.user.role,
    });

    next();
  };
};

// Resource ownership verification middleware
const isResourceOwner = async (req, res, next) => {
  const requestId = req.id;

  try {
    const resourceId =
      req.params.userId || req.params.accountId || req.params.cardId;
    const resourceType = req.params.userId
      ? "user"
      : req.params.accountId
      ? "account"
      : "card";

    logger.debug("Resource ownership check", {
      requestId,
      resourceType,
      resourceId,
    });

    if (!resourceId) {
      logger.warn("Resource ownership check failed: No resource ID", {
        requestId,
      });
      throw new CustomError(400, "Resource ID not provided");
    }

    if (!req.user) {
      logger.warn("Resource ownership check failed: No authenticated user", {
        requestId,
      });
      throw new CustomError(401, "Authentication required");
    }

    // Check if user owns the resource or is an admin
    const isOwner =
      req.user._id.toString() === resourceId ||
      req.user.role === "admin" ||
      (req.user.accounts && req.user.accounts.includes(resourceId)) ||
      (req.user.cards && req.user.cards.includes(resourceId));

    logger.debug("Resource ownership details", {
      requestId,
      userId: req.user._id,
      userRole: req.user.role,
      resourceId,
      resourceType,
      directMatch: req.user._id.toString() === resourceId,
      isAdmin: req.user.role === "admin",
      hasAccountAccess:
        req.user.accounts && req.user.accounts.includes(resourceId),
      hasCardAccess: req.user.cards && req.user.cards.includes(resourceId),
      result: isOwner,
    });

    if (!isOwner) {
      logger.warn("Resource ownership check failed: Access denied", {
        requestId,
        userId: req.user._id,
        resourceType,
        resourceId,
      });
      throw new CustomError(403, "Access denied");
    }

    logger.info("Resource ownership check passed", {
      requestId,
      userId: req.user._id,
      resourceType,
      resourceId,
    });

    next();
  } catch (error) {
    logger.error("Resource ownership verification error:", {
      error: error.message,
      stack: error.stack,
      requestId,
      userId: req.user?._id,
      resourceId:
        req.params.userId || req.params.accountId || req.params.cardId,
    });
    next(error);
  }
};

// Session validation middleware
const validateSession = async (req, res, next) => {
  const requestId = req.id;

  try {
    // Get session token from cookie or header
    const sessionToken =
      req.cookies.sessionToken || req.header("X-Session-Token");

    const tokenSource = req.cookies.sessionToken
      ? "cookie"
      : req.header("X-Session-Token")
      ? "header"
      : "none";

    logger.debug("Session validation attempt", {
      requestId,
      userId: req.user?._id,
      tokenSource,
    });

    if (!sessionToken) {
      logger.warn("Session validation failed: No session token", {
        requestId,
        userId: req.user?._id,
      });
      throw new CustomError(401, "No session token provided");
    }

    // Verify session in database
    const session = await Session.findOne({
      token: sessionToken,
      userId: req.user._id,
      expiresAt: { $gt: new Date() },
    });

    if (!session) {
      logger.warn("Session validation failed: Invalid or expired session", {
        requestId,
        userId: req.user?._id,
        tokenPrefix: sessionToken.substring(0, 10) + "...",
      });
      throw new CustomError(401, "Invalid or expired session");
    }

    // Update last activity
    const previousActivity = session.lastActivity;
    session.lastActivity = new Date();
    await session.save();

    logger.info("Session validation successful", {
      requestId,
      userId: req.user._id,
      sessionId: session._id,
      lastActivity: previousActivity,
      sessionAge: new Date() - new Date(session.createdAt),
      expiresIn: new Date(session.expiresAt) - new Date(),
    });

    next();
  } catch (error) {
    logger.error("Session validation error:", {
      error: error.message,
      stack: error.stack,
      requestId,
      userId: req.user?._id,
    });
    next(error);
  }
};

// Rate limiting middleware for sensitive operations
const rateLimit = new Map();

const rateLimiter = async (req, res, next) => {
  const requestId = req.id;
  const ip = req.ip;
  const path = req.path;

  try {
    const key = `${ip}-${path}`;
    const now = Date.now();
    const ttl = 60 * 60 * 1000;
    const maxAttempts = 5;

    logger.debug("Rate limit check", {
      requestId,
      ip,
      path,
      key,
    });

    // Get existing rate limit data or create new
    const rateData = rateLimit.get(key) || {
      attempts: 0,
      resetTime: now + ttl,
    };

    // Reset if time expired
    if (now > rateData.resetTime) {
      logger.debug("Rate limit reset for key", {
        requestId,
        key,
        previousAttempts: rateData.attempts,
      });

      rateData.attempts = 0;
      rateData.resetTime = now + ttl;
    }

    // Increment attempts
    rateData.attempts += 1;

    // Update store
    rateLimit.set(key, rateData);

    logger.debug("Rate limit updated", {
      requestId,
      key,
      attempts: rateData.attempts,
      maxAttempts,
      resetTime: new Date(rateData.resetTime),
      ttlRemaining: Math.round((rateData.resetTime - now) / 1000),
    });

    // Check if over limit
    if (rateData.attempts > maxAttempts) {
      logger.warn("Rate limit exceeded", {
        requestId,
        ip,
        path,
        attempts: rateData.attempts,
        resetTime: new Date(rateData.resetTime),
      });
      throw new CustomError(429, "Too many attempts. Please try again later.");
    }

    // Clean up old entries periodically
    if (Math.random() < 0.1) {
      // 10% chance to clean on each request
      let cleanedCount = 0;
      const beforeSize = rateLimit.size;

      for (const [mapKey, data] of rateLimit.entries()) {
        if (now > data.resetTime) {
          rateLimit.delete(mapKey);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        logger.debug("Rate limit cache cleaned", {
          requestId,
          entriesBefore: beforeSize,
          entriesAfter: rateLimit.size,
          entriesRemoved: cleanedCount,
        });
      }
    }

    next();
  } catch (error) {
    logger.error("Rate limiting error:", {
      error: error.message,
      stack: error.stack,
      requestId,
      ip,
      path,
    });
    next(error);
  }
};

// Combined ownership and role check middleware
const hasAccessOrIsAdmin = async (req, res, next) => {
  const requestId = req.id;

  try {
    const resourceId =
      req.params.userId || req.params.accountId || req.params.cardId;
    const resourceType = req.params.userId
      ? "user"
      : req.params.accountId
      ? "account"
      : "card";

    logger.debug("Access verification check", {
      requestId,
      resourceType,
      resourceId,
    });

    if (!resourceId) {
      logger.warn("Access verification failed: No resource ID", { requestId });
      throw new CustomError(400, "Resource ID not provided");
    }

    if (!req.user) {
      logger.warn("Access verification failed: No authenticated user", {
        requestId,
      });
      throw new CustomError(401, "Authentication required");
    }

    // Check if user is admin first
    if (req.user.role === "admin") {
      logger.info("Access granted via admin role", {
        requestId,
        userId: req.user._id,
        resourceType,
        resourceId,
      });
      return next();
    }

    // If not admin, check resource ownership
    const isOwner =
      req.user._id.toString() === resourceId ||
      (req.user.accounts && req.user.accounts.includes(resourceId)) ||
      (req.user.cards && req.user.cards.includes(resourceId));

    logger.debug("Resource ownership details for access check", {
      requestId,
      userId: req.user._id,
      resourceId,
      resourceType,
      directMatch: req.user._id.toString() === resourceId,
      hasAccountAccess:
        req.user.accounts && req.user.accounts.includes(resourceId),
      hasCardAccess: req.user.cards && req.user.cards.includes(resourceId),
      result: isOwner,
    });

    if (!isOwner) {
      logger.warn("Access verification failed: Not owner or admin", {
        requestId,
        userId: req.user._id,
        userRole: req.user.role,
        resourceType,
        resourceId,
      });
      throw new CustomError(403, "Access denied");
    }

    logger.info("Access granted via resource ownership", {
      requestId,
      userId: req.user._id,
      resourceType,
      resourceId,
    });

    next();
  } catch (error) {
    logger.error("Access verification error:", {
      error: error.message,
      stack: error.stack,
      requestId,
      userId: req.user?._id,
      resourceId:
        req.params.userId || req.params.accountId || req.params.cardId,
    });
    next(error);
  }
};

const verifyPasscodeAndAuth = async (req, res, next) => {
  const requestId = req.id;

  try {
    logger.debug("Passcode verification attempt", { requestId });

    // 1. Check for authentication token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      logger.warn("Passcode verification failed: No auth token", { requestId });
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Extract token
    const token = authHeader.split(" ")[1];

    // 2. Verify JWT token
    let decodedToken;
    try {
      decodedToken = jwt.verify(token, process.env.JWT_SECRET);
      logger.debug("JWT verification successful for passcode check", {
        requestId,
        userId: decodedToken.userId || decodedToken.id,
      });
    } catch (error) {
      logger.error("Passcode verification failed: JWT verification error", {
        error: error.message,
        stack: error.stack,
        requestId,
        tokenPrefix: token.substring(0, 10) + "...",
      });
      return res.status(401).json({
        success: false,
        message: "Invalid or expired token",
      });
    }

    // Get user ID from token
    const userId = decodedToken.userId || decodedToken.id; // Added fallback for consistency

    // 3. Check for passcode header
    const passcodeHeader = req.headers["x-passcode-auth"];
    if (!passcodeHeader) {
      logger.warn("Passcode verification failed: No passcode header", {
        requestId,
        userId,
      });
      return res.status(401).json({
        success: false,
        message: "Passcode required for this operation",
      });
    }

    // 4. Decode passcode header
    let passcodeData;
    try {
      const decodedHeader = Buffer.from(passcodeHeader, "base64").toString(
        "utf-8"
      );
      passcodeData = JSON.parse(decodedHeader);
      logger.debug("Passcode header decoded successfully", {
        requestId,
        userId,
      });
    } catch (error) {
      logger.error("Passcode verification failed: Invalid passcode format", {
        error: error.message,
        stack: error.stack,
        requestId,
        userId,
      });
      return res.status(401).json({
        success: false,
        message: "Invalid passcode format",
      });
    }

    const { hash: receivedHash, timestamp } = passcodeData;

    // 5. Validate timestamp to prevent replay attacks (5 minute window)
    const now = Date.now();
    const timestampAge = now - parseInt(timestamp, 10);

    logger.debug("Timestamp validation for passcode", {
      requestId,
      userId,
      timestampAge: Math.round(timestampAge / 1000) + "s",
      isValid: timestampAge <= 5 * 60 * 1000,
    });

    if (timestampAge > 5 * 60 * 1000) {
      logger.warn("Passcode verification failed: Expired timestamp", {
        requestId,
        userId,
        timestamp: new Date(parseInt(timestamp, 10)),
        age: Math.round(timestampAge / 1000) + "s",
      });
      return res.status(401).json({
        success: false,
        message: "Passcode expired",
      });
    }

    // 6. Get user and stored passcode hash
    const user = await User.findById(userId);
    if (!user) {
      logger.warn("Passcode verification failed: User not found", {
        requestId,
        userId,
      });
      return res.status(401).json({
        success: false,
        message: "User not found",
      });
    }

    if (!user.passcodeHash) {
      logger.warn("Passcode verification failed: No passcode set", {
        requestId,
        userId: user._id,
      });
      return res.status(401).json({
        success: false,
        message: "No passcode set for this user",
      });
    }

    // 7. Verify passcode hash
    // First recreate the hash with the stored passcode and timestamp
    const expectedHash = crypto
      .createHash("sha256")
      .update(`${user.passcodeHash}:${timestamp}`)
      .digest("hex");

    // Use constant-time comparison to avoid timing attacks
    const receivedBuffer = Buffer.from(receivedHash, "hex");
    const expectedBuffer = Buffer.from(expectedHash, "hex");

    if (receivedBuffer.length !== expectedBuffer.length) {
      logger.warn("Passcode verification failed: Hash length mismatch", {
        requestId,
        userId: user._id,
        receivedLength: receivedBuffer.length,
        expectedLength: expectedBuffer.length,
      });
      return res.status(401).json({
        success: false,
        message: "Invalid passcode",
      });
    }

    const isValid = crypto.timingSafeEqual(receivedBuffer, expectedBuffer);

    if (!isValid) {
      logger.warn("Passcode verification failed: Invalid hash", {
        requestId,
        userId: user._id,
      });
      return res.status(401).json({
        success: false,
        message: "Invalid passcode",
      });
    }

    // 8. All validations passed
    logger.info("Passcode verification successful", {
      requestId,
      userId: user._id,
    });

    // Attach user to request for route handlers to use
    req.user = user;

    // Continue to the route handler
    next();
  } catch (error) {
    logger.error("Passcode verification error:", {
      error: error.message,
      stack: error.stack,
      requestId,
      path: req.path,
      method: req.method,
    });
    return res.status(500).json({
      success: false,
      message: "Authentication failed",
    });
  }
};

// const verifyPasscode = async (req, res, next) => {
//   try {
//     // Get passcode from custom header
//     const passcodeSecurity = req.headers["x-passcode-auth"];
//     const userId = req.user._id;

//     // Add detailed logging for debugging
//     logger.debug("Passcode verification attempt", {
//       userId,
//       hasPasscodeHeader: !!passcodeSecurity,
//       requestId: req.id,
//       headers: Object.keys(req.headers),
//     });

//     if (!passcodeSecurity) {
//       throw new CustomError(
//         400,
//         "Passcode header is required for this operation"
//       );
//     }

//     // Get user and specifically select passcodeHash field
//     const user = await User.findById(userId).select("+passcodeHash");

//     if (!user) {
//       throw new CustomError(404, "User not found");
//     }

//     // Log detailed info about user's passcode status (only in development)
//     if (process.env.NODE_ENV === "development") {
//       logger.debug("Passcode verification details", {
//         userId,
//         hasPasscodeHash: !!user.passcodeHash,
//         requestId: req.id,
//       });
//     }

//     if (!user.passcodeHash) {
//       throw new CustomError(
//         400,
//         "Passcode not set up. Please set up a passcode first."
//       );
//     }

//     // Compare passcode hashes
//     if (passcodeSecurity !== user.passcodeHash) {
//       // Log hash comparison in development (without exposing full hash)
//       if (process.env.NODE_ENV === "development") {
//         logger.debug("Passcode hash mismatch", {
//           userId,
//           headerHashPrefix: passcodeSecurity.substring(0, 8) + "...",
//           storedHashPrefix: user.passcodeHash.substring(0, 8) + "...",
//           requestId: req.id,
//         });
//       }
//       throw new CustomError(401, "Invalid passcode");
//     }

//     // Passcode verified, proceed
//     logger.debug("Passcode verification successful", {
//       userId,
//       requestId: req.id,
//     });
//     next();
//   } catch (error) {
//     logger.error("Passcode verification error:", {
//       error: error.message,
//       userId: req.user?._id,
//       requestId: req.id,
//       timestamp: new Date().toISOString(),
//     });
//     next(error);
//   }
// };

const verifyPasscode = async (req, res, next) => {
  try {
    // Get passcode from custom header
    const passcodeSecurity = req.headers["x-passcode-auth"];
    const userId = req.user._id;

    logger.debug("Passcode verification attempt", {
      userId,
      hasPasscodeHeader: !!passcodeSecurity,
      requestId: req.id,
      headers: Object.keys(req.headers),
    });

    if (!passcodeSecurity) {
      throw new CustomError(
        400,
        "Passcode header is required for this operation"
      );
    }

    // Get user and explicitly select the passcodeHash, passcodeAttemptLeft, and status fields
    const user = await User.findById(userId).select(
      "+passcodeHash passcodeAttemptLeft status"
    );

    if (!user) {
      throw new CustomError(404, "User not found");
    }

    // Check if user is allowed to attempt passcode verification
    if (user.passcodeAttemptLeft <= 0 || user.status === "passcode_locked") {
      throw new CustomError(
        403,
        "Passcode attempts exhausted. Account is locked."
      );
    }

    // Log detailed info about user's passcode status (only in development)
    if (process.env.NODE_ENV === "development") {
      logger.debug("Passcode verification details", {
        userId,
        hasPasscodeHash: !!user.passcodeHash,
        passcodeAttemptLeft: user.passcodeAttemptLeft,
        status: user.status,
        requestId: req.id,
      });
    }

    // Compare passcode hashes
    if (passcodeSecurity !== user.passcodeHash) {
      // Deduct one attempt
      user.passcodeAttemptLeft -= 1;

      // If attempts are exhausted, lock the account
      if (user.passcodeAttemptLeft <= 0) {
        user.status = "passcode_locked";
      }

      await user.save();

      if (process.env.NODE_ENV === "development") {
        logger.debug("Passcode hash mismatch", {
          userId,
          headerHashPrefix: passcodeSecurity.substring(0, 8) + "...",
          storedHashPrefix: user.passcodeHash,
          remainingAttempts: user.passcodeAttemptLeft,
          requestId: req.id,
        });
      }
      throw new CustomError(401, "Invalid passcode");
    }

    // If passcode is confirmed, reset attempts to 5 if needed and ensure account status is active
    if (user.passcodeAttemptLeft < 5 || user.status !== "active") {
      user.passcodeAttemptLeft = 5;
      user.status = "active";
      await user.save();
    }

    logger.debug("Passcode verification successful", {
      userId,
      requestId: req.id,
    });
    next();
  } catch (error) {
    logger.error("Passcode verification error:", {
      error: error.message,
      userId: req.user?._id,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });
    next(error);
  }
};

module.exports = verifyPasscode;

/**
 * Get passcode status (Development only)
 * @route GET /api/auth/dev/passcode-status
 * @access Private (admin only, dev environment only)
 */
const getPasscodeStatus = async (req, res, next) => {
  try {
    // Only allow in development environment
    if (process.env.NODE_ENV !== "development") {
      throw new CustomError(
        403,
        "This endpoint is only available in development mode"
      );
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
      passcodeHashPrefix: user.passcodeHash
        ? `${user.passcodeHash.substring(0, 8)}...${user.passcodeHash.substring(
            user.passcodeHash.length - 8
          )}`
        : null,
    };

    res.status(200).json({
      status: "success",
      message: "Passcode status retrieved",
      data: passcodeInfo,
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
      throw new CustomError(
        403,
        "This endpoint is only available in development mode"
      );
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
        isMatch: user.passcodeHash === passcodeHash,
      };
    }

    // Return the hash and match info if applicable
    res.status(200).json({
      status: "success",
      data: {
        passcodeHash,
        passcodeForHeader: passcodeHash, // Add this line to make it clear this is what should go in the header
        matchResult,
      },
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
  auth,
  hasRole,
  isResourceOwner,
  validateSession,
  rateLimiter,
  hasAccessOrIsAdmin,
  verifyPasscode,
  verifyPasscodeAndAuth,
  getPasscodeStatus,
  hashPasscodeForDev,
};
