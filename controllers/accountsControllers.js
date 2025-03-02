const Account = require("../models/account");
const logger = require("../utils/logger");
const CustomError = require("../utils/customError");

const getUserAccounts = async (req, res, next) => {
  try {
    // Assume user ID is passed as a URL parameter, e.g., /api/waitlist/pending/:userId
    const userId = req.user._id;

    if (!userId) {
      throw new CustomError(404, "User Not Found.");
    }

    const accounts = await Account.find({
      user: userId,
      status: "active",
    });

    // if (!applications || applications.length === 0) {
    //   return res
    //     .status(404)
    //     .json({ success: false, message: "No pending applications found." });
    // }

    logger.info("Accounts retrieved successfully", {
      count: accounts.length,
      requestId: req.id,
    });

    res.status(200).json({
      status: "success",
      message: "Accounts retrieved successfully",
      data: {
        count: accounts.length,
        accounts,
      },
    });
  } catch (error) {
    logger.error("Error retrieving Accounts:", {
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
  getUserAccounts,
};
