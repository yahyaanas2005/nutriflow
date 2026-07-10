const { Client } = require("pg");
const { verifyToken } = require("./admin-verify");

module.exports = async (req, res) => {
  // Require admin token for DB initialization
  if (req.method === "POST") {
    const { token } = req.body;
    const payload = verifyToken(token);
    if (!payload) {
      return res.status(401).json({ success: false, error: "Unauthorized — admin token required" });
    }
  } else if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
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

    // Create profiles table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        password_hash TEXT,
        subscription_plan TEXT DEFAULT 'trial',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
      );
    `);

    // Add columns if they don't exist (migrations)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'subscription_plan'
        ) THEN
          ALTER TABLE public.profiles ADD COLUMN subscription_plan TEXT DEFAULT 'trial';
        END IF;
        
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'password_hash'
        ) THEN
          ALTER TABLE public.profiles ADD COLUMN password_hash TEXT;
        END IF;
      END $$;
    `);

    // Create user logins tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.user_logins (
        id SERIAL PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
        login_time TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
      );
    `);

    // Create OTP codes table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.user_otps (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        otp_code TEXT NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
      );
    `);

    // Create admin credentials table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.admins (
        username TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL
      );
    `);

    // Insert default admin user if not exists
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
