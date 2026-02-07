import e from "express";

import { pool } from "../config/pg.config.js";
import { sError } from "sk-logger";

class UiRemoteRepository {
    async example() {
        try {
        } catch (error) {
            sError(error);
        }
    }
}

export default new UiRemoteRepository();