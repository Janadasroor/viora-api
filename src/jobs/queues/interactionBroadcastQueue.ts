import { Queue } from 'bullmq';
import { redisConnection } from "../index.js";
const connection = redisConnection();

class InteractionBroadcastQueue {
    private queue: Queue;
    constructor() {
        this.queue = new Queue('interactionBroadcastQueue', { connection });
        this.setupRepeatingJobs();
    }

    getQueue() {
        return this.queue;
    }

    setupRepeatingJobs() {
        // Run every 2 seconds to broadcast aggregated updates
        this.queue.add(
            'aggregate-broadcasts',
            {},
            {
                repeat: {
                    every: 2000 // Run every 2 seconds
                },
                jobId: 'recurring-broadcast-aggregator'
            }
        );
    }
}

const interactionBroadcastQueue = new InteractionBroadcastQueue();
export default interactionBroadcastQueue;
