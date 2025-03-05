const crypto = require("crypto");
const { logger } = require("../config/logger");
const apiResponse = require("../utils/apiResponse");

// In-memory store for challenge tokens (use Redis in production)
const challengeTokens = new Map();

// Configuration
const TOKEN_EXPIRY = 5 * 60 * 1000; // 5 minutes in milliseconds

// Generate and store a challenge token
const generateChallengeToken = async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const { action } = req.body;

    if (!action) {
      return apiResponse.badRequest(res, "Action is required");
    }

    // Generate a random challenge token
    const challengeToken = crypto.randomBytes(32).toString("hex");

    // Store token with expiration
    challengeTokens.set(challengeToken, {
      userId,
      action,
      createdAt: Date.now(),
      expiresAt: Date.now() + TOKEN_EXPIRY,
    });

    logger.info("Challenge token generated", {
      userId,
      action,
      tokenId: challengeToken.substring(0, 8) + "...",
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

// Verify and consume a challenge token
const validateChallengeToken = (token, userId) => {
  const challenge = challengeTokens.get(token);

  // Check if token exists
  if (!challenge) {
    return { valid: false, reason: "invalid_token" };
  }

  // Check if token is expired
  if (challenge.expires < Date.now()) {
    // Clean up expired token
    challengeTokens.delete(token);
    return { valid: false, reason: "expired_token" };
  }

  // Check if token belongs to user
  if (challenge.userId !== userId.toString()) {
    return { valid: false, reason: "unauthorized_token" };
  }

  // Token is valid - consume it so it can't be reused
  challengeTokens.delete(token);

  return { valid: true, action: challenge.action };
};

const verifyPasscodeChallenge = async (req, res, next) => {
  try {
    console.log("mmmmm", req.headers["x-passcode-auth"]);
    // Extract verification data from body
    const { challengeToken, passcodeVerification } = req.body;
    const userId = req.user._id.toString();

    // Log request details for debugging
    logger.info("Verifying passcode challenge", {
      userId,
      hasChallenge: !!challengeToken,
      hasVerification: !!passcodeVerification,
      requestId: req.id,
    });

    // Check if challenge data is present
    if (!challengeToken || !passcodeVerification) {
      logger.warn("Missing challenge verification data", {
        userId,
        requestId: req.id,
      });

      // Check if we have a regular passcode to fall back to (optional)
      if (req.headers["x-passcode-auth"]) {
        logger.info("Falling back to header-based passcode", {
          userId,
          requestId: req.id,
        });

        // Continue with legacy verification
        return next();
      }

      return apiResponse.badRequest(
        res,
        "Challenge token and verification hash are required"
      );
    }

    // Get challenge from store
    const challenge = challengeTokens.get(challengeToken);

    // Validate challenge exists and isn't expired
    if (!challenge) {
      logger.warn("Invalid or unknown challenge token", {
        userId,
        requestId: req.id,
      });
      return apiResponse.badRequest(res, "Invalid or expired challenge token");
    }

    if (challenge.expiresAt < Date.now()) {
      // Clean up expired token
      challengeTokens.delete(challengeToken);
      logger.warn("Expired challenge token", { userId, requestId: req.id });
      return apiResponse.badRequest(res, "Challenge token has expired");
    }

    if (challenge.userId !== userId) {
      logger.warn("Unauthorized challenge token", {
        tokenUserId: challenge.userId,
        requestUserId: userId,
        requestId: req.id,
      });
      return apiResponse.unauthorized(res, "Unauthorized challenge token");
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

    // Compute expected hash value
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

      logger.warn("Invalid passcode verification", {
        userId: user._id,
        attemptsLeft: user.passcodeAttemptLeft,
        requestId: req.id,
      });

      return apiResponse.badRequest(
        res,
        `Invalid passcode. ${user.passcodeAttemptLeft} attempts left.`
      );
    }

    // Consume the token to prevent reuse
    challengeTokens.delete(challengeToken);

    // Reset attempts on successful verification
    user.passcodeAttemptLeft = config.security.passcodeMaxAttempts;
    await user.save();

    logger.info("Passcode verified successfully", {
      userId: user._id,
      action: challenge.action,
      requestId: req.id,
    });

    // Remove challenge verification data from body before passing to handler
    delete req.body.challengeToken;
    delete req.body.passcodeVerification;

    // Add verified action to request for downstream handlers
    req.verifiedAction = challenge.action;

    // Proceed to next middleware/handler
    next();
  } catch (error) {
    logger.error("Error verifying passcode challenge", {
      userId: req.user?._id,
      error: error.message,
      stack: error.stack,
      requestId: req.id,
    });

    return apiResponse.error(res, 500, "Error verifying passcode");
  }
};

module.exports = {
  generateChallengeToken,
  validateChallengeToken,
  verifyPasscodeChallenge,
};
