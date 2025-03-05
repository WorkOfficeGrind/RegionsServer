const passport = require("passport");
const { Strategy: JwtStrategy, ExtractJwt } = require("passport-jwt");
const { Strategy: LocalStrategy } = require("passport-local");
const User = require("../models/User");
const { logger } = require("./logger");

// Options for local strategy
const localOptions = {
  usernameField: "identifier", // Can be username or email
  passwordField: "password",
};

// Local strategy for email/password authentication
passport.use(
  new LocalStrategy(localOptions, async (identifier, password, done) => {
    try {
      // Find user by email or username
      const user = await User.findOne({
        $or: [
          { email: identifier.toLowerCase() },
          { username: identifier.toLowerCase() },
        ],
      }).select("+password"); // Include password field which is excluded by default

      // If no user found or password doesn't match
      if (!user || !(await user.matchPassword(password))) {
        logger.warn("Authentication failed: Invalid credentials", {
          identifier: identifier,
          reason: !user ? "User not found" : "Invalid password",
        });

        return done(null, false, {
          message: "Invalid email/username or password",
        });
      }

      // Check if account is active
      if (user.status !== "active") {
        logger.warn("Authentication failed: Inactive account", {
          userId: user._id,
          status: user.status,
        });

        return done(null, false, {
          message: `Your account is ${user.status}. Please contact support.`,
        });
      }

      // Update last login
      user.lastLogin = new Date();
      await user.save({ validateBeforeSave: false });

      // Remove sensitive data before returning
      user.password = undefined;

      logger.info("User authenticated successfully", {
        userId: user._id,
        username: user.username,
      });

      return done(null, user);
    } catch (error) {
      logger.error("Authentication error", {
        error: error.message,
        stack: error.stack,
      });

      return done(error);
    }
  })
);

// Options for JWT strategy
const jwtOptions = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: process.env.JWT_SECRET,
  algorithms: ["HS256"],
};

// JWT strategy for token authentication
passport.use(
  new JwtStrategy(jwtOptions, async (payload, done) => {
    try {
      // Check if token is expired
      const currentTimestamp = Math.floor(Date.now() / 1000);
      if (payload.exp <= currentTimestamp) {
        logger.warn("JWT authentication failed: Token expired", {
          userId: payload.id,
          expiredAt: new Date(payload.exp * 1000).toISOString(),
        });

        return done(null, false, { message: "Token expired" });
      }

      // Find user by ID
      const user = await User.findById(payload.id);

      if (!user) {
        logger.warn("JWT authentication failed: User not found", {
          userId: payload.id,
        });

        return done(null, false, { message: "User not found" });
      }

      // Add populated fields needed for most operations
      // This reduces the need for separate DB calls in controllers
      const populatedUser = await User.findById(user._id)
        .populate("accounts", "name type status bank availableBalance")
        .populate("cards", "type name bank brand last4 status")
        .populate("wallets", "currency balance name status")
        .exec();

      logger.info("JWT authentication successful", {
        userId: user._id,
        username: user.username,
      });

      return done(null, populatedUser);
    } catch (error) {
      logger.error("JWT authentication error", {
        error: error.message,
        stack: error.stack,
      });

      return done(error);
    }
  })
);

module.exports = passport;
