const mongoose = require("mongoose");
const Wallet = require("../models/Wallet");
const User = require("../models/User");
const { logger } = require("../config/logger");
const crypto = require("crypto");
const Waitlist = require("../models/Waitlist");

const waitlistService = {
  /**
   * Get all pending wallet applications for a user
   * @param {string} userId - User ID
   * @returns {Promise<Array>} - User's wallets
   */
  // In waitlistService.js
  async getUserWalletApplications(userId, session = null) {
    // Use the session parameter in your database queries
    const options = session ? { session } : {};

    const wallets = await Waitlist.find({ user: userId }, null, options).sort({
      createdAt: -1,
    });

    return wallets;
  },
};

module.exports = waitlistService;
