const mongoose = require("mongoose");
const UserAccount = require("../models/wallet");
const UserInvestment = require("../models/userInvestment");
const InvestmentPlan = require("../models/investmentPlan");
const Transaction = require("../models/transaction");

// Function to create a new investment in a plan
async function investInPlan(userId, accountId, planId, amount) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Fetch the user's account within the transaction
    const account = await UserAccount.findById(accountId).session(session);
    if (!account) throw new Error("Account not found.");
    if (account.user.toString() !== userId.toString())
      throw new Error("Account does not belong to user.");
    if (account.balance < amount)
      throw new Error("Insufficient funds in account.");

    // Deduct the investment amount from the account
    account.balance -= amount;
    await account.save({ session });

    // Create the investment record (the pre-save hook will compute maturityDate & currentValue)
    const investments = await UserInvestment.create(
      [
        {
          user: userId,
          plan: planId,
          account: accountId,
          investedAmount: amount,
        },
      ],
      { session }
    );

    // Log the investment transaction
    await Transaction.create(
      [
        {
          user: userId,
          type: "investment",
          amount: amount,
          details: {
            account: accountId,
            plan: planId,
            investmentId: investments[0]._id,
          },
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();
    return investments[0];
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
}

// Function to increase an existing investment's amount
async function increaseInvestment(userId, investmentId, additionalAmount) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const investment = await UserInvestment.findById(investmentId).session(
      session
    );
    if (!investment) throw new Error("Investment not found.");
    if (investment.user.toString() !== userId.toString())
      throw new Error("Investment does not belong to user.");
    if (investment.status !== "active")
      throw new Error("Only active investments can be increased.");

    // Fetch the associated account to check balance
    const account = await UserAccount.findById(investment.account).session(
      session
    );
    if (!account) throw new Error("Associated account not found.");
    if (account.balance < additionalAmount)
      throw new Error("Insufficient funds in account.");

    // Deduct funds from the account and update the investment
    account.balance -= additionalAmount;
    await account.save({ session });

    investment.investedAmount += additionalAmount;
    // The pre-save hook will recalc currentValue when saving
    await investment.save({ session });

    await Transaction.create(
      [
        {
          user: userId,
          type: "investment_increase",
          amount: additionalAmount,
          details: { investmentId: investmentId, account: account._id },
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();
    return investment;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
}

// Function to withdraw funds from a matured investment
async function withdrawInvestment(userId, investmentId) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const investment = await UserInvestment.findById(investmentId).session(
      session
    );
    if (!investment) throw new Error("Investment not found.");
    if (investment.user.toString() !== userId.toString())
      throw new Error("Investment does not belong to user.");
    if (investment.status !== "active")
      throw new Error("Investment already withdrawn or not active.");
    if (new Date() < investment.maturityDate)
      throw new Error("Investment has not yet matured.");

    // Mark the investment as matured/withdrawn
    investment.status = "withdrawn";
    await investment.save({ session });

    // Credit the matured funds (i.e. currentValue) back into the associated account
    const account = await UserAccount.findById(investment.account).session(
      session
    );
    if (!account) throw new Error("Associated account not found.");
    account.balance += investment.currentValue;
    await account.save({ session });

    await Transaction.create(
      [
        {
          user: userId,
          type: "withdrawal",
          amount: investment.currentValue,
          details: { investmentId: investmentId, account: account._id },
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();
    return { investment, account };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
}

module.exports = {
  investInPlan,
  increaseInvestment,
  withdrawInvestment,
};
