const { Client } = require("pg");
const crypto = require("crypto");
const welcomeEmail = require("./send-welcome-email");

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }

  const { email, password, name } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, error: "Email and password are required" });
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

    // 1. Check if user already exists
    const userResult = await client.query(`
      SELECT * FROM public.profiles WHERE LOWER(email) = LOWER($1);
    `, [email.trim()]);

    const hashedPassword = hashPassword(password);

    if (userResult.rows.length > 0) {
      // Returning user: verify password
      const user = userResult.rows[0];
      if (user.password_hash === hashedPassword || !user.password_hash) {
        // Password is correct, or user didn't have password set (set it now)
        if (!user.password_hash) {
          await client.query(`
            UPDATE public.profiles SET password_hash = $1 WHERE id = $2;
          `, [hashedPassword, user.id]);
        }

        // Insert login entry
        await client.query(`
          INSERT INTO public.user_logins (profile_id) VALUES ($1);
        `, [user.id]);

        await client.end();
        return res.status(200).json({
          success: true,
          user: { id: user.id, name: user.name, email: user.email, phone: user.phone, subscription_plan: user.subscription_plan }
        });
      } else {
        // Wrong password
        await client.end();
        return res.status(401).json({ success: false, error: "Incorrect password" });
      }
    } else {
      // New user: auto sign-up
      const userId = "u_" + crypto.randomBytes(16).toString("hex");
      const defaultName = name ? name.trim() : email.split("@")[0];
      const displayName = defaultName.charAt(0).toUpperCase() + defaultName.slice(1);

      await client.query(`
        INSERT INTO public.profiles (id, name, email, password_hash, subscription_plan)
        VALUES ($1, $2, $3, $4, 'trial');
      `, [userId, displayName, email.trim(), hashedPassword]);

      // Insert login entry
      await client.query(`
        INSERT INTO public.user_logins (profile_id) VALUES ($1);
      `, [userId]);

      await client.end();

      // Trigger welcome email asynchronously
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

      return res.status(200).json({
        success: true,
        user: { id: userId, name: displayName, email: email.trim(), phone: null, subscription_plan: "trial" }
      });
    }
  } catch (error) {
    console.error("Login/Signup error:", error);
    try { await client.end(); } catch (e) {}
    return res.status(500).json({ success: false, error: error.message });
  }
};
