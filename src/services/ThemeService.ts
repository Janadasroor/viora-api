
// services/ThemeService.ts
import { sError } from "sk-logger";
import themeRepository from "../repositories/ThemeRepository.js";
import type { Theme } from "@types";

class ThemeService {
  async getAllThemes(): Promise<Theme[]> {
    try {
      const themes = await themeRepository.getAllThemes();
      if (!themes || themes.length === 0) {
        return [];
      }
      // Normalize boolean values
      const fixed = themes.map(t => ({
        ...t,
        isDarkTheme: !!t.isDarkTheme
      }));
      return fixed;
    } catch (error) {
      sError(error);
      throw new Error((error as Error).message);
    }
  }
}

export default new ThemeService();
