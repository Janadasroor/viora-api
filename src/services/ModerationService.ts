import bindings from 'bindings';
import { sError } from 'sk-logger';

// Load the native addon
const addon = bindings('moderation_engine');

export interface ModerationResult {
    allowed: boolean;
    badWords?: string[];
}

class ModerationService {
    /**
     * Moderate text content using the C++ engine
     */
    moderateText(text: string): ModerationResult {
        try {
            return addon.moderateText(text);
        } catch (error) {
            sError('Error in native moderation:', error);
            // Fail open or closed? Let's fail open for now but log error
            return { allowed: true };
        }
    }
}

export default new ModerationService();
