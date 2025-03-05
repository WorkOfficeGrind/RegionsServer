const mongoose = require("mongoose");
const { logger } = require("../config/logger");

const RefreshTokenSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
      unique: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    issuedAt: {
      type: Date,
      default: Date.now,
    },
    isRevoked: {
      type: Boolean,
      default: false,
    },
    revokedAt: {
      type: Date,
    },
    ipAddress: String,
    userAgent: String,
    device: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Virtual for checking if token is expired
RefreshTokenSchema.virtual("isExpired").get(function () {
  return Date.now() >= this.expiresAt;
});

// Virtual for validating token
RefreshTokenSchema.virtual("isValid").get(function () {
  return !this.isRevoked && !this.isExpired;
});

// Pre-save hook
RefreshTokenSchema.pre("save", function (next) {
  if (this.isNew) {
    logger.info("New refresh token created", {
      userId: this.user,
      tokenId: this._id,
      expiresAt: this.expiresAt,
      ipAddress: this.ipAddress,
    });
  }

  next();
});

// Method to revoke token
RefreshTokenSchema.methods.revoke = async function () {
  try {
    this.isRevoked = true;
    this.revokedAt = new Date();

    await this.save();

    logger.info("Refresh token revoked", {
      tokenId: this._id,
      userId: this.user,
      revokedAt: this.revokedAt,
    });

    return true;
  } catch (error) {
    logger.error("Error revoking refresh token", {
      tokenId: this._id,
      userId: this.user,
      error: error.message,
      stack: error.stack,
    });

    throw error;
  }
};

// Static method to find valid token
RefreshTokenSchema.statics.findValid = async function (token) {
  try {
    const foundToken = await this.findOne({ token });

    if (!foundToken) {
      return null;
    }

    if (foundToken.isRevoked || Date.now() >= foundToken.expiresAt) {
      logger.warn("Invalid refresh token used", {
        tokenId: foundToken._id,
        userId: foundToken.user,
        isRevoked: foundToken.isRevoked,
        isExpired: Date.now() >= foundToken.expiresAt,
      });

      return null;
    }

    return foundToken;
  } catch (error) {
    logger.error("Error finding valid refresh token", {
      token: token ? token.substring(0, 10) + "..." : "undefined",
      error: error.message,
      stack: error.stack,
    });

    throw error;
  }
};

// Static method to revoke all tokens for a user
RefreshTokenSchema.statics.revokeAllForUser = async function (userId) {
  try {
    const result = await this.updateMany(
      { user: userId, isRevoked: false },
      { isRevoked: true, revokedAt: new Date() }
    );

    logger.info("All refresh tokens revoked for user", {
      userId: userId,
      count: result.modifiedCount,
    });

    return result.modifiedCount;
  } catch (error) {
    logger.error("Error revoking all refresh tokens for user", {
      userId: userId,
      error: error.message,
      stack: error.stack,
    });

    throw error;
  }
};

// Create indexes
// RefreshTokenSchema.index({ token: 1 }, { unique: true });
RefreshTokenSchema.index({ user: 1 });
RefreshTokenSchema.index({ expiresAt: 1 });
RefreshTokenSchema.index({ isRevoked: 1 });

const RefreshToken = mongoose.model("RefreshToken", RefreshTokenSchema);

module.exports = RefreshToken;
