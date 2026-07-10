const { Client } = require("pg");
const { sendMail } = require("./smtp-helper");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }

  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, error: "Email is required" });
  }

  const client = new Client({
    host: "aws-1-ap-southeast-1.pooler.supabase.com",
    database: "postgres",
    user: "postgres.uyfblbwvvgsnplkujfem",
    password: "NutriFlowSecurePass123!",
    port: 6543,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    // 1. Generate 6-digit OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins expiry

    // Save to user_otps
    await client.query(`
      INSERT INTO public.user_otps (email, otp_code, expires_at)
      VALUES ($1, $2, $3);
    `, [email.trim(), otpCode, expiresAt]);

    await client.end();

    // 2. Format emails and magic link
    const magicLink = `https://fuelnfit.khanwco.net/?otp=${otpCode}&email=${encodeURIComponent(email.trim())}`;
    const subject = `🔑 One-Time Login Code: ${otpCode}`;
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>One-Time Login Code</title>
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
          .otp-code {
            display: inline-block;
            font-size: 2.4rem;
            font-weight: 800;
            letter-spacing: 6px;
            color: #6C63FF;
            background-color: #0c0a1c;
            padding: 10px 30px;
            border-radius: 8px;
            border: 1px solid rgba(108, 99, 255, 0.2);
            margin: 20px 0;
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
        </style>
      </head>
      <body>
        <div class="email-wrapper">
          <div class="email-container">
            <div class="email-header">
              <div class="brand-logo">🌊</div>
              <div class="brand-name">Fuel & Fit</div>
            </div>
            <div class="email-body" style="text-align: center;">
              <h2 class="greeting">Access Your Account</h2>
              <p class="intro-text">
                Here is your one-time verification code to log in to Fuel & Fit:
              </p>
              <div class="otp-code">${otpCode}</div>
              <p class="intro-text">
                Or, click the link below to sign in automatically:
              </p>
              <a href="${magicLink}" class="cta-button">Sign In Instantly</a>
              <p class="intro-text" style="font-size: 0.85rem; color: #5d5a80; margin-top: 20px;">
                This link and code will expire in 15 minutes. If you did not request this, please ignore this email.
              </p>
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
      from: '"Fuel & Fit Support" <support@fuelnfit.khanwco.net>',
      to: email.trim(),
      subject,
      html
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("OTP send error:", error);
    try { await client.end(); } catch (e) {}
    return res.status(500).json({ success: false, error: error.message });
  }
};
