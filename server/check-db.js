import { initDb, pool } from "./db.js";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

try {
  await initDb();
  const result = await pool.query("SELECT now() AS now");
  console.log(`Postgres connection OK: ${result.rows[0].now.toISOString()}`);
  await pool.end();
} catch (error) {
  console.error("Postgres connection failed.");
  console.error(error.message);
  process.exit(1);
}
