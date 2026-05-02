import mysql2 from "mysql2/promise";
import crypto from "crypto";

const ENCRYPTION_KEY = process.env.JWT_SECRET?.slice(0, 32).padEnd(32, "0") || "maria-default-key-32-chars-long!";

console.log("=== Maria API Key Debug ===");
console.log("JWT_SECRET exists:", !!process.env.JWT_SECRET);
console.log("JWT_SECRET length:", process.env.JWT_SECRET?.length || 0);
console.log("Encryption key (first 8):", ENCRYPTION_KEY.substring(0, 8) + "...");

function decrypt(encryptedText) {
  const colonIdx = encryptedText.indexOf(":");
  if (colonIdx === -1) throw new Error("Invalid encrypted format - missing colon separator");
  const ivHex = encryptedText.substring(0, colonIdx);
  const encrypted = encryptedText.substring(colonIdx + 1);
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY), iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

const conn = await mysql2.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.execute("SELECT encryptedKey, model, status FROM api_keys WHERE userId = 1 LIMIT 1");

if (!rows[0]) {
  console.log("❌ No API key found in DB");
  await conn.end();
  process.exit(1);
}

console.log("\n=== DB Key Info ===");
console.log("Status in DB:", rows[0].status);
console.log("Model:", rows[0].model);
console.log("Encrypted key length:", rows[0].encryptedKey.length);

let decryptedKey;
try {
  decryptedKey = decrypt(rows[0].encryptedKey);
  console.log("\n✅ Decryption SUCCESS");
  console.log("Key starts with:", decryptedKey.substring(0, 15) + "...");
  console.log("Key length:", decryptedKey.length);
  console.log("Starts with sk-ant-:", decryptedKey.startsWith("sk-ant-"));
} catch (e) {
  console.error("\n❌ Decryption FAILED:", e.message);
  await conn.end();
  process.exit(1);
}

console.log("\n=== Testing Anthropic API ===");
try {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": decryptedKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: rows[0].model,
      max_tokens: 10,
      messages: [{ role: "user", content: "Hi" }],
    }),
  });

  const responseText = await response.text();
  console.log("HTTP Status:", response.status, response.statusText);
  
  if (response.ok) {
    console.log("✅ API call SUCCESS - Key is valid!");
  } else {
    console.log("❌ API call FAILED");
    try {
      const errJson = JSON.parse(responseText);
      console.log("Error type:", errJson.error?.type);
      console.log("Error message:", errJson.error?.message);
    } catch {
      console.log("Response body:", responseText.substring(0, 200));
    }
  }
} catch (e) {
  console.error("❌ Network error:", e.message);
}

await conn.end();
