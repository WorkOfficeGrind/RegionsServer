// middlewares/pinVerification.js
const bcrypt = require("bcryptjs");
const User = require("../models/user");
const CustomError = require("../utils/customError");
const logger = require("../utils/logger");

/**
 * Middleware to verify PIN
 * Can be used for sensitive operations that require PIN confirmation
 */
const verifyPin = async (req, res, next) => {
  const requestId = req.id;
  const userId = req.user._id;

  try {
    const { pin } = req.body;

    logger.debug("PIN verification attempt", {
      requestId,
      userId,
    });

    if (!pin) {
      logger.warn("PIN verification failed: No PIN provided", {
        requestId,
        userId,
      });

      return res.status(400).json({
        success: false,
        message: "PIN is required",
      });
    }

    // Get user with PIN field and related PIN security fields
    const user = await User.findById(userId).select(
      "+pin +pinRetryCount +pinLockedUntil"
    );

    // Check if PIN is locked
    if (user.isPinLocked && user.isPinLocked()) {
      const lockTimeRemaining = Math.ceil(
        (user.pinLockedUntil - new Date()) / 1000 / 60
      );

      logger.warn("PIN verification failed: PIN is locked", {
        requestId,
        userId,
        lockTimeRemaining,
      });

      return res.status(403).json({
        success: false,
        message: `PIN is locked. Try again in ${lockTimeRemaining} minutes`,
        data: {
          lockedUntil: user.pinLockedUntil,
          timeRemaining: lockTimeRemaining,
        },
      });
    }

    // Verify PIN
    const isPinCorrect = await bcrypt.compare(pin, user.pin);

    // Record attempt (updates retry count and potentially locks PIN)
    if (user.recordPinAttempt) {
      await user.recordPinAttempt(isPinCorrect);
    } else {
      // Fallback if method doesn't exist yet
      if (!isPinCorrect) {
        user.pinRetryCount = (user.pinRetryCount || 0) + 1;
        await user.save();
      } else if (user.pinRetryCount > 0) {
        user.pinRetryCount = 0;
        await user.save();
      }
    }

    if (!isPinCorrect) {
      const attemptsRemaining = 5 - (user.pinRetryCount || 0);

      logger.warn("PIN verification failed: Incorrect PIN", {
        requestId,
        userId,
        attemptsRemaining,
      });

      return res.status(401).json({
        success: false,
        message: `Incorrect PIN. ${attemptsRemaining} attempts remaining before lock`,
        data: {
          attemptsRemaining,
        },
      });
    }

    // Check if PIN change is required
    if (user.forcePinChange) {
      logger.info("PIN verification successful but change required", {
        requestId,
        userId,
      });

      return res.status(403).json({
        success: false,
        message: "PIN change required",
        data: {
          requiresChange: true,
        },
      });
    }

    logger.info("PIN verification successful", {
      requestId,
      userId,
    });

    // PIN is verified, continue
    req.pinVerified = true;
    next();
  } catch (error) {
    logger.error("PIN verification error:", {
      error: error.message,
      stack: error.stack,
      requestId,
      userId,
    });

    next(error);
  }
};

/**
 * Check if PIN needs to be changed
 * Use this middleware to redirect users who need to change their PIN
 */
const checkPinChangeRequired = async (req, res, next) => {
  const requestId = req.id;
  const userId = req.user._id;

  try {
    // Fetch just the PIN change requirement flag
    const user = await User.findById(userId).select("forcePinChange");

    if (user.forcePinChange) {
      logger.info("User needs to change PIN", {
        requestId,
        userId,
      });

      // Don't block API access, just inform the client
      req.pinChangeRequired = true;
    }

    next();
  } catch (error) {
    logger.error("PIN change check error:", {
      error: error.message,
      stack: error.stack,
      requestId,
      userId,
    });

    next(error);
  }
};

/**
 * Middleware to verify PIN and set passcode
 * Bridge between PIN verification and passcode system
 */
const verifyPinAndSetPasscode = async (req, res, next) => {
  const requestId = req.id;
  const userId = req.user._id;

  try {
    const { pin } = req.body;

    logger.debug("PIN verification and passcode setup attempt", {
      requestId,
      userId,
    });

    if (!pin) {
      logger.warn("PIN verification failed: No PIN provided", {
        requestId,
        userId,
      });

      return res.status(400).json({
        success: false,
        message: "PIN is required",
      });
    }

    // Get user with PIN field
    const user = await User.findById(userId).select("+pin");

    // Verify PIN
    const isPinCorrect = await bcrypt.compare(pin, user.pin);

    if (!isPinCorrect) {
      logger.warn("PIN verification failed: Incorrect PIN", {
        requestId,
        userId,
      });

      return res.status(401).json({
        success: false,
        message: "Incorrect PIN",
      });
    }

    // PIN is correct, set it as passcode for authentication
    await user.setPasscode(pin);

    logger.info("PIN verified and passcode set", {
      requestId,
      userId,
    });

    // Continue to next middleware
    next();
  } catch (error) {
    logger.error("PIN verification and passcode setup error:", {
      error: error.message,
      stack: error.stack,
      requestId,
      userId,
    });

    next(error);
  }
};

module.exports = {
  verifyPin,
  checkPinChangeRequired,
  verifyPinAndSetPasscode,
};
