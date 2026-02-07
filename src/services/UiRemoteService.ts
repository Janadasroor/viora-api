import { sError } from 'sk-logger';
import uiRemoteRepository from '../repositories/UiRemoteRepository.js';
class UiRemoteService {
    async example() {
        try {
        } catch (error) {
            sError(error);
        }
    }
}
export default new UiRemoteService();