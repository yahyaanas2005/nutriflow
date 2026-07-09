const { Client } = require("pg");
const { verifyToken } = require("./admin-verify");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }

  const { token } = req.body;
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ success: false, error: "Unauthorized — invalid or expired token" });
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

    const result = await client.query(`
      SELECT 
        p.id, 
        p.name, 
        p.email, 
        p.phone, 
        p.created_at, 
        COALESCE(p.subscription_plan, 'trial') AS subscription_plan,
        COUNT(l.id) AS login_count, 
        MAX(l.login_time) AS last_login
      FROM public.profiles p
      LEFT JOIN public.user_logins l ON p.id = l.profile_id
      GROUP BY p.id, p.name, p.email, p.phone, p.created_at, p.subscription_plan
      ORDER BY last_login DESC NULLS LAST;
    `);

    await client.end();
    return res.status(200).json({ success: true, users: result.rows });
  } catch (error) {
    console.error("Admin retrieve users error:", error);
    try { await client.end(); } catch (e) {}
    return res.status(500).json({ success: false, error: error.message });
  }
};
