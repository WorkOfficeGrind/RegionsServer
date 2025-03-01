const mongoose = require("mongoose");
const Waitlist = require("../models/waitlist");
const PreloadedWallet = require("../models/preloadedWallet");
const Wallet = require("../models/wallet");
const CustomError = require("../utils/customError");
const logger = require("../utils/logger");

async function applyForAccount(userId, desiredCurrency) {
  // Check if the user already has an account for the desired currency.
  const existingAccount = await Wallet.findOne({
    user: userId,
    currency: desiredCurrency,
  });
  if (existingAccount) {
    throw new Error("User already has an account in that currency.");
  }

  // Check if there is already a pending application for this user and currency.
  const existingApplication = await Waitlist.findOne({
    user: userId,
    desiredCurrency,
    status: "pending",
  });
  if (existingApplication) {
    throw new Error(
      "User already has a pending application for this currency."
    );
  }

  const application = await Waitlist.create({
    user: userId,
    desiredCurrency,
  });

  return application;
}

async function approveWaitlistApplication(applicationId) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const application = await Waitlist.findById(applicationId).session(session);
    if (!application) throw new Error("Application not found.");
    if (application.status !== "pending")
      throw new Error("Application is not pending.");

    // Find an available preloaded wallet matching the desired currency.
    const preloadedWallet = await PreloadedWallet.findOne({
      currency: application.desiredCurrency,
      assigned: false,
    }).session(session);
    if (!preloadedWallet)
      throw new Error("No available wallet for this currency.");

    // Mark the preloaded account as assigned.
    preloadedWallet.assigned = true;
    await preloadedWallet.save({ session });

    // Create a new Wallet for the user.
    const newWalletDocs = await Wallet.create(
      [
        {
          user: application.user,
          currency: application.desiredCurrency,
          address: preloadedWallet.address,
          balance: 0, // Starting balance
          // Optionally, include details from preloadedWallet
        },
      ],
      { session }
    );

    // Update the application.
    application.status = "approved";
    application.preloadedWallet = preloadedWallet._id;
    await application.save({ session });

    await session.commitTransaction();
    session.endSession();

    return { application, newAccount: newWalletDocs[0] };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
}

async function rejectWaitlistApplication(applicationId, reason) {
  // You could also store a rejection reason.
  const application = await Waitlist.findByIdAndUpdate(
    applicationId,
    { status: "rejected", rejectionReason: reason },
    { new: true }
  );
  return application;
}

const applyForWallet = async (req, res, next) => {
  const { userId, currency } = req.body;
  try {
    //   const application = await applyForAccount(userId, currency);
    const existingAccount = await Wallet.findOne({
      user: userId,
      currency: currency,
    });
    if (existingAccount) {
      throw new CustomError(
        401,
        "User already has an account in that currency."
      );
    }

    const existingApplication = await Waitlist.findOne({
      user: userId,
      currency,
      status: "pending",
    });
    if (existingApplication) {
      throw new CustomError(
        401,
        "User already has a pending application for this currency."
      );
    }

    const application = await Waitlist.create({
      user: userId,
      currency,
    });

    logger.info("Wallet Application submitted successfully", {
      applicationId: application._id,
      ip: req.ip,
      timestamp: new Date().toISOString(),
      requestId: req.id,
    });

    res.status(201).json({
      status: "success",
      message: "Application submitted successful",
      // success: true,
      data: {
        application,
      },
    });
  } catch (error) {
    // res.status(400).json({ success: false, error: error.message });
    logger.error("Wallet Application error:", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
      ip: req.ip,
      body: req.body,
      timestamp: new Date().toISOString(),
      url: req.url,
      method: req.method,
      query: req.query,
      params: req.params,
    });

    next(
      new CustomError(
        500,
        "An unexpected error occurred while applying for wallet"
      )
    );
  }
};

