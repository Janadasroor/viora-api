import mediaQueue from '../jobs/queues/mediaQueue.js';
import type { MediaRequest } from '@types';
import { sError } from 'sk-logger';
class MediaService {
    async uploadAndProcessImages(mediaRequest: MediaRequest) {
        try {
            mediaQueue.add(mediaRequest);
        }
        catch (err) {
            sError(err);
            throw new Error("Error in uploading and processing images");
        }
    }
    async uploadAndProcessVideos(mediaRequest: MediaRequest) {
        try {
            mediaQueue.add(mediaRequest);
        }
        catch (err) {
            sError(err);
            throw new Error("Error in uploading and processing video");
        }
    }
}

// Export a singleton instance
export default new MediaService();
