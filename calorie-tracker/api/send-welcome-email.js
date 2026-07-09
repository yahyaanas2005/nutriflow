const nodemailer = require("nodemailer");

module.exports = async (req, res) => {
  // Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }

  const { name, email } = req.body;

  if (!name || !email) {
    return res.status(400).json({ success: false, error: "Name and email are required" });
  }

  try {
    let transporter;
    let fromSender = process.env.SMTP_FROM || '"NutriFlow Team" <welcome@nutriflow-app.com>';

    // Use environment variables if configured
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || "587"),
        secure: process.env.SMTP_SECURE === "true",
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    } else {
      // Fallback to the pre-configured Gmail SMTP account for seamless zero-config delivery
      transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
          user: "nutritionflowai@gmail.com",
          pass: "hufpyqbtfhluqdek",
        },
      });
      fromSender = '"NutriFlow Team" <nutritionflowai@gmail.com>';
    }

    // Beautifully crafted premium HTML welcome email
    const mailOptions = {
      from: fromSender,
      to: email,
      subject: "\ud83c\udf0a Welcome to NutriFlow, " + name + "!",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Welcome to NutriFlow</title>
          <style>
            body {
              background-color: #0c0a1c;
              margin: 0;
              padding: 0;
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              color: #ffffff;
            }
            .email-wrapper {
              width: 100%;
              background-color: #0c0a1c;
              padding: 40px 0;
            }
            .email-container {
              max-width: 600px;
              margin: 0 auto;
              background-color: #161330;
              border: 1px solid rgba(108, 99, 255, 0.2);
              border-radius: 12px;
              overflow: hidden;
              box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
            }
            .email-header {
              background: linear-gradient(135deg, #161330 0%, #0c0a1c 100%);
              border-bottom: 1px solid rgba(108, 99, 255, 0.1);
              padding: 30px;
              text-align: center;
            }
            .brand-logo {
              font-size: 2.2rem;
              line-height: 1;
              margin-bottom: 10px;
            }
            .brand-name {
              font-size: 1.6rem;
              font-weight: 800;
              color: #6C63FF;
              letter-spacing: -0.02em;
            }
            .email-body {
              padding: 40px 30px;
            }
            .greeting {
              font-size: 1.4rem;
              font-weight: 700;
              margin-top: 0;
              margin-bottom: 20px;
              color: #ffffff;
            }
            .intro-text {
              font-size: 1rem;
              line-height: 1.6;
              color: #a09ec0;
              margin-bottom: 30px;
            }
            .features-grid {
              margin-bottom: 30px;
            }
            .feature-item {
              display: flex;
              align-items: center;
              margin-bottom: 16px;
            }
            .feature-icon {
              font-size: 1.5rem;
              margin-right: 14px;
              flex-shrink: 0;
            }
            .feature-text {
              font-size: 0.95rem;
              font-weight: 500;
              color: #ffffff;
            }
            .cta-button {
              display: inline-block;
              background-color: #6C63FF;
              color: #ffffff !important;
              text-decoration: none;
              font-size: 1rem;
              font-weight: 700;
              padding: 14px 28px;
              border-radius: 8px;
              text-align: center;
              box-shadow: 0 4px 15px rgba(108, 99, 255, 0.4);
              margin: 20px 0;
              transition: all 0.2s ease;
            }
            .email-footer {
              background-color: #0c0a1c;
              border-top: 1px solid rgba(108, 99, 255, 0.1);
              padding: 24px;
              text-align: center;
              font-size: 0.8rem;
              color: #5d5a80;
            }
            .email-footer a {
              color: #6C63FF;
              text-decoration: none;
            }
          </style>
        </head>
        <body>
          <div class="email-wrapper">
            <div class="email-container">
              <div class="email-header">
                <div class="brand-logo">\ud83c\udf0a</div>
                <div class="brand-name">NutriFlow</div>
              </div>
              <div class="email-body">
                <h2 class="greeting">Hi ${name}, welcome aboard! \ud83d\udc4b</h2>
                <p class="intro-text">
                  Thank you for joining NutriFlow. You've taken the first step toward smart, data-driven nutrition tracking. Here's a quick look at the features waiting for you in your dashboard:
                </p>
                <div class="features-grid">
                  <div class="feature-item">
                    <span class="feature-icon">\ud83d\udcca</span>
                    <span class="feature-text">Dynamic calorie & macro ring target tracking</span>
                  </div>
                  <div class="feature-item">
                    <span class="feature-icon">\u23f1\ufe0f</span>
                    <span class="feature-text">Autophagy-based intermittent fasting timers</span>
                  </div>
                  <div class="feature-item">
                    <span class="feature-icon">\ud83e\udd16</span>
                    <span class="feature-text">Personalized AI Insights based on your logs</span>
                  </div>
                  <div class="feature-item">
                    <span class="feature-icon">\ud83d\udcd6</span>
                    <span class="feature-text">Interactive ingredient & custom recipe builder</span>
                  </div>
                </div>
                <div style="text-align: center;">
                  <a href="https://nutriflow-calorie-tracker.vercel.app/" class="cta-button">Open Your Dashboard</a>
                </div>
                <p class="intro-text" style="margin-top: 30px; margin-bottom: 0;">
                  If you have any questions or feedback, simply hit reply to this email. We're here to help!
                </p>
              </div>
              <div class="email-footer">
                \u00a9 ${new Date().getFullYear()} NutriFlow Calorie Tracker. All rights reserved.<br>
                Made with \ud83d\udc9a by <a href="https://github.com/yahyaanas2005" target="_blank">Yahya Anas</a>.
              </div>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    // Send the email
    await transporter.sendMail(mailOptions);

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error sending welcome email:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