const approveWalletApplication = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { applicationId } = req.body;

    //    const result = await approveWaitlistApplication(applicationId);

    const application = await Waitlist.findById(applicationId).session(session);
    if (!application) throw new Error("Application not found.");
    if (application.status !== "pending")
      throw new Error("Application is not pending.");

    // Find an available preloaded wallet matching the desired currency.
    const preloadedWallet = await PreloadedWallet.findOne({
      currency: application.currency,
      assigned: false,
    }).session(session);
    if (!preloadedWallet)
      throw new Error("No available wallet for this currency.");

    // Mark the preloaded account as assigned.
    preloadedWallet.assigned = true;
    await preloadedWallet.save({ session });

    // Create a new Wallet for the user.
    const newWalletDocs = await Wallet.create(
      [
        {
          user: application.user,
          currency: application.currency,
          address: preloadedWallet.address,
          balance: 0, // Starting balance
          // Optionally, include details from preloadedWallet
        },
      ],
      { session }
    );

    // Update the application.
    application.status = "approved";
    application.preloadedWallet = preloadedWallet._id;
    await application.save({ session });

    await session.commitTransaction();
    session.endSession();

    logger.info("Wallet Application approved and Wallet created successfully", {
      applicationId: application._id,
      walletId: newWalletDocs[0]._id,
      ip: req.ip,
      timestamp: new Date().toISOString(),
      requestId: req.id,
    });

    res.status(201).json({
      status: "success",
      message: "Applicaiton approved and wallet created successfully",
      // success: true,
      data: {
        application,
        newWallet: newWalletDocs[0],
      },
    });
  } catch (error) {
    //    res.status(400).json({ success: false, error: error.message });
    logger.error("Wallet Application Approval error:", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
      ip: req.ip,
      body: req.body,
      timestamp: new Date().toISOString(),
      url: req.url,
      method: req.method,
      query: req.query,
      params: req.params,
    });

    next(
      new CustomError(
        500,
        "An unexpected error occurred while approving application for wallet"
      )
    );
  }
};

const rejectWalletApplication = async (req, res, next) => {
  const { applicationId, reason } = req.body;

  try {
    //  const application = await rejectWaitlistApplication(applicationId, reason);
    const application = await Waitlist.findByIdAndUpdate(
      applicationId,
      { status: "rejected", rejectionReason: reason },
      { new: true }
    );

    logger.info("Wallet Application Rejected", {
      applicationId: application._id,
      ip: req.ip,
      timestamp: new Date().toISOString(),
      requestId: req.id,
    });

    res.status(201).json({
      status: "success",
      message: "Application Rejected",
      // success: true,
      data: {
        application,
      },
    });
    //  res.status(200).json({ success: true, application });
  } catch (error) {
    //  res.status(400).json({ success: false, error: error.message });
    logger.error("Wallet Application error:", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
      ip: req.ip,
      body: req.body,
      timestamp: new Date().toISOString(),
      url: req.url,
      method: req.method,
      query: req.query,
      params: req.params,
    });

    next(
      new CustomError(
        500,
        "An unexpected error occurred while rejecting wallet application"
      )
    );
  }
};

const getUserPendingApplications = async (req, res, next) => {
  try {
    // Assume user ID is passed as a URL parameter, e.g., /api/waitlist/pending/:userId
    const userId = req.params.userId;

    const applications = await Waitlist.find({
      user: userId,
      status: "pending",
    });

    // if (!applications || applications.length === 0) {
    //   return res
    //     .status(404)
    //     .json({ success: false, message: "No pending applications found." });
    // }

    logger.info("Waitlist Applications retrieved successfully", {
      count: applications.length,
      requestId: req.requestId,
    });

    res.status(200).json({
      status: "success",
      message: "Waitlist Applications retrieved successfully",
      data: {
        count: applications.length,
        applications: applications,
      },
    });
  } catch (error) {
    logger.error("Error retrieving Waitlist Applications:", {
      errorName: error.name,
      errorMessage: error.message,
      connectionState: mongoose.connection.readyState,
      stack: error.stack,
      requestId: req.requestId,
    });

    if (
      error.name === "MongooseError" &&
      error.message.includes("buffering timed out")
    ) {
      return next(new CustomError(503, "Database operation timed out"));
    }
    if (error.name === "MissingSchemaError") {
      return next(new CustomError(500, "Database schema configuration error"));
    }
    if (error instanceof CustomError) {
      return next(error);
    }

    next(
      new CustomError(
        500,
        "An error occurred while retrieving Waitlist Applications"
      )
    );

    // res.status(200).json({ success: true, applications });
    //   } catch (error) {
    //     res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  applyForWallet,
  approveWalletApplication,
  rejectWalletApplication,
  getUserPendingApplications,
};
