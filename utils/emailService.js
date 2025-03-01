const nodemailer = require("nodemailer");
const logger = require("./logger");

// Create transporter based on environment
const createTransporter = () => {
  if (process.env.NODE_ENV === "production") {
    // Production email service (e.g., SendGrid, AWS SES)
    return nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });
  } else {
    // Development email service (e.g., Ethereal or local SMTP)
    return nodemailer.createTransport({
      host: process.env.DEV_EMAIL_HOST || "smtp.ethereal.email",
      port: process.env.DEV_EMAIL_PORT || 587,
      secure: false,
      auth: {
        user: process.env.DEV_EMAIL_USER,
        pass: process.env.DEV_EMAIL_PASS,
      },
    });
  }
};

// Template for verification emails (account updates, password changes, etc.)
const generateVerificationEmailTemplate = (token, fields) => {
  const fieldsList = fields.join(" and ");
  const verificationLink = `${process.env.FRONTEND_URL}/verify-updates?token=${token}`;

  return {
    subject: "Verify Your Regions Account Updates",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #1a365d; padding: 20px; text-align: center;">
          <img src="regions-logo.png" alt="Regions Bank" style="max-width: 150px;">
        </div>
        
        <div style="padding: 20px; background-color: #ffffff;">
          <h2 style="color: #1a365d;">Verify Your Account Updates</h2>
          
          <p>You recently requested to update your ${fieldsList}. To complete this process, please verify these changes by clicking the button below:</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verificationLink}" 
               style="background-color: #1a365d; 
                      color: white; 
                      padding: 12px 30px; 
                      text-decoration: none; 
                      border-radius: 5px; 
                      display: inline-block;">
              Verify Updates
            </a>
          </div>
          
          <p>This link will expire in 30 minutes for your security.</p>
          
          <p>If you didn't request these changes, please contact our support team immediately.</p>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
            <p style="font-size: 12px; color: #666;">
              This is an automated message, please do not reply to this email. 
              For support, visit our help center or contact us at support@regions.com
            </p>
          </div>
        </div>
      </div>
    `,
    text: `
      Verify Your Regions Account Updates

      You recently requested to update your ${fieldsList}. 
      
      To verify these changes, please visit the following link:
      ${verificationLink}
      
      This link will expire in 30 minutes for your security.
      
      If you didn't request these changes, please contact our support team immediately.
      
      For support, visit our help center or contact us at support@regions.com
    `,
  };
};

// Template for PIN reset request emails
const generatePinResetEmailTemplate = (token) => {
  const resetLink = `${process.env.FRONTEND_URL}/reset-pin?token=${token}`;

  return {
    subject: "Reset Your Regions Banking PIN",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #1a365d; padding: 20px; text-align: center;">
          <img src="regions-logo.png" alt="Regions Bank" style="max-width: 150px;">
        </div>
        
        <div style="padding: 20px; background-color: #ffffff;">
          <h2 style="color: #1a365d;">Reset Your Banking PIN</h2>
          
          <p>You recently requested to reset your banking PIN. To proceed with this reset, please click the button below:</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetLink}" 
               style="background-color: #1a365d; 
                      color: white; 
                      padding: 12px 30px; 
                      text-decoration: none; 
                      border-radius: 5px; 
                      display: inline-block;">
              Reset PIN
            </a>
          </div>
          
          <p>This link will expire in 30 minutes for your security.</p>
          
          <p>If you didn't request this PIN reset, please contact our support team immediately as someone may be attempting to access your account.</p>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
            <p style="font-size: 12px; color: #666;">
              This is an automated message, please do not reply to this email. 
              For support, visit our help center or contact us at support@regions.com
            </p>
          </div>
        </div>
      </div>
    `,
    text: `
      Reset Your Regions Banking PIN

      You recently requested to reset your banking PIN. 
      
      To reset your PIN, please visit the following link:
      ${resetLink}
      
      This link will expire in 30 minutes for your security.
      
      If you didn't request this PIN reset, please contact our support team immediately as someone may be attempting to access your account.
      
      For support, visit our help center or contact us at support@regions.com
    `,
  };
};

