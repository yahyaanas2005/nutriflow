const { Client } = require("pg");

module.exports = async (req, res) => {
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

    // Create profiles table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
      );
    `);

    // Create user logins tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.user_logins (
        id SERIAL PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
        login_time TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
      );
    `);

    // Create admin credentials table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.admins (
        username TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL
      );
    `);

    // Insert default admin user if not exists (username: admin, password: adminPassword123!)
    // Using simple SHA-256 or plain text for easy setup, let's use plain text or standard hash
    await client.query(`
      INSERT INTO public.admins (username, password_hash)
      VALUES ('admin', 'adminPassword123!')
      ON CONFLICT (username) DO NOTHING;
    `);

    await client.end();
    return res.status(200).json({ success: true, message: "Database initialized successfully" });
  } catch (error) {
    console.error("Database init error:", error);
    try { await client.end(); } catch (e) {}
    return res.status(500).json({ success: false, error: error.message });
  }
};
