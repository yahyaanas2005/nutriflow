const { Client } = require("pg");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }

  const { id, name, email, phone } = req.body;

  if (!id || !name || !email) {
    return res.status(400).json({ success: false, error: "ID, name, and email are required" });
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

    // 1. Upsert profile
    await client.query(`
      INSERT INTO public.profiles (id, name, email, phone)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name, email = EXCLUDED.email, phone = EXCLUDED.phone;
    `, [id, name, email, phone || null]);

    // 2. Insert login entry
    await client.query(`
      INSERT INTO public.user_logins (profile_id)
      VALUES ($1);
    `, [id]);

    await client.end();
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error logging user login:", error);
    try { await client.end(); } catch (e) {}
    return res.status(500).json({ success: false, error: error.message });
  }
};