// Template for temporary PIN emails (admin reset)
const generateTempPinEmailTemplate = (tempPin) => {
  const loginLink = `${process.env.FRONTEND_URL}/login`;

  return {
    subject: "Your Temporary Banking PIN",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #1a365d; padding: 20px; text-align: center;">
          <img src="regions-logo.png" alt="Regions Bank" style="max-width: 150px;">
        </div>
        
        <div style="padding: 20px; background-color: #ffffff;">
          <h2 style="color: #1a365d;">Your Temporary Banking PIN</h2>
          
          <p>A temporary PIN has been generated for your account by an administrator.</p>
          
          <div style="text-align: center; margin: 30px 0; padding: 15px; background-color: #f0f0f0; border-radius: 5px;">
            <p style="font-size: 24px; font-weight: bold; margin: 0; letter-spacing: 5px;">${tempPin}</p>
          </div>
          
          <p><strong>Important:</strong> You will be required to change this PIN on your next login.</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${loginLink}" 
               style="background-color: #1a365d; 
                      color: white; 
                      padding: 12px 30px; 
                      text-decoration: none; 
                      border-radius: 5px; 
                      display: inline-block;">
              Login to Your Account
            </a>
          </div>
          
          <p>For security reasons, please change this temporary PIN immediately.</p>
          
          <p>If you didn't expect this PIN reset, please contact our support team immediately.</p>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
            <p style="font-size: 12px; color: #666;">
              This is an automated message, please do not reply to this email. 
              For support, visit our help center or contact us at support@regions.com
            </p>
          </div>
        </div>
      </div>
    `,
    text: `
      Your Temporary Banking PIN

      A temporary PIN has been generated for your account by an administrator.
      
      Your temporary PIN: ${tempPin}
      
      Important: You will be required to change this PIN on your next login.
      
      Login to your account: ${loginLink}
      
      For security reasons, please change this temporary PIN immediately.
      
      If you didn't expect this PIN reset, please contact our support team immediately.
      
      For support, visit our help center or contact us at support@regions.com
    `,
  };
};

// Send verification email for account updates
const sendVerificationEmail = async (email, token, fields) => {
  try {
    const transporter = createTransporter();
    const template = generateVerificationEmailTemplate(token, fields);

    const mailOptions = {
      from: process.env.EMAIL_FROM || '"Regions Bank" <noreply@regions.com>',
      to: email,
      subject: template.subject,
      html: template.html,
      text: template.text,
    };

    const info = await transporter.sendMail(mailOptions);

    logger.info("Verification email sent successfully", {
      messageId: info.messageId,
      recipient: email,
      fields,
      requestId: global.requestId,
    });

    // For development environment, log the test URL
    if (process.env.NODE_ENV !== "production" && info.testMessageUrl) {
      logger.info("Preview URL:", {
        url: info.testMessageUrl,
        recipient: email,
      });
    }

    return info;
  } catch (error) {
    logger.error("Error sending verification email:", {
      error: error.message,
      stack: error.stack,
      recipient: email,
      fields,
      requestId: global.requestId,
    });
    throw new Error("Failed to send verification email");
  }
};

// Send PIN reset email
const sendPinResetEmail = async (email, token, tempPin = null) => {
  try {
    const transporter = createTransporter();

    // Use appropriate template based on whether we're sending a reset link or temp PIN
    const template = tempPin
      ? generateTempPinEmailTemplate(tempPin)
      : generatePinResetEmailTemplate(token);

    const mailOptions = {
      from: process.env.EMAIL_FROM || '"Regions Bank" <noreply@regions.com>',
      to: email,
      subject: template.subject,
      html: template.html,
      text: template.text,
    };

    const info = await transporter.sendMail(mailOptions);

    logger.info(
      `${tempPin ? "Temporary PIN" : "PIN reset"} email sent successfully`,
      {
        messageId: info.messageId,
        recipient: email,
        isTemporaryPin: !!tempPin,
        requestId: global.requestId,
      }
    );

    // For development environment, log the test URL
    if (process.env.NODE_ENV !== "production" && info.testMessageUrl) {
      logger.info("Preview URL:", {
        url: info.testMessageUrl,
        recipient: email,
      });
    }

    return info;
  } catch (error) {
    logger.error(
      `Error sending ${tempPin ? "temporary PIN" : "PIN reset"} email:`,
      {
        error: error.message,
        stack: error.stack,
        recipient: email,
        isTemporaryPin: !!tempPin,
        requestId: global.requestId,
      }
    );
    throw new Error(
      `Failed to send ${tempPin ? "temporary PIN" : "PIN reset"} email`
    );
  }
};

// Utility function to create test SMTP account (useful for development)
const createTestAccount = async () => {
  try {
    const testAccount = await nodemailer.createTestAccount();
    logger.info("Test SMTP account created:", {
      user: testAccount.user,
      pass: testAccount.pass,
    });
    return testAccount;
  } catch (error) {
    logger.error("Error creating test account:", error);
    throw error;
  }
};

module.exports = {
  sendVerificationEmail,
  sendPinResetEmail,
  createTestAccount,
};
