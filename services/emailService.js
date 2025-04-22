/**
 * Email service using Brevo (formerly Sendinblue) for all application notifications
 */
const SibApiV3Sdk = require("sib-api-v3-sdk");
const config = require("../config/config");
const { logger } = require("../config/logger");

// Configure Brevo API client
const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications["api-key"];
apiKey.apiKey = config.brevo.apiKey;

// Create API instance
const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

/**
 * Generic email sending function
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email address
 * @param {string} options.toName - Recipient name
 * @param {string} options.templateId - Brevo template ID
 * @param {Object} options.params - Template parameters
 * @param {string} options.subject - Email subject (overrides template subject)
 * @param {string} options.cc - CC email address
 * @param {string} options.bcc - BCC email address
 * @param {Array} options.attachments - Email attachments
 * @param {Array} options.tags - Tags for email categorization and tracking
 * @param {string} options.htmlContent - Optional HTML content (overrides template)
 * @returns {Promise} - API response
 */
const sendEmail = async (options) => {
  const requestId = options.requestId || `email-${Date.now()}`;

  try {
    logger.debug("Preparing to send email", {
      requestId,
      emailType:
        options.tags && options.tags.length > 0 ? options.tags[0] : "custom",
      to: options.to,
      templateId: options.templateId,
    });

    // Validate required fields
    if (!options.to) {
      logger.error("Email validation failed: Recipient email is required", {
        requestId,
      });
      throw new Error("Recipient email is required");
    }

    if (!options.templateId && !options.htmlContent) {
      logger.error(
        "Email validation failed: Either templateId or htmlContent is required",
        { requestId }
      );
      throw new Error("Either templateId or htmlContent is required");
    }

    // Create a send email object
    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();

    // Set recipient
    sendSmtpEmail.to = [
      {
        email: options.to,
        name: options.toName || options.to,
      },
    ];

    // Set optional CC/BCC
    if (options.cc) {
      sendSmtpEmail.cc = Array.isArray(options.cc)
        ? options.cc.map((email) => ({ email }))
        : [{ email: options.cc }];
    }

    if (options.bcc) {
      sendSmtpEmail.bcc = Array.isArray(options.bcc)
        ? options.bcc.map((email) => ({ email }))
        : [{ email: options.bcc }];
    }

    // Set sender information
    sendSmtpEmail.sender = {
      email: config.brevo.senderEmail,
      name: config.brevo.senderName,
    };

    // Set template or HTML content
    if (options.templateId) {
      sendSmtpEmail.templateId = parseInt(options.templateId);
      sendSmtpEmail.params = options.params || {};
    }

    if (options.htmlContent) {
      sendSmtpEmail.htmlContent = options.htmlContent;
    }

    // Set subject if provided
    if (options.subject) {
      sendSmtpEmail.subject = options.subject;
    }

    // Add attachments if any
    if (options.attachments && options.attachments.length > 0) {
      sendSmtpEmail.attachment = options.attachments;
    }

    // Add tags for tracking
    if (options.tags && options.tags.length > 0) {
      sendSmtpEmail.tags = Array.isArray(options.tags)
        ? options.tags
        : [options.tags];
    }

    // Log before sending
    logger.info("Sending email", {
      requestId,
      to: options.to,
      templateId: options.templateId,
      subject: options.subject,
      hasHtmlContent: !!options.htmlContent,
      tags: options.tags
        ? Array.isArray(options.tags)
          ? options.tags.join(",")
          : options.tags
        : "none",
    });

    // Record start time for performance tracking
    const startTime = Date.now();

    // Send the email
    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);

    // Calculate request duration
    const duration = Date.now() - startTime;

    // Log success
    logger.info("Email sent successfully", {
      requestId,
      messageId: data.messageId,
      to: options.to,
      duration: `${duration}ms`,
    });

    return data;
  } catch (error) {
    // Enhanced error logging with detailed information
    const errorDetails = {
      requestId,
      to: options.to,
      templateId: options.templateId,
      errorMessage: error.message,
      errorName: error.name,
      errorCode: error.code || "UNKNOWN",
    };

    // Add API response details if available
    if (error.response) {
      errorDetails.statusCode = error.response.statusCode;
      errorDetails.apiErrorText = error.response.text;

      try {
        errorDetails.apiErrorBody = JSON.stringify(error.response.body);
      } catch (e) {
        errorDetails.apiErrorBody = "Could not stringify error body";
      }
    }

    // Log with context based on error type
    if (
      error.code === "ECONNREFUSED" ||
      error.code === "ETIMEDOUT" ||
      error.code === "ENOTFOUND"
    ) {
      logger.error("Email service connection error", errorDetails);
    } else if (
      error.response &&
      error.response.statusCode >= 400 &&
      error.response.statusCode < 500
    ) {
      logger.error("Email API client error", errorDetails);
    } else if (error.response && error.response.statusCode >= 500) {
      logger.error("Email API server error", errorDetails);
    } else {
      logger.error("Failed to send email", errorDetails);
    }

    // Include stack trace for development environments
    if (config.nodeEnv !== "production") {
      logger.debug("Email error stack trace", {
        requestId,
        stack: error.stack,
      });
    }

    // Don't throw to prevent affecting main application flow
    return { success: false, error: error.message };
  }
};

