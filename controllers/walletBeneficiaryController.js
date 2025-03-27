const Beneficiary = require("../models/Beneficiary");
const mongoose = require("mongoose");
const { logger } = require("../config/logger");
const User = require("../models/User");
const WalletBeneficiary = require("../models/WalletBeneficiary");

// Create Beneficiary
exports.createBeneficiary = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { name, address, currency } = req.body;

    // Create a new beneficiary
    const beneficiary = new WalletBeneficiary({
      name,
      address,
      currency,
      user: req.user._id,
    });

    await beneficiary.save({ session });

    // Update the User model to add the beneficiary's ID
    await User.findByIdAndUpdate(
      req.user._id,
      { $push: { walletBeneficiaries: beneficiary._id } },
      { session }
    );

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    if (process.env.NODE_ENV === "development") {
      logger.info(`Beneficiary created: ${JSON.stringify(beneficiary)}`);
    }

    res.status(201).json(beneficiary);
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    logger.error(`Error creating beneficiary: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
};
