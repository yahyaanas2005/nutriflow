const { Client } = require("pg");
const crypto = require("crypto");
const welcomeEmail = require("./send-welcome-email");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }

  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ success: false, error: "Email and code are required" });
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

    // 1. Check if OTP is valid and not expired
    const otpResult = await client.query(`
      SELECT * FROM public.user_otps 
      WHERE LOWER(email) = LOWER($1) AND otp_code = $2 AND expires_at > timezone('utc'::text, now())
      ORDER BY created_at DESC 
      LIMIT 1;
    `, [email.trim(), otp.trim()]);

    if (otpResult.rows.length === 0) {
      await client.end();
      return res.status(401).json({ success: false, error: "Invalid or expired verification code" });
    }

    // OTP is valid! Delete it so it cannot be reused
    await client.query(`
      DELETE FROM public.user_otps WHERE email = $1;
    `, [email.trim()]);

    // 2. Fetch or create user profile
    const userResult = await client.query(`
      SELECT * FROM public.profiles WHERE LOWER(email) = LOWER($1);
    `, [email.trim()]);

    let user;

    if (userResult.rows.length > 0) {
      user = userResult.rows[0];
    } else {
      // Create user if not exists (e.g. magic link signup)
      const userId = "u_" + crypto.randomBytes(16).toString("hex");
      const defaultName = email.split("@")[0];
      const displayName = defaultName.charAt(0).toUpperCase() + defaultName.slice(1);

      await client.query(`
        INSERT INTO public.profiles (id, name, email, subscription_plan)
        VALUES ($1, $2, $3, 'trial');
      `, [userId, displayName, email.trim()]);

      user = { id: userId, name: displayName, email: email.trim(), phone: null, subscription_plan: "trial" };

      // Trigger welcome email
      try {
        const mockReq = {
          method: "POST",
          body: { name: displayName, email: email.trim() }
        };
        const mockRes = {
          status: () => ({ json: () => {} })
        };
        welcomeEmail(mockReq, mockRes).catch(err => console.error("Welcome email error:", err));
      } catch (e) {
        console.error("Failed to trigger welcome email:", e);
      }
    }

    // Insert login entry
    await client.query(`
      INSERT INTO public.user_logins (profile_id) VALUES ($1);
    `, [user.id]);

    await client.end();
    return res.status(200).json({ success: true, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, subscription_plan: user.subscription_plan } });
  } catch (error) {
    console.error("OTP verification error:", error);
    try { await client.end(); } catch (e) {}
    return res.status(500).json({ success: false, error: error.message });
  }
};
