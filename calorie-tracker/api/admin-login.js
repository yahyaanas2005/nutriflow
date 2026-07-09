const { Client } = require("pg");
const crypto = require("crypto");

const ADMIN_SECRET = process.env.ADMIN_SECRET || "nf_admin_secret_key_2026_x9k7";

function createToken(username) {
  const payload = {
    sub: username,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (2 * 60 * 60) // 2 hours
  };
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", ADMIN_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const expectedSig = crypto.createHmac("sha256", ADMIN_SECRET).update(`${header}.${body}`).digest("base64url");
    if (signature !== expectedSig) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }

  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, error: "Username and password are required" });
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
      SELECT * FROM public.admins WHERE username = $1 AND password_hash = $2;
    `, [username.trim(), password.trim()]);

    await client.end();

    if (result.rows.length > 0) {
      const token = createToken(username.trim());
      return res.status(200).json({ success: true, token });
    } else {
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }
  } catch (error) {
    console.error("Admin login error:", error);
    try { await client.end(); } catch (e) {}
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Export verifyToken for other admin endpoints
module.exports.verifyToken = verifyToken;