/**
 * Send welcome email to new users
 * @param {Object} options - Email data
 * @param {string} options.to - User email
 * @param {string} options.name - User name
 * @param {string} options.verificationLink - Account verification link
 * @param {string} options.requestId - Request ID for tracking
 * @returns {Promise} - Send result
 */
const sendWelcomeEmail = async ({ to, name, verificationLink, requestId }) => {
  try {
    logger.debug("Preparing welcome email", { requestId, to, name });

    if (!verificationLink) {
      logger.warn("Welcome email missing verification link", { requestId, to });
    }

    return await sendEmail({
      to,
      toName: name,
      templateId: config.brevo.templates.welcome,
      params: {
        name,
        verification_link: verificationLink,
      },
      tags: ["welcome", "registration"],
      requestId,
    });
  } catch (error) {
    logger.error("Welcome email error", {
      requestId,
      to,
      error: error.message,
    });
    return { success: false, error: error.message };
  }
};

/**
 * Send password reset email
 * @param {Object} options - Email data
 * @param {string} options.to - User email
 * @param {string} options.name - User name
 * @param {string} options.resetLink - Password reset link
 * @param {string} options.requestId - Request ID for tracking
 * @returns {Promise} - Send result
 */
const sendPasswordResetEmail = async ({ to, name, resetLink, requestId }) => {
  try {
    logger.debug("Preparing password reset email", { requestId, to, name });

    if (!resetLink) {
      logger.warn("Password reset email missing reset link", { requestId, to });
    }

    return await sendEmail({
      to,
      toName: name,
      templateId: config.brevo.templates.passwordReset,
      params: {
        name,
        reset_link: resetLink,
        expiry_hours: "24",
      },
      tags: ["password", "reset"],
      requestId,
    });
  } catch (error) {
    logger.error("Password reset email error", {
      requestId,
      to,
      error: error.message,
    });
    return { success: false, error: error.message };
  }
};

/**
 * Send email change verification code
 * @param {Object} options - Email data
 * @param {string} options.to - New email address
 * @param {string} options.name - User name
 * @param {string} options.verificationCode - Verification code
 * @param {string} options.requestId - Request ID for tracking
 * @returns {Promise} - Send result
 */
const sendEmailChangeVerification = async ({
  to,
  name,
  verificationCode,
  requestId,
}) => {
  try {
    logger.debug("Preparing email change verification", {
      requestId,
      to,
      name,
    });

    if (!verificationCode) {
      logger.warn("Email change missing verification code", { requestId, to });
    }

    return await sendEmail({
      to,
      toName: name,
      templateId: config.brevo.templates.emailChangeVerification,
      params: {
        name,
        verification_code: verificationCode,
        expiry_hours: "24",
      },
      tags: ["email-change", "verification"],
      requestId,
    });
  } catch (error) {
    logger.error("Email change verification error", {
      requestId,
      to,
      error: error.message,
    });
    return { success: false, error: error.message };
  }
};

/**
 * Send security alert notification
 * @param {Object} options - Email data
 * @param {string} options.to - Email address
 * @param {string} options.name - User name
 * @param {string} options.alertType - Type of alert (login, password_change, etc.)
 * @param {Object} options.details - Alert details (location, device, time, etc.)
 * @param {string} options.requestId - Request ID for tracking
 * @returns {Promise} - Send result
 */
