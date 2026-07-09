const { Client } = require("pg");
const { verifyToken } = require("./admin-verify");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }

  const { token, userId } = req.body;
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ success: false, error: "Unauthorized — invalid or expired token" });
  }

  if (!userId) {
    return res.status(400).json({ success: false, error: "userId is required" });
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

    // Delete user logins first (foreign key), then the profile
    await client.query(`DELETE FROM public.user_logins WHERE profile_id = $1;`, [userId]);
    const result = await client.query(`DELETE FROM public.profiles WHERE id = $1 RETURNING id, name;`, [userId]);

    await client.end();

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    return res.status(200).json({ success: true, deleted: result.rows[0] });
  } catch (error) {
    console.error("Admin delete user error:", error);
    try { await client.end(); } catch (e) {}
    return res.status(500).json({ success: false, error: error.message });
  }
};
