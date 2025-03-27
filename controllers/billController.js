const Bill = require("../models/Bill");
const User = require("../models/User");
const Account = require("../models/Account");
const Card = require("../models/Card");
const Transaction = require("../models/Transaction");
const { logger } = require("../config/logger");
const apiResponse = require("../utils/apiResponse");
const mongoose = require("mongoose");

/**
 * @desc    Create a new bill
 * @route   POST /api/bills
 * @access  Private
 */
exports.createBill = async (req, res, next) => {
  // console.log("hhhhh", req.body);
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    logger.info("Create bill request initiated", {
      userId: req.user._id,
      requestId: req.id,
      requestBody: req.body,
      timestamp: new Date().toISOString(),
    });

    const {
      title,
      customName,
      amount,
      dueDate,
      accountNumber,
      provider,
      paymentMethod,
      paymentMethodType,
      isEbillEnrolled,
      isRecurring,
      recurringDetails,
      category,
      icon,
      notes,
    } = req.body;

    // Validate required fields
    if (!title || !amount || !dueDate || !provider || !accountNumber) {
      logger.warn("Validation failed: Missing required fields", {
        userId: req.user._id,
        requestId: req.id,
        timestamp: new Date().toISOString(),
      });
      return apiResponse.badRequest(
        res,
        "Please provide all required bill details"
      );
    }

    // Convert amount to Decimal128 for accuracy
    const billAmount = mongoose.Types.Decimal128.fromString(amount.toString());
    const today = new Date();
    const billDueDate = new Date(dueDate.toString());

    let paymentSource;

    if (paymentMethod && paymentMethodType) {
      if (paymentMethodType === "Account") {
        paymentSource = await Account.findOne({
          accountNumber: paymentMethod,
          user: req.user._id,
        }).session(session);
      } else if (["Card", "Wallet"].includes(paymentMethodType)) {
        paymentSource = await Card.findOne({
          number: paymentMethodType === "Card" ? paymentMethod : undefined,
          address: paymentMethodType === "Wallet" ? paymentMethod : undefined,
          user: req.user._id,
        }).session(session);
      }

      if (!paymentSource) {
        logger.warn("Invalid payment method", {
          userId: req.user._id,
          requestId: req.id,
          paymentMethod,
          paymentMethodType,
          timestamp: new Date().toISOString(),
        });
        return apiResponse.badRequest(res, "Invalid payment method");
      }

      // Deduct balance if due date is today or overdue
      if (billDueDate <= today) {
        let balanceField =
          paymentMethodType === "Account" ? "availableBalance" : "balance";

        const currentBalance = parseFloat(
          paymentSource[balanceField].toString()
        );

        if (currentBalance < parseFloat(amount)) {
          logger.warn("Insufficient funds", {
            userId: req.user._id,
            requestId: req.id,
            balance: currentBalance,
            attemptedCharge: amount,
            timestamp: new Date().toISOString(),
          });
          return apiResponse.badRequest(res, "Insufficient funds");
        }

        // Deduct amount
        paymentSource[balanceField] = mongoose.Types.Decimal128.fromString(
          (currentBalance - parseFloat(amount)).toFixed(2)
        );

        await paymentSource.save({ session });

        logger.info("Payment deducted successfully", {
          userId: req.user._id,
          requestId: req.id,
          balanceAfterDeduction: paymentSource[balanceField].toString(),
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Create the new bill
    const newBill = new Bill({
      user: req.user._id,
      title,
      customName,
      amount: billAmount,
      dueDate: billDueDate,
      accountNumber,
      provider,
      paymentMethod,
      paymentMethodType,
      isEbillEnrolled: isEbillEnrolled || false,
      isRecurring: isRecurring || false,
      category: category || "other",
      icon,
      notes,
    });

    // Set recurring details if this is a recurring bill
    if (isRecurring && recurringDetails) {
      newBill.recurringDetails = {
        frequency: recurringDetails.frequency || "monthly",
        nextPaymentDate: recurringDetails.nextPaymentDate || billDueDate,
        autopay: recurringDetails.autopay || false,
      };
    }

    // Save the bill
    const savedBill = await newBill.save({ session });

    logger.debug("Bill saved successfully", {
      userId: req.user._id,
      requestId: req.id,
      billId: savedBill._id,
      timestamp: new Date().toISOString(),
    });

    // Add bill reference to user's bills array if it's an eBill or recurring
    if (isEbillEnrolled || isRecurring) {
      await User.findByIdAndUpdate(
        req.user._id,
        { $addToSet: { bills: savedBill._id } },
        { session }
      );

      logger.debug("Bill added to user's bills collection", {
        userId: req.user._id,
        requestId: req.id,
        billId: savedBill._id,
        timestamp: new Date().toISOString(),
      });
    }

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Bill created successfully", {
      userId: req.user._id,
      requestId: req.id,
      billId: savedBill._id,
      timestamp: new Date().toISOString(),
    });

    res.status(201).json({
      status: "success",
      message: "Bill created successfully",
      data: savedBill,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    logger.error("Bill creation failed:", {
      error: error.message,
      stack: error.stack,
      userId: req.user._id,
      requestId: req.id,
      requestBody: req.body,
      timestamp: new Date().toISOString(),
    });

    next(error);
  }
};

/**
 * @desc    Get all bills for a user
 * @route   GET /api/bills
 * @access  Private
 */
exports.getUserBills = async (req, res, next) => {
  try {
    logger.info("Get user bills request initiated", {
      userId: req.user._id,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });

    const {
      status,
      category,
      isRecurring,
      isEbillEnrolled,
      sort,
      limit = 10,
      page = 1,
    } = req.query;

    // Build query object
    const query = { user: req.user._id };

    // Add filters if provided
    if (status) query.status = status;
    if (category) query.category = category;
    if (isRecurring === "true") query.isRecurring = true;
    if (isRecurring === "false") query.isRecurring = false;
    if (isEbillEnrolled === "true") query.isEbillEnrolled = true;
    if (isEbillEnrolled === "false") query.isEbillEnrolled = false;

    // Build sort object
    let sortOption = { dueDate: 1 }; // Default: sort by due date ascending
    if (sort) {
      const [field, order] = sort.split(":");
      sortOption = { [field]: order === "desc" ? -1 : 1 };
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Execute query with pagination and sorting
    const bills = await Bill.find(query)
      .sort(sortOption)
      .skip(skip)
      .limit(parseInt(limit))
      .populate({
        path: "paymentMethod",
        select: "accountName accountNumber availableBalance number balance",
      });

    // Count total documents for pagination
    const totalBills = await Bill.countDocuments(query);

    logger.info("User bills retrieved successfully", {
      userId: req.user._id,
      requestId: req.id,
      count: bills.length,
      totalBills,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      status: "success",
      data: {
        bills,
        pagination: {
          total: totalBills,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(totalBills / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    logger.error("Error fetching user bills:", {
      error: error.message,
      stack: error.stack,
      userId: req.user._id,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });

    next(error);
  }
};

/**
 * @desc    Get bill by ID
 * @route   GET /api/bills/:billId
 * @access  Private
 */
exports.getBillById = async (req, res, next) => {
  try {
    const { billId } = req.params;

    logger.info("Get bill by ID request initiated", {
      userId: req.user._id,
      requestId: req.id,
      billId,
      timestamp: new Date().toISOString(),
    });

    const bill = await Bill.findOne({
      _id: billId,
      user: req.user._id,
    }).populate({
      path: "paymentMethod",
      select: "accountName accountNumber availableBalance number balance",
    });

    if (!bill) {
      logger.warn("Bill not found or doesn't belong to user", {
        userId: req.user._id,
        requestId: req.id,
        billId,
        timestamp: new Date().toISOString(),
      });
      return apiResponse.notFound(res, "Bill not found");
    }

    logger.info("Bill retrieved successfully", {
      userId: req.user._id,
      requestId: req.id,
      billId: bill._id,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      status: "success",
      data: {
        bill,
      },
    });
  } catch (error) {
    logger.error("Error fetching bill by ID:", {
      error: error.message,
      stack: error.stack,
      userId: req.user._id,
      requestId: req.id,
      billId: req.params.billId,
      timestamp: new Date().toISOString(),
    });

    next(error);
  }
};

/**
 * @desc    Update a bill
 * @route   PUT /api/bills/:billId
 * @access  Private
 */
exports.updateBill = async (req, res, next) => {
  // Start a database transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { billId } = req.params;
    const updateData = req.body;

    logger.info("Update bill request initiated", {
      userId: req.user._id,
      requestId: req.id,
      billId,
      updateData,
      timestamp: new Date().toISOString(),
    });

    // Find the bill and ensure it belongs to the user
    const bill = await Bill.findOne({
      _id: billId,
      user: req.user._id,
    }).session(session);

    if (!bill) {
      logger.warn("Bill not found or doesn't belong to user", {
        userId: req.user._id,
        requestId: req.id,
        billId,
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      session.endSession();
      return apiResponse.notFound(res, "Bill not found");
    }

    // Check if payment method is being updated
    if (updateData.paymentMethod && updateData.paymentMethodType) {
      let paymentSource;

      if (updateData.paymentMethodType === "Account") {
        paymentSource = await Account.findOne({
          _id: updateData.paymentMethod,
          user: req.user._id,
        }).session(session);
      } else if (updateData.paymentMethodType === "Card") {
        paymentSource = await Card.findOne({
          _id: updateData.paymentMethod,
          user: req.user._id,
        }).session(session);
      }

      if (!paymentSource) {
        logger.warn("Invalid payment method", {
          userId: req.user._id,
          requestId: req.id,
          paymentMethod: updateData.paymentMethod,
          paymentMethodType: updateData.paymentMethodType,
          timestamp: new Date().toISOString(),
        });
        await session.abortTransaction();
        session.endSession();
        return apiResponse.badRequest(res, "Invalid payment method");
      }
    }

    // Check if eBill enrollment status is changing
    const wasEbillEnrolled = bill.isEbillEnrolled;
    const isNowEbillEnrolled =
      updateData.isEbillEnrolled !== undefined
        ? updateData.isEbillEnrolled
        : wasEbillEnrolled;

    // Check if recurring status is changing
    const wasRecurring = bill.isRecurring;
    const isNowRecurring =
      updateData.isRecurring !== undefined
        ? updateData.isRecurring
        : wasRecurring;

    // Update bill fields
    Object.keys(updateData).forEach((key) => {
      if (key === "recurringDetails" && updateData.recurringDetails) {
        // Merge existing recurring details with updates
        bill.recurringDetails = {
          ...bill.recurringDetails,
          ...updateData.recurringDetails,
        };
      } else if (key !== "_id" && key !== "user") {
        // Don't allow updating _id or user
        bill[key] = updateData[key];
      }
    });

    // Save updated bill
    const updatedBill = await bill.save({ session });

    // Update user's bills array if needed
    if (
      (!wasEbillEnrolled && isNowEbillEnrolled) ||
      (!wasRecurring && isNowRecurring)
    ) {
      // Bill is now enrolled or recurring, add to user's bills if not already there
      await User.findByIdAndUpdate(
        req.user._id,
        { $addToSet: { bills: updatedBill._id } },
        { session }
      );

      logger.debug("Bill added to user's bills collection", {
        userId: req.user._id,
        requestId: req.id,
        billId: updatedBill._id,
        timestamp: new Date().toISOString(),
      });
    } else if (
      wasEbillEnrolled &&
      !isNowEbillEnrolled &&
      wasRecurring &&
      !isNowRecurring
    ) {
      // Bill is no longer enrolled or recurring, remove from user's bills
      await User.findByIdAndUpdate(
        req.user._id,
        { $pull: { bills: updatedBill._id } },
        { session }
      );

      logger.debug("Bill removed from user's bills collection", {
        userId: req.user._id,
        requestId: req.id,
        billId: updatedBill._id,
        timestamp: new Date().toISOString(),
      });
    }

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Bill updated successfully", {
      userId: req.user._id,
      requestId: req.id,
      billId: updatedBill._id,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      status: "success",
      message: "Bill updated successfully",
      data: updatedBill,
    });
  } catch (error) {
    // Abort transaction if error occurs
    await session.abortTransaction();
    session.endSession();

    logger.error("Bill update failed:", {
      error: error.message,
      stack: error.stack,
      userId: req.user._id,
      requestId: req.id,
      billId: req.params.billId,
      requestBody: req.body,
      timestamp: new Date().toISOString(),
    });

    next(error);
  }
};

/**
 * @desc    Delete a bill
 * @route   DELETE /api/bills/:billId
 * @access  Private
 */
exports.deleteBill = async (req, res, next) => {
  // Start a database transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { billId } = req.params;

    logger.info("Delete bill request initiated", {
      userId: req.user._id,
      requestId: req.id,
      billId,
      timestamp: new Date().toISOString(),
    });

    // Find the bill and ensure it belongs to the user
    const bill = await Bill.findOne({
      _id: billId,
      user: req.user._id,
    }).session(session);

    if (!bill) {
      logger.warn("Bill not found or doesn't belong to user", {
        userId: req.user._id,
        requestId: req.id,
        billId,
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      session.endSession();
      return apiResponse.notFound(res, "Bill not found");
    }

    // Remove bill reference from user's bills array
    await User.findByIdAndUpdate(
      req.user._id,
      { $pull: { bills: bill._id } },
      { session }
    );

    logger.debug("Bill removed from user's bills collection", {
      userId: req.user._id,
      requestId: req.id,
      billId: bill._id,
      timestamp: new Date().toISOString(),
    });

    // Delete the bill
    await Bill.findByIdAndDelete(billId).session(session);

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Bill deleted successfully", {
      userId: req.user._id,
      requestId: req.id,
      billId,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      status: "success",
      message: "Bill deleted successfully",
    });
  } catch (error) {
    // Abort transaction if error occurs
    await session.abortTransaction();
    session.endSession();

    logger.error("Bill deletion failed:", {
      error: error.message,
      stack: error.stack,
      userId: req.user._id,
      requestId: req.id,
      billId: req.params.billId,
      timestamp: new Date().toISOString(),
    });

    next(error);
  }
};

/**
 * @desc    Pay a bill
 * @route   POST /api/bills/:billId/pay
 * @access  Private
 */
exports.payBill = async (req, res, next) => {
  // Start a database transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { billId } = req.params;
    const {
      amount,
      paymentMethod,
      paymentMethodType,
      description,
      metadata,
      passcode,
    } = req.body;

    logger.info("Pay bill request initiated", {
      userId: req.user._id,
      requestId: req.id,
      billId,
      timestamp: new Date().toISOString(),
    });

    // Find the bill and ensure it belongs to the user
    const bill = await Bill.findOne({
      _id: billId,
      user: req.user._id,
    }).session(session);

    if (!bill) {
      logger.warn("Bill not found or doesn't belong to user", {
        userId: req.user._id,
        requestId: req.id,
        billId,
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      session.endSession();
      return apiResponse.notFound(res, "Bill not found");
    }

    // If bill is already paid, prevent duplicate payment
    if (bill.status === "paid") {
      logger.warn("Bill already paid", {
        userId: req.user._id,
        requestId: req.id,
        billId,
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      session.endSession();
      return apiResponse.badRequest(res, "This bill has already been paid");
    }

    // Determine payment amount - use provided amount or bill amount
    const paymentAmount = amount || bill.amount;

    // Validate payment method
    const paymentSourceId = paymentMethod || bill.paymentMethod;
    const paymentSourceType = paymentMethodType || bill.paymentMethodType;

    if (!paymentSourceId || !paymentSourceType) {
      logger.warn("Payment method not specified", {
        userId: req.user._id,
        requestId: req.id,
        billId,
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      session.endSession();
      return apiResponse.badRequest(res, "Payment method not specified");
    }

    // Retrieve payment source
    let paymentSource;
    if (paymentSourceType === "Account") {
      paymentSource = await Account.findOne({
        _id: paymentSourceId,
        user: req.user._id,
      }).session(session);
    } else if (paymentSourceType === "Card") {
      paymentSource = await Card.findOne({
        _id: paymentSourceId,
        user: req.user._id,
      }).session(session);
    }

    if (!paymentSource) {
      logger.warn("Invalid payment method", {
        userId: req.user._id,
        requestId: req.id,
        paymentMethod: paymentSourceId,
        paymentMethodType: paymentSourceType,
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      session.endSession();
      return apiResponse.badRequest(res, "Invalid payment method");
    }

    // Check if payment source has sufficient balance
    const sourceBalance =
      paymentSourceType === "Account"
        ? parseFloat(paymentSource.availableBalance.toString())
        : parseFloat(paymentSource.balance.toString());

    if (sourceBalance < paymentAmount) {
      logger.warn("Insufficient funds for bill payment", {
        userId: req.user._id,
        requestId: req.id,
        billId,
        paymentSourceId,
        sourceBalance,
        paymentAmount,
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      session.endSession();
      return apiResponse.badRequest(res, "Insufficient funds for payment");
    }

    // Create a decimal amount for precise calculations
    const decimalAmount = mongoose.Types.Decimal128.fromString(
      paymentAmount.toString()
    );

    // Generate a reference number for the transaction
    const transactionReference = `BILL-${Date.now()}-${Math.floor(
      Math.random() * 1000
    )}`;

    // Deduct from payment source
    if (paymentSourceType === "Account") {
      const oldBalance = paymentSource.availableBalance.toString();
      paymentSource.availableBalance = mongoose.Types.Decimal128.fromString(
        (
          parseFloat(paymentSource.availableBalance.toString()) - paymentAmount
        ).toFixed(8)
      );

      logger.debug("Updating payment source balance", {
        userId: req.user._id,
        requestId: req.id,
        paymentSourceId,
        oldBalance,
        amountDeducted: decimalAmount.toString(),
        newBalance: paymentSource.availableBalance.toString(),
        timestamp: new Date().toISOString(),
      });
    } else if (paymentSourceType === "Card") {
      const oldBalance = paymentSource.balance.toString();
      paymentSource.balance = mongoose.Types.Decimal128.fromString(
        (parseFloat(paymentSource.balance.toString()) - paymentAmount).toFixed(
          8
        )
      );

      logger.debug("Updating payment source balance", {
        userId: req.user._id,
        requestId: req.id,
        paymentSourceId,
        oldBalance,
        amountDeducted: decimalAmount.toString(),
        newBalance: paymentSource.balance.toString(),
        timestamp: new Date().toISOString(),
      });
    }

    await paymentSource.save({ session });

    // Create transaction record
    const transaction = new Transaction({
      user: req.user._id,
      type: "Debit",
      amount: decimalAmount,
      source:
        paymentSourceType === "Account"
          ? paymentSource.accountNumber
          : paymentSource.number,
      sourceType: paymentSourceType,
      sourceCurrency: paymentSource.currency || "USD",
      sourceUser: req.user._id,
      destination: bill.accountNumber,
      destinationType: "External",
      destinationCurrency: "USD",
      beneficiary: bill.provider,
      description: description || `Payment for ${bill.title}`,
      status: "completed",
      reference: transactionReference,
      metadata: metadata || {
        billId: bill._id.toString(),
        billProvider: bill.provider,
        billType: bill.category,
      },
    });

    await transaction.save({ session });

    logger.debug("Payment transaction created", {
      userId: req.user._id,
      requestId: req.id,
      transactionId: transaction._id,
      billId: bill._id,
      reference: transactionReference,
      timestamp: new Date().toISOString(),
    });

    // Add transaction ID to payment source
    if (!paymentSource.transactions) {
      paymentSource.transactions = [];
    }
    paymentSource.transactions.push(transaction._id);
    await paymentSource.save({ session });

    // Update bill status to paid
    await bill.markAsPaid(
      paymentAmount,
      transaction._id,
      transactionReference,
      description
    );

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Bill payment processed successfully", {
      userId: req.user._id,
      requestId: req.id,
      billId: bill._id,
      transactionId: transaction._id,
      reference: transactionReference,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      status: "success",
      message: "Bill payment processed successfully",
      reference: transactionReference,
      data: {
        bill,
        transaction,
        nextDueDate: bill.isRecurring ? bill.dueDate : null,
      },
    });
  } catch (error) {
    // Abort transaction if error occurs
    await session.abortTransaction();
    session.endSession();

    logger.error("Bill payment failed:", {
      error: error.message,
      stack: error.stack,
      userId: req.user._id,
      requestId: req.id,
      billId: req.params.billId,
      requestBody: req.body,
      timestamp: new Date().toISOString(),
    });

    next(error);
  }
};

/**
 * @desc    Schedule a bill payment
 * @route   POST /api/bills/:billId/schedule
 * @access  Private
 */
exports.scheduleBillPayment = async (req, res, next) => {
  // Start a database transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { billId } = req.params;
    const { paymentDate, paymentMethod, paymentMethodType } = req.body;

    logger.info("Schedule bill payment request initiated", {
      userId: req.user._id,
      requestId: req.id,
      billId,
      paymentDate,
      timestamp: new Date().toISOString(),
    });

    if (!paymentDate) {
      logger.warn("Payment date not specified", {
        userId: req.user._id,
        requestId: req.id,
        billId,
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      session.endSession();
      return apiResponse.badRequest(res, "Payment date is required");
    }

    // Validate payment date
    const scheduledDate = new Date(paymentDate);
    const now = new Date();

    if (scheduledDate < now) {
      logger.warn("Invalid payment date - in the past", {
        userId: req.user._id,
        requestId: req.id,
        billId,
        paymentDate,
        now: now.toISOString(),
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      session.endSession();
      return apiResponse.badRequest(res, "Payment date cannot be in the past");
    }

    // Find the bill and ensure it belongs to the user
    const bill = await Bill.findOne({
      _id: billId,
      user: req.user._id,
    }).session(session);

    if (!bill) {
      logger.warn("Bill not found or doesn't belong to user", {
        userId: req.user._id,
        requestId: req.id,
        billId,
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      session.endSession();
      return apiResponse.notFound(res, "Bill not found");
    }

    // If bill is already paid, prevent scheduling payment
    if (bill.status === "paid") {
      logger.warn("Cannot schedule payment for already paid bill", {
        userId: req.user._id,
        requestId: req.id,
        billId,
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      session.endSession();
      return apiResponse.badRequest(res, "This bill has already been paid");
    }

    // Determine payment method
    const paymentSourceId = paymentMethod || bill.paymentMethod;
    const paymentSourceType = paymentMethodType || bill.paymentMethodType;

    if (!paymentSourceId || !paymentSourceType) {
      logger.warn("Payment method not specified", {
        userId: req.user._id,
        requestId: req.id,
        billId,
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      session.endSession();
      return apiResponse.badRequest(res, "Payment method not specified");
    }

    // Validate payment method
    let paymentSource;
    if (paymentSourceType === "Account") {
      paymentSource = await Account.findOne({
        _id: paymentSourceId,
        user: req.user._id,
      }).session(session);
    } else if (paymentSourceType === "Card") {
      paymentSource = await Card.findOne({
        _id: paymentSourceId,
        user: req.user._id,
      }).session(session);
    }

    if (!paymentSource) {
      logger.warn("Invalid payment method", {
        userId: req.user._id,
        requestId: req.id,
        paymentMethod: paymentSourceId,
        paymentMethodType: paymentSourceType,
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      session.endSession();
      return apiResponse.badRequest(res, "Invalid payment method");
    }

    // Schedule the payment
    const result = await bill.schedulePayment(
      scheduledDate,
      paymentSourceId,
      paymentSourceType
    );

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Bill payment scheduled successfully", {
      userId: req.user._id,
      requestId: req.id,
      billId: bill._id,
      scheduledDate: scheduledDate.toISOString(),
      paymentSourceId,
      paymentSourceType,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      status: "success",
      message: "Bill payment scheduled successfully",
      data: {
        bill,
        scheduledDate,
      },
    });
  } catch (error) {
    // Abort transaction if error occurs
    await session.abortTransaction();
    session.endSession();

    logger.error("Bill payment scheduling failed:", {
      error: error.message,
      stack: error.stack,
      userId: req.user._id,
      requestId: req.id,
      billId: req.params.billId,
      requestBody: req.body,
      timestamp: new Date().toISOString(),
    });

    next(error);
  }
};

/**
 * @desc    Enable or disable eBill enrollment
 * @route   POST /api/bills/:billId/ebill
 * @access  Private
 */
exports.toggleEbillEnrollment = async (req, res, next) => {
  // Start a database transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { billId } = req.params;
    const { enroll = true } = req.body;

    logger.info("eBill enrollment request initiated", {
      userId: req.user._id,
      requestId: req.id,
      billId,
      action: enroll ? "enroll" : "unenroll",
      timestamp: new Date().toISOString(),
    });

    // Find the bill and ensure it belongs to the user
    const bill = await Bill.findOne({
      _id: billId,
      user: req.user._id,
    }).session(session);

    if (!bill) {
      logger.warn("Bill not found or doesn't belong to user", {
        userId: req.user._id,
        requestId: req.id,
        billId,
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      session.endSession();
      return apiResponse.notFound(res, "Bill not found");
    }

    // Update eBill enrollment status
    bill.isEbillEnrolled = enroll;
    await bill.save({ session });

    // Update user's bills array if needed
    if (enroll) {
      // Add to user's bills if not already there
      await User.findByIdAndUpdate(
        req.user._id,
        { $addToSet: { bills: bill._id } },
        { session }
      );

      logger.debug("Bill added to user's bills collection for eBill", {
        userId: req.user._id,
        requestId: req.id,
        billId: bill._id,
        timestamp: new Date().toISOString(),
      });
    } else if (!bill.isRecurring) {
      // If not recurring and eBill is now disabled, remove from user's bills
      await User.findByIdAndUpdate(
        req.user._id,
        { $pull: { bills: bill._id } },
        { session }
      );

      logger.debug("Bill removed from user's bills collection", {
        userId: req.user._id,
        requestId: req.id,
        billId: bill._id,
        timestamp: new Date().toISOString(),
      });
    }

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    logger.info(`eBill ${enroll ? "enrollment" : "unenrollment"} successful`, {
      userId: req.user._id,
      requestId: req.id,
      billId: bill._id,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      status: "success",
      message: `eBill ${enroll ? "enrollment" : "unenrollment"} successful`,
      data: {
        bill,
      },
    });
  } catch (error) {
    // Abort transaction if error occurs
    await session.abortTransaction();
    session.endSession();

    logger.error("eBill enrollment toggle failed:", {
      error: error.message,
      stack: error.stack,
      userId: req.user._id,
      requestId: req.id,
      billId: req.params.billId,
      requestBody: req.body,
      timestamp: new Date().toISOString(),
    });

    next(error);
  }
};

/**
 * @desc    Configure recurring bill settings
 * @route   POST /api/bills/:billId/recurring
 * @access  Private
 */
exports.configureRecurringBill = async (req, res, next) => {
  // Start a database transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { billId } = req.params;
    const {
      enable = true,
      frequency = "monthly",
      nextPaymentDate,
      autopay = false,
    } = req.body;

    logger.info("Recurring bill configuration request initiated", {
      userId: req.user._id,
      requestId: req.id,
      billId,
      action: enable ? "enable" : "disable",
      frequency,
      autopay,
      timestamp: new Date().toISOString(),
    });

    // Find the bill and ensure it belongs to the user
    const bill = await Bill.findOne({
      _id: billId,
      user: req.user._id,
    }).session(session);

    if (!bill) {
      logger.warn("Bill not found or doesn't belong to user", {
        userId: req.user._id,
        requestId: req.id,
        billId,
        timestamp: new Date().toISOString(),
      });
      await session.abortTransaction();
      session.endSession();
      return apiResponse.notFound(res, "Bill not found");
    }

    // Update recurring bill settings
    bill.isRecurring = enable;

    if (enable) {
      // Set or update recurring details
      bill.recurringDetails = {
        frequency,
        nextPaymentDate: nextPaymentDate
          ? new Date(nextPaymentDate)
          : bill.dueDate,
        autopay,
      };
    } else {
      // Clear recurring details if disabling
      bill.recurringDetails = undefined;
    }

    await bill.save({ session });

    // Update user's bills array if needed
    if (enable) {
      // Add to user's bills if not already there
      await User.findByIdAndUpdate(
        req.user._id,
        { $addToSet: { bills: bill._id } },
        { session }
      );

      logger.debug("Bill added to user's bills collection for recurring", {
        userId: req.user._id,
        requestId: req.id,
        billId: bill._id,
        timestamp: new Date().toISOString(),
      });
    } else if (!bill.isEbillEnrolled) {
      // If not eBill enrolled and recurring is now disabled, remove from user's bills
      await User.findByIdAndUpdate(
        req.user._id,
        { $pull: { bills: bill._id } },
        { session }
      );

      logger.debug("Bill removed from user's bills collection", {
        userId: req.user._id,
        requestId: req.id,
        billId: bill._id,
        timestamp: new Date().toISOString(),
      });
    }

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    logger.info(
      `Recurring bill ${enable ? "enabled" : "disabled"} successfully`,
      {
        userId: req.user._id,
        requestId: req.id,
        billId: bill._id,
        timestamp: new Date().toISOString(),
      }
    );

    res.status(200).json({
      status: "success",
      message: `Recurring bill ${enable ? "enabled" : "disabled"} successfully`,
      data: {
        bill,
      },
    });
  } catch (error) {
    // Abort transaction if error occurs
    await session.abortTransaction();
    session.endSession();

    logger.error("Recurring bill configuration failed:", {
      error: error.message,
      stack: error.stack,
      userId: req.user._id,
      requestId: req.id,
      billId: req.params.billId,
      requestBody: req.body,
      timestamp: new Date().toISOString(),
    });

    next(error);
  }
};

/**
 * @desc    Get bill payment history
 * @route   GET /api/bills/:billId/history
 * @access  Private
 */
exports.getBillPaymentHistory = async (req, res, next) => {
  try {
    const { billId } = req.params;

    logger.info("Get bill payment history request initiated", {
      userId: req.user._id,
      requestId: req.id,
      billId,
      timestamp: new Date().toISOString(),
    });

    // Find the bill and ensure it belongs to the user
    const bill = await Bill.findOne({
      _id: billId,
      user: req.user._id,
    });

    if (!bill) {
      logger.warn("Bill not found or doesn't belong to user", {
        userId: req.user._id,
        requestId: req.id,
        billId,
        timestamp: new Date().toISOString(),
      });
      return apiResponse.notFound(res, "Bill not found");
    }

    // Get detailed payment history with transaction details
    const paymentHistory = await Promise.all(
      bill.paymentHistory.map(async (payment) => {
        let transaction = null;
        if (payment.transactionId) {
          transaction = await Transaction.findById(payment.transactionId)
            .select("type amount source destination status reference createdAt")
            .lean();
        }

        return {
          ...payment.toObject(),
          transaction,
        };
      })
    );

    logger.info("Bill payment history retrieved successfully", {
      userId: req.user._id,
      requestId: req.id,
      billId: bill._id,
      paymentCount: paymentHistory.length,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      status: "success",
      data: {
        bill: {
          _id: bill._id,
          title: bill.title,
          provider: bill.provider,
          category: bill.category,
        },
        paymentHistory,
      },
    });
  } catch (error) {
    logger.error("Error fetching bill payment history:", {
      error: error.message,
      stack: error.stack,
      userId: req.user._id,
      requestId: req.id,
      billId: req.params.billId,
      timestamp: new Date().toISOString(),
    });

    next(error);
  }
};

/**
 * @desc    Get upcoming bills
 * @route   GET /api/bills/upcoming
 * @access  Private
 */
exports.getUpcomingBills = async (req, res, next) => {
  try {
    const { days = 30, limit = 10 } = req.query;

    logger.info("Get upcoming bills request initiated", {
      userId: req.user._id,
      requestId: req.id,
      daysAhead: days,
      timestamp: new Date().toISOString(),
    });

    const today = new Date();
    const endDate = new Date();
    endDate.setDate(today.getDate() + parseInt(days));

    // Find upcoming bills that are due within the specified period
    const upcomingBills = await Bill.find({
      user: req.user._id,
      dueDate: { $gte: today, $lte: endDate },
      status: { $in: ["pending", "scheduled"] },
    })
      .sort({ dueDate: 1 })
      .limit(parseInt(limit))
      .populate({
        path: "paymentMethod",
        select: "accountName accountNumber availableBalance number balance",
      });

    logger.info("Upcoming bills retrieved successfully", {
      userId: req.user._id,
      requestId: req.id,
      count: upcomingBills.length,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      status: "success",
      data: {
        upcomingBills,
      },
    });
  } catch (error) {
    logger.error("Error fetching upcoming bills:", {
      error: error.message,
      stack: error.stack,
      userId: req.user._id,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });

    next(error);
  }
};

/**
 * @desc    Process due bills with autopay enabled
 * @route   POST /api/bills/process-autopay
 * @access  Private (Should be called by a scheduled job)
 */
exports.processAutopayBills = async (req, res, next) => {
  // This would typically be a scheduled job rather than a user-facing API
  // Start a database transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    logger.info("Process autopay bills job initiated", {
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Find all bills that are due today and have autopay enabled
    const dueBills = await Bill.find({
      dueDate: { $gte: today, $lt: tomorrow },
      status: "pending",
      isRecurring: true,
      "recurringDetails.autopay": true,
    }).session(session);

    logger.info(
      `Found ${dueBills.length} bills due today with autopay enabled`,
      {
        requestId: req.id,
        timestamp: new Date().toISOString(),
      }
    );

    const results = {
      processed: 0,
      failed: 0,
      details: [],
    };

    // Process each bill
    for (const bill of dueBills) {
      try {
        // Get payment source
        let paymentSource;
        if (bill.paymentMethodType === "Account") {
          paymentSource = await Account.findOne({
            _id: bill.paymentMethod,
            user: bill.user,
          }).session(session);
        } else if (bill.paymentMethodType === "Card") {
          paymentSource = await Card.findOne({
            _id: bill.paymentMethod,
            user: bill.user,
          }).session(session);
        }

        if (!paymentSource) {
          logger.warn(`Invalid payment method for bill ${bill._id}`, {
            billId: bill._id,
            userId: bill.user,
            paymentMethod: bill.paymentMethod,
            paymentMethodType: bill.paymentMethodType,
            timestamp: new Date().toISOString(),
          });

          results.failed++;
          results.details.push({
            billId: bill._id,
            status: "failed",
            reason: "Invalid payment method",
          });
          continue;
        }

        // Check if payment source has sufficient balance
        const sourceBalance =
          bill.paymentMethodType === "Account"
            ? parseFloat(paymentSource.availableBalance.toString())
            : parseFloat(paymentSource.balance.toString());

        if (sourceBalance < bill.amount) {
          logger.warn(`Insufficient funds for autopay bill ${bill._id}`, {
            billId: bill._id,
            userId: bill.user,
            sourceBalance,
            billAmount: bill.amount,
            timestamp: new Date().toISOString(),
          });

          results.failed++;
          results.details.push({
            billId: bill._id,
            status: "failed",
            reason: "Insufficient funds",
          });
          continue;
        }

        // Create a decimal amount for precise calculations
        const decimalAmount = mongoose.Types.Decimal128.fromString(
          bill.amount.toString()
        );

        // Generate a reference number for the transaction
        const transactionReference = `AUTOPAY-${Date.now()}-${Math.floor(
          Math.random() * 1000
        )}`;

        // Deduct from payment source
        if (bill.paymentMethodType === "Account") {
          const oldBalance = paymentSource.availableBalance.toString();
          paymentSource.availableBalance = mongoose.Types.Decimal128.fromString(
            (
              parseFloat(paymentSource.availableBalance.toString()) -
              bill.amount
            ).toFixed(8)
          );

          logger.debug(
            `Updating account balance for autopay bill ${bill._id}`,
            {
              billId: bill._id,
              userId: bill.user,
              accountId: paymentSource._id,
              oldBalance,
              amountDeducted: decimalAmount.toString(),
              newBalance: paymentSource.availableBalance.toString(),
              timestamp: new Date().toISOString(),
            }
          );
        } else if (bill.paymentMethodType === "Card") {
          const oldBalance = paymentSource.balance.toString();
          paymentSource.balance = mongoose.Types.Decimal128.fromString(
            (
              parseFloat(paymentSource.balance.toString()) - bill.amount
            ).toFixed(8)
          );

          logger.debug(`Updating card balance for autopay bill ${bill._id}`, {
            billId: bill._id,
            userId: bill.user,
            cardId: paymentSource._id,
            oldBalance,
            amountDeducted: decimalAmount.toString(),
            newBalance: paymentSource.balance.toString(),
            timestamp: new Date().toISOString(),
          });
        }

        await paymentSource.save({ session });

        // Create transaction record
        const transaction = new Transaction({
          user: bill.user,
          type: "Debit",
          amount: decimalAmount,
          source:
            bill.paymentMethodType === "Account"
              ? paymentSource.accountNumber
              : paymentSource.number,
          sourceType: bill.paymentMethodType,
          sourceCurrency: paymentSource.currency || "USD",
          sourceUser: bill.user,
          destination: bill.accountNumber,
          destinationType: "External",
          destinationCurrency: "USD",
          beneficiary: bill.provider,
          description: `Autopay for ${bill.title}`,
          status: "completed",
          reference: transactionReference,
          metadata: {
            billId: bill._id.toString(),
            billProvider: bill.provider,
            billType: bill.category,
            autopay: true,
          },
        });

        await transaction.save({ session });

        // Add transaction ID to payment source
        if (!paymentSource.transactions) {
          paymentSource.transactions = [];
        }
        paymentSource.transactions.push(transaction._id);
        await paymentSource.save({ session });

        // Update bill status to paid
        await bill.markAsPaid(
          bill.amount,
          transaction._id,
          transactionReference,
          "Automatic payment"
        );

        logger.info(`Autopay processed successfully for bill ${bill._id}`, {
          billId: bill._id,
          userId: bill.user,
          transactionId: transaction._id,
          reference: transactionReference,
          timestamp: new Date().toISOString(),
        });

        results.processed++;
        results.details.push({
          billId: bill._id,
          status: "success",
          transactionId: transaction._id,
          reference: transactionReference,
        });
      } catch (error) {
        logger.error(`Error processing autopay for bill ${bill._id}:`, {
          error: error.message,
          stack: error.stack,
          billId: bill._id,
          userId: bill.user,
          timestamp: new Date().toISOString(),
        });

        results.failed++;
        results.details.push({
          billId: bill._id,
          status: "failed",
          reason: error.message,
        });
      }
    }

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    logger.info("Autopay processing completed", {
      requestId: req.id,
      processed: results.processed,
      failed: results.failed,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      status: "success",
      message: "Autopay bills processed",
      data: results,
    });
  } catch (error) {
    // Abort transaction if error occurs
    await session.abortTransaction();
    session.endSession();

    logger.error("Autopay processing failed:", {
      error: error.message,
      stack: error.stack,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });

    next(error);
  }
};

/**
 * @desc    Get bills by category
 * @route   GET /api/bills/category/:category
 * @access  Private
 */
exports.getBillsByCategory = async (req, res, next) => {
  try {
    const { category } = req.params;
    const { status, limit = 10, page = 1 } = req.query;

    logger.info("Get bills by category request initiated", {
      userId: req.user._id,
      requestId: req.id,
      category,
      timestamp: new Date().toISOString(),
    });

    // Build query object
    const query = { user: req.user._id, category };

    // Add status filter if provided
    if (status) query.status = status;

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Execute query with pagination
    const bills = await Bill.find(query)
      .sort({ dueDate: 1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate({
        path: "paymentMethod",
        select: "accountName accountNumber availableBalance number balance",
      });

    // Count total documents for pagination
    const totalBills = await Bill.countDocuments(query);

    logger.info("Category bills retrieved successfully", {
      userId: req.user._id,
      requestId: req.id,
      category,
      count: bills.length,
      totalBills,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      status: "success",
      data: {
        category,
        bills,
        pagination: {
          total: totalBills,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(totalBills / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    logger.error("Error fetching bills by category:", {
      error: error.message,
      stack: error.stack,
      userId: req.user._id,
      requestId: req.id,
      category: req.params.category,
      timestamp: new Date().toISOString(),
    });

    next(error);
  }
};