const sendSecurityAlert = async ({
  to,
  name,
  alertType,
  details,
  requestId,
}) => {
  try {
    logger.debug("Preparing security alert", {
      requestId,
      to,
      name,
      alertType,
    });

    // Generate a more descriptive subject based on alert type
    let subject;
    switch (alertType) {
      case "login":
        subject = "Security Alert: New Login Detected";
        break;
      case "password_change":
        subject = "Security Alert: Password Changed";
        break;
      case "failed_login":
        subject = "Security Alert: Failed Login Attempts";
        break;
      default:
        subject = `Security Alert: ${alertType}`;
    }

    return await sendEmail({
      to,
      toName: name,
      templateId: config.brevo.templates.securityAlert,
      subject,
      params: {
        name,
        alert_type: alertType,
        ...details,
      },
      tags: ["security", "alert", alertType],
      requestId,
    });
  } catch (error) {
    logger.error("Security alert email error", {
      requestId,
      to,
      alertType,
      error: error.message,
    });
    return { success: false, error: error.message };
  }
};

/**
 * Send custom HTML email
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.htmlContent - HTML content of email
 * @param {string} options.toName - Recipient name
 * @param {Array} options.tags - Tags for tracking
 * @param {string} options.requestId - Request ID for tracking
 * @returns {Promise} - Send result
 */
const sendCustomEmail = async ({
  to,
  subject,
  htmlContent,
  toName,
  tags = ["custom"],
  requestId,
}) => {
  try {
    logger.debug("Preparing custom email", {
      requestId,
      to,
      subject,
    });

    if (!htmlContent) {
      logger.warn("Custom email missing HTML content", { requestId, to });
    }

    return await sendEmail({
      to,
      toName,
      subject,
      htmlContent,
      tags,
      requestId,
    });
  } catch (error) {
    logger.error("Custom email error", {
      requestId,
      to,
      error: error.message,
    });
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendEmailChangeVerification,
  sendSecurityAlert,
  sendCustomEmail,
  // Export all other email sending functions from the original file
  sendEmailChangeConfirmation: async ({ to, name, newEmail, requestId }) => {
    try {
      return await sendEmail({
        to,
        toName: name,
        templateId: config.brevo.templates.emailChangeConfirmation,
        params: {
          name,
          new_email: newEmail,
        },
        tags: ["email-change", "confirmation"],
        requestId,
      });
    } catch (error) {
      logger.error("Email change confirmation error", {
        requestId,
        to,
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  },

  sendEmailChangeRejection: async ({
    to,
    name,
    requestedEmail,
    rejectionReason,
    requestId,
  }) => {
    try {
      return await sendEmail({
        to,
        toName: name,
        templateId: config.brevo.templates.emailChangeRejection,
        params: {
          name,
          requested_email: requestedEmail,
          rejection_reason: rejectionReason,
        },
        tags: ["email-change", "rejection"],
        requestId,
      });
    } catch (error) {
      logger.error("Email change rejection error", {
        requestId,
        to,
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  },

  sendNameChangeConfirmation: async ({ to, name, previousName, requestId }) => {
    try {
      return await sendEmail({
        to,
        toName: name,
        templateId: config.brevo.templates.nameChangeConfirmation,
        params: {
          name,
          previous_name: previousName,
        },
        tags: ["name-change", "confirmation"],
        requestId,
      });
    } catch (error) {
      logger.error("Name change confirmation error", {
        requestId,
        to,
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  },

  sendNameChangeRejection: async ({
    to,
    name,
    requestedName,
    rejectionReason,
    requestId,
  }) => {
    try {
      return await sendEmail({
        to,
        toName: name,
        templateId: config.brevo.templates.nameChangeRejection,
        params: {
          name,
          requested_name: requestedName,
          rejection_reason: rejectionReason,
        },
        tags: ["name-change", "rejection"],
        requestId,
      });
    } catch (error) {
      logger.error("Name change rejection error", {
        requestId,
        to,
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  },

  sendAccountLockedNotification: async ({
    to,
    name,
    reason,
    supportEmail,
    requestId,
  }) => {
    try {
      return await sendEmail({
        to,
        toName: name,
        templateId: config.brevo.templates.accountLocked,
        params: {
          name,
          reason,
          support_email: supportEmail || config.supportEmail,
        },
        tags: ["account", "security", "locked"],
        requestId,
      });
    } catch (error) {
      logger.error("Account locked notification error", {
        requestId,
        to,
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  },
};
