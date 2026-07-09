const crypto = require("crypto");

const ADMIN_SECRET = process.env.ADMIN_SECRET || "nf_admin_secret_key_2026_x9k7";

function verifyToken(token) {
  try {
    if (!token) return null;
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

  const { token } = req.body;
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ success: false, error: "Invalid or expired token" });
  }

  return res.status(200).json({ success: true, username: payload.sub, expiresAt: payload.exp });
};

module.exports.verifyToken = verifyToken;
