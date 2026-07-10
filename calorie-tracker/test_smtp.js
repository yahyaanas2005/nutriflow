const nodemailer = require("nodemailer");

async function main() {
  const transporter = nodemailer.createTransport({
    host: "mail.ameenerp.khanwco.net",
    port: 587,
    secure: false, // STARTTLS
    auth: {
      user: "info@ameenerp.khanwco.net",
      pass: "AmeenMail2026!"
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  try {
    const info = await transporter.sendMail({
      from: '"Fuel & Fit Support" <support@fuelnfit.khanwco.net>',
      to: "9276242@gmail.com",
      subject: "Test Self-Hosted SMTP",
      text: "Testing self-hosted SMTP welcome email delivery."
    });
    console.log("Success! Message ID:", info.messageId);
  } catch (err) {
    console.error("Failed to send email:", err);
  }
}

main();
