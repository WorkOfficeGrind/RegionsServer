// models/adminActionLog.js
const mongoose = require("mongoose");

const adminActionLogSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    action: {
      type: String,
      required: true,
      enum: [
        "CREATE_USER",
        "UPDATE_USER",
        "DEACTIVATE_USER",
        "ACTIVATE_USER",
        "RESET_PASSWORD",
        "SET_PASSWORD",
        "RESET_PIN",
        "SET_PIN",
        "LOCK_ACCOUNT",
        "UNLOCK_ACCOUNT",
        "APPROVE_KYC",
        "REJECT_KYC",
        "ADD_ACCOUNT",
        "MODIFY_ACCOUNT",
        "CLOSE_ACCOUNT",
        "ISSUE_CARD",
        "LOCK_CARD",
        "UNLOCK_CARD",
        "CANCEL_CARD",
      ],
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    ipAddress: {
      type: String,
    },
    userAgent: {
      type: String,
    },
    requestId: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Add text index for searching
adminActionLogSchema.index({ action: "text" });

// Add compound index for filtering
adminActionLogSchema.index({ adminId: 1, createdAt: -1 });
adminActionLogSchema.index({ userId: 1, createdAt: -1 });
adminActionLogSchema.index({ action: 1, createdAt: -1 });

const AdminActionLog = mongoose.model("AdminActionLog", adminActionLogSchema);

module.exports = AdminActionLog;
