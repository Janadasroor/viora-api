import { pool } from "../config/pg.config.js";

export interface FeedConfig {
  key: string;
  value: string;
}

class FeedConfigRepository {
  async getAll(): Promise<Record<string, string | number>> {
    const result = await pool.query("SELECT key, value FROM feed_config");
    return result.rows.reduce<Record<string, string | number>>((acc, row) => {
      acc[row.key] = isNaN(Number(row.value)) ? row.value : parseFloat(row.value);
      return acc;
    }, {});
  }

  async update(key: string, value: string): Promise<FeedConfig | undefined> {
    const result = await pool.query<FeedConfig>(
      `UPDATE feed_config SET value = $1, updated_at = NOW() WHERE key = $2 RETURNING *`,
      [value, key]
    );
    return result.rows[0];
  }
}

export default new FeedConfigRepository();
