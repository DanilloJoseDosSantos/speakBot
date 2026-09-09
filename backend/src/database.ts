import { Pool, type QueryResultRow } from "pg";

export const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/rh_central";

export const pool = new Pool({
  connectionString: DATABASE_URL,
});

export async function runQuery<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  return pool.query<T>(text, values);
}
