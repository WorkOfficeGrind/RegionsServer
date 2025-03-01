const mongoose = require("mongoose");
const UserAccount = require("../models/UserAccount");
const Transaction = require("../models/transaction");
const { getMarketRate } = require("./marketRates");

async function transferBetweenAccounts(
  sourceAccountId,
  targetAccountId,
  sourceAmount
) {
  // Start a session for transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Get both accounts with the session
    const sourceAccount = await UserAccount.findById(sourceAccountId).session(
      session
    );
    const targetAccount = await UserAccount.findById(targetAccountId).session(
      session
    );

    if (!sourceAccount || !targetAccount) {
      throw new Error("Invalid account(s) provided.");
    }

    // Validate sufficient balance in source account
    if (sourceAccount.balance < sourceAmount) {
      throw new Error("Insufficient funds in source account.");
    }

    // Get market rates
    const sourceRate = await getMarketRate(sourceAccount.currency);
    const targetRate = await getMarketRate(targetAccount.currency);

    // Convert source amount to target currency using USD as the base:
    //  USD value = sourceAmount * sourceRate
    //  targetAmount = USD value / targetRate
    const targetAmount = sourceAmount * (sourceRate / targetRate);

    // Update the account balances
    sourceAccount.balance -= sourceAmount;
    targetAccount.balance += targetAmount;

    await sourceAccount.save({ session });
    await targetAccount.save({ session });

    // Optionally, log the transfer transaction
    await Transaction.create(
      [
        {
          user: sourceAccount.user, // could also include targetAccount.user if different
          type: "transfer",
          amount: sourceAmount,
          details: {
            from: sourceAccountId,
            to: targetAccountId,
            convertedAmount: targetAmount,
            sourceCurrency: sourceAccount.currency,
            targetCurrency: targetAccount.currency,
          },
        },
      ],
      { session }
    );

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    return {
      success: true,
      sourceAccount,
      targetAccount,
      convertedAmount: targetAmount,
    };
  } catch (error) {
    // Abort the transaction in case of error
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
}

module.exports = { transferBetweenAccounts };
