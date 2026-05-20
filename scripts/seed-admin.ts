/**
 * Creates or updates the admin account.
 * Usage: DATABASE_URL=... JWT_SECRET=... tsx scripts/seed-admin.ts
 * On Render: run from the Shell tab in the dashboard.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { users } from "../drizzle/schema";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL is required");
  process.exit(1);
}

const ADMIN_EMAIL = "mycab.officiel@gmail.com";
const ADMIN_PASSWORD = "123456789!";
const ADMIN_NAME = "Admin";

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const db = drizzle(pool);

async function run() {
  console.log("🔑 Hashing password…");
  const passwordHash = hashPassword(ADMIN_PASSWORD);
  const adminOpenId = `local:${ADMIN_EMAIL}`;

  const existing = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);

  if (existing[0]) {
    console.log(`👤 User found (id=${existing[0].id}), updating role to ultra…`);
    await db.update(users)
      .set({
        openId: adminOpenId,
        role: "ultra",
        plan: "agency",
        generationsLimit: 9999,
        passwordHash,
        onboardingDone: true,
        loginMethod: "email",
      })
      .where(eq(users.email, ADMIN_EMAIL));
    console.log("✅ Admin account updated.");
  } else {
    console.log("➕ Creating new admin account…");
    await db.insert(users).values({
      openId: adminOpenId,
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      loginMethod: "email",
      role: "ultra",
      plan: "agency",
      generationsLimit: 9999,
      passwordHash,
      onboardingDone: true,
    });
    console.log("✅ Admin account created.");
  }

  console.log(`📧 Email: ${ADMIN_EMAIL}`);
  console.log(`🔒 Password: ${ADMIN_PASSWORD}`);
  console.log(`👑 Role: ultra`);

  await pool.end();
}

run().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
