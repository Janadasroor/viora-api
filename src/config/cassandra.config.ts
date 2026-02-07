import cassandra from 'cassandra-driver';
import { sError, sInfo } from 'sk-logger';

const contactPoints = process.env.CASSANDRA_CONTACT_POINTS ? process.env.CASSANDRA_CONTACT_POINTS.split(',') : ['localhost'];
const localDataCenter = process.env.CASSANDRA_DC || 'datacenter1';
const keyspace = process.env.CASSANDRA_KEYSPACE || 'viora_pluse_v1';

const client = new cassandra.Client({
    contactPoints: contactPoints,
    localDataCenter: localDataCenter,
    keyspace: keyspace,
    protocolOptions: {
        port: 9042,
        maxVersion: 4
    },
    socketOptions: {
        connectTimeout: 10000,
        readTimeout: 12000,
        keepAlive: true,
        keepAliveDelay: 0
    },
    pooling: {
        coreConnectionsPerHost: {
            [cassandra.types.distance.local]: 2,
            [cassandra.types.distance.remote]: 1
        }
    }
});

export const connectCassandra = async (retries = 5, delay = 5000) => {
    for (let i = 0; i < retries; i++) {
        try {
            await client.connect();
            sInfo(' Connected to Cassandra');
            return;
        } catch (err: any) {
            sError(` Cassandra connection attempt ${i + 1} failed:`, err.message);
            if (i < retries - 1) {
                sInfo(`Retrying in ${delay / 1000}s...`);
                await new Promise(res => setTimeout(res, delay));
            } else {
                sError(' Max retries reached. Could not connect to Cassandra.');
            }
        }
    }
};

const test = async () => {
    await connectCassandra();
    const result = await client.execute('SELECT * FROM users');
    sInfo(result.rows);
}
//test();

export default client;
