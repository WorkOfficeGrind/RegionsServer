const PreloadedWallet = require("../models/preloadedWallet");
const Wallet = require("../models/wallet");

// Create a new preloaded Wallet
const createPreloadedWallet = async (req, res) => {
  try {
    const { currency, address } = req.body;
    if (!currency || !address) {
      return res.status(400).json({
        success: false,
        error: "Currency and address are required.",
      });
    }
    const newAccount = new PreloadedWallet({ currency, address });
    const savedAccount = await newAccount.save();
    res.status(201).json({ success: true, account: savedAccount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Update an existing preloaded Wallet
const updatePreloadedWallet = async (req, res) => {
  try {
    const accountId = req.params.id;
    const updateData = req.body;
    const updatedAccount = await PreloadedWallet.findByIdAndUpdate(
      accountId,
      updateData,
      { new: true }
    );
    if (!updatedAccount) {
      return res
        .status(404)
        .json({ success: false, error: "Preloaded account not found." });
    }
    res.status(200).json({ success: true, account: updatedAccount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Delete a preloaded Wallet
const deletePreloadedWallet = async (req, res) => {
  try {
    const accountId = req.params.id;
    const deletedAccount = await PreloadedWallet.findByIdAndDelete(accountId);
    if (!deletedAccount) {
      return res
        .status(404)
        .json({ success: false, error: "Preloaded account not found." });
    }
    res.status(200).json({
      success: true,
      message: "Preloaded account deleted successfully.",
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

const getUserWallets = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const wallets = await Wallet.find({ user: userId });

    res.status(200).json({
      status: 'Success',
      success: true,
      data: {
        wallets,
      },
    });
  } catch (error) {
    logger.error("Get User Wallets:", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
      ip: req.ip,
      timestamp: new Date().toISOString(),
    });
    next(error);
  }
};

module.exports = {
  createPreloadedWallet,
  updatePreloadedWallet,
  deletePreloadedWallet,
  getUserWallets,
};
