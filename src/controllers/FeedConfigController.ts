// src/controllers/FeedConfigController.ts
import type { Request, Response } from "express";
import feedConfigService from "../services/FeedConfigService.js";
import { sError } from "sk-logger";

export const updateConfig = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { key, value } = req.body as { key: string; value: any };
    const updated = await feedConfigService.update(key, value);
    return res.json({ success: true, updated });
  } catch (err) {
    sError(err);
    return res.status(500).json({ error: "Failed to update config" });
  }
};

export const getAll = async (req: Request, res: Response): Promise<Response> => {
  try {
    const config = await feedConfigService.getAll();
    return res.json({ success: true, config });
  } catch (err) {
    sError(err);
    return res.status(500).json({ error: "Failed to get config" });
  }
};
