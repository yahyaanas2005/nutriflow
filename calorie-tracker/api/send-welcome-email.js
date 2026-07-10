const { sendMail } = require("./smtp-helper");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }

  const { name, email } = req.body;

  if (!name || !email) {
    return res.status(400).json({ success: false, error: "Name and email are required" });
  }

  try {
    const subject = `🌊 Welcome to Fuel & Fit, ${name}!`;
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to Fuel & Fit</title>
        <style>
          body {
            background-color: #0c0a1c;
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
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
          }
          .email-body {
            padding: 40px 30px;
          }
          .greeting {
            font-size: 1.4rem;
            font-weight: 700;
            margin-top: 0;
            color: #ffffff;
          }
          .intro-text {
            font-size: 1rem;
            line-height: 1.6;
            color: #a09ec0;
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
            margin: 20px 0;
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
              <div class="brand-logo">🌊</div>
              <div class="brand-name">Fuel & Fit</div>
            </div>
            <div class="email-body">
              <h2 class="greeting">Hi ${name}, welcome aboard! 👋</h2>
              <p class="intro-text">
                Thank you for joining Fuel & Fit. You've taken the first step toward smart, data-driven nutrition tracking. Your account is ready.
              </p>
              <div style="text-align: center;">
                <a href="https://fuelnfit.khanwco.net/" class="cta-button">Open Your Dashboard</a>
              </div>
            </div>
            <div class="email-footer">
              &copy; ${new Date().getFullYear()} Fuel & Fit. All rights reserved.
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    await sendMail({
      from: '"Fuel & Fit Welcome" <info@fuelnfit.khanwco.net>',
      to: email,
      subject,
      html
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error sending welcome email:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
