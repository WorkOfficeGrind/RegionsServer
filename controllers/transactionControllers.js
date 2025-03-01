const Account = require("../models/account");
const Transaction = require("../models/transaction");
const User = require("../models/user");
const mongoose = require("mongoose");

// Transfer funds between accounts
const transferFunds = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { fromAccountId, toAccountNumber, amount, narration, currency } =
      req.body;
    const userId = req.user._id; // from auth middleware

    // Validate inputs
    if (!fromAccountId || !toAccountNumber || !amount || amount <= 0) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Get source account
    const sourceAccount = await Account.findOne({
      _id: fromAccountId,
      user: userId,
    }).session(session);

    if (!sourceAccount) {
      throw new Error("Source account not found or not authorized");
    }

    // Check sufficient balance
    if (sourceAccount.availableBalance < amount) {
      throw new Error("Insufficient funds");
    }

    // Find destination account
    const destinationAccount = await Account.findOne({
      accountNumber: toAccountNumber,
    }).session(session);

    if (!destinationAccount) {
      throw new Error("Destination account not found");
    }

    // Create transaction record
    const transaction = new Transaction({
      type: "Transfer",
      fromAccount: sourceAccount._id,
      toAccount: destinationAccount._id,
      fromUser: userId,
      toUser: destinationAccount.user,
      amount,
      currency: currency || "USD",
      status: "Completed",
      narration: narration || "Funds transfer",
      processingDate: new Date(),
    });

    await transaction.save({ session });

    // Update source account balance
    sourceAccount.availableBalance -= amount;
    sourceAccount.ledgerBalance -= amount;
    sourceAccount.transactions.push(transaction._id);
    await sourceAccount.save({ session });

    // Update destination account balance
    destinationAccount.availableBalance += amount;
    destinationAccount.ledgerBalance += amount;
    destinationAccount.transactions.push(transaction._id);
    await destinationAccount.save({ session });

    // Commit transaction
    await session.commitTransaction();

    // Return success with transaction details
    return res.status(200).json({
      message: "Transfer successful",
      status: "success",
      transactionId: transaction.transactionId,
      reference: transaction.reference,
      amount,
      date: transaction.createdAt,
      narration: transaction.narration,
    });
  } catch (error) {
    // Abort transaction on error
    await session.abortTransaction();

    console.error("Transfer error:", error);
    return res.status(400).json({
      message: error.message || "Transfer failed",
      status: "failed",
    });
  } finally {
    session.endSession();
  }
};

// Get transaction history for a user
const getTransactionHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    const { accountId, page = 1, limit = 20, type } = req.query;

    const skip = (page - 1) * limit;

    // Build query
    const query = {
      $or: [{ fromUser: userId }, { toUser: userId }],
    };

    // Filter by account if provided
    if (accountId) {
      query.$or = [{ fromAccount: accountId }, { toAccount: accountId }];
    }

    // Filter by transaction type if provided
    if (type) {
      query.type = type;
    }

    // Get transactions with pagination
    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate("fromAccount", "accountNumber name")
      .populate("toAccount", "accountNumber name");

    // Get total count for pagination
    const total = await Transaction.countDocuments(query);

    return res.status(200).json({
      transactions,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Get transaction history error:", error);
    return res.status(400).json({
      message: error.message || "Failed to get transaction history",
    });
  }
};


module.exports = {
    transferFunds,
    getTransactionHistory
}