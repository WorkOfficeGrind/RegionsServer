const nodemailer = require("nodemailer");

async function generateEtherealCredentials() {
  // Generate test SMTP service account
  const testAccount = await nodemailer.createTestAccount();

  console.log("Ethereal Email Credentials:");
  console.log("Email:", testAccount.user);
  console.log("Password:", testAccount.pass);
  console.log("SMTP Host:", "smtp.ethereal.email");
  console.log("SMTP Port:", 587);
}

module.exports = { generateEtherealCredentials };
