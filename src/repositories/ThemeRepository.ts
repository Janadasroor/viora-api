// repositories/ThemeRepository.ts
import { sDebug } from "sk-logger";
import { pool } from "../config/pg.config.js";
import type { Theme } from "@types";


class ThemeRepository {
  async getAllThemes(): Promise<Theme[]> {
    try {
      const rows = await pool.query("SELECT * FROM themes");
      return rows.rows[0] as Theme[];
    } catch (error) {
      sDebug(error);
      throw new Error((error as Error).message);
    }
  }
}

export default new ThemeRepository();