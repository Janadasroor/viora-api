import { sError } from "sk-logger";
import uiRemoteService from "../services/UiRemoteService.js";
class UiRemoteController {
    async example(req: Response, res: Request) {
        try {
            
        } catch (error) {
            sError(error);
        }
    }
}

export default new UiRemoteController();