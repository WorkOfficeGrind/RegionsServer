const Beneficiary = require("../models/Beneficiary");
const mongoose = require("mongoose");
const { logger } = require("../config/logger");

// Create Beneficiary
exports.createBeneficiary = async (req, res) => {

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { name, bank, accountNumber, routingNumber } = req.body;
    const beneficiary = new Beneficiary({
      name,
      bank,
      accountNumber,
      routingNumber,
      user: req.user._id
    });
    await beneficiary.save({ session });
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

// Get all Beneficiaries
exports.getAllBeneficiaries = async (req, res) => {
  try {
    const beneficiaries = await Beneficiary.find();
    res.status(200).json(beneficiaries);
  } catch (error) {
    logger.error(`Error fetching beneficiaries: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
};

// Get single Beneficiary
exports.getBeneficiaryById = async (req, res) => {
  try {
    const beneficiary = await Beneficiary.findById(req.params.id);
    if (!beneficiary) {
      return res.status(404).json({ message: "Beneficiary not found" });
    }
    res.status(200).json(beneficiary);
  } catch (error) {
    logger.error(`Error fetching beneficiary: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
};

// Update Beneficiary
exports.updateBeneficiary = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { name, email, phone, address } = req.body;
    const beneficiary = await Beneficiary.findByIdAndUpdate(
      req.params.id,
      { name, email, phone, address },
      { new: true, session }
    );
    if (!beneficiary) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Beneficiary not found" });
    }
    await session.commitTransaction();
    session.endSession();

    if (process.env.NODE_ENV === "development") {
      logger.info(`Beneficiary updated: ${JSON.stringify(beneficiary)}`);
    }

    res.status(200).json(beneficiary);
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    logger.error(`Error updating beneficiary: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
};

// Delete Beneficiary
exports.deleteBeneficiary = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const beneficiary = await Beneficiary.findByIdAndDelete(req.params.id, {
      session,
    });
    if (!beneficiary) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Beneficiary not found" });
    }
    await session.commitTransaction();
    session.endSession();

    if (process.env.NODE_ENV === "development") {
      logger.info(`Beneficiary deleted: ${JSON.stringify(beneficiary)}`);
    }

    res.status(200).json({ message: "Beneficiary deleted successfully" });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    logger.error(`Error deleting beneficiary: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
};
