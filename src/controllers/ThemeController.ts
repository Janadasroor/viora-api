
// controllers/ThemeController.ts
import type { Request, Response } from "express";
import themeService from "../services/ThemeService.js";
import { sError } from "sk-logger";

class ThemeController {
  async getAllThemes(req: Request, res: Response): Promise<Response | void> {
    try {
      const themes = await themeService.getAllThemes();
      return res.status(200).json({ success: true, data: themes });
    } catch (error) {
      sError("Error fetching themes:", error);

      return res.status(500).json({
        success: false,
        message: "Internal server error"
      });
    }
  }
}

export default new ThemeController();