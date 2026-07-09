const { Client } = require("pg");
const { verifyToken } = require("./admin-verify");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }

  const { token, userId, plan } = req.body;
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ success: false, error: "Unauthorized — invalid or expired token" });
  }

  if (!userId || !plan) {
    return res.status(400).json({ success: false, error: "userId and plan are required" });
  }

  const validPlans = ["trial", "pro", "premium"];
  if (!validPlans.includes(plan)) {
    return res.status(400).json({ success: false, error: "Invalid plan. Must be: trial, pro, or premium" });
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

    const result = await client.query(
      `UPDATE public.profiles SET subscription_plan = $1 WHERE id = $2 RETURNING id, name, subscription_plan;`,
      [plan, userId]
    );

    await client.end();

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    return res.status(200).json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error("Admin update user error:", error);
    try { await client.end(); } catch (e) {}
    return res.status(500).json({ success: false, error: error.message });
  }
};
