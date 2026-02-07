import { sDebug } from "sk-logger";

/**
 * Snowflake ID Generator
 *
 * Structure (64-bit signed integer):
 * 1 bit: Unused (sign bit)
 * 41 bits: Timestamp (milliseconds since custom epoch)
 * 10 bits: Machine ID (5 bits datacenter + 5 bits worker)
 * 12 bits: Sequence number (per millisecond)
 *
 * Custom Epoch: 2024-01-01T00:00:00.000Z (1704067200000)
 */
class SnowflakeService {
    private readonly epoch: bigint = 1704067200000n; // 2024-01-01
    private readonly machineIdBits: bigint = 5n;
    private readonly datacenterIdBits: bigint = 5n;
    private readonly sequenceBits: bigint = 12n;

    private readonly maxMachineId: bigint = -1n ^ (-1n << this.machineIdBits);
    private readonly maxDatacenterId: bigint = -1n ^ (-1n << this.datacenterIdBits);
    private readonly maxSequence: bigint = -1n ^ (-1n << this.sequenceBits);

    private readonly machineIdShift: bigint = this.sequenceBits;
    private readonly datacenterIdShift: bigint = this.sequenceBits + this.machineIdBits;
    private readonly timestampShift: bigint = this.sequenceBits + this.machineIdBits + this.datacenterIdBits;

    private machineId: bigint;
    private datacenterId: bigint;
    private sequence: bigint = 0n;
    private lastTimestamp: bigint = -1n;

    constructor(machineId: number = 1, datacenterId: number = 1) {
        this.machineId = BigInt(machineId);
        this.datacenterId = BigInt(datacenterId);

        if (this.machineId > this.maxMachineId || this.machineId < 0n) {
            throw new Error(`Machine ID can't be greater than ${this.maxMachineId} or less than 0`);
        }
        if (this.datacenterId > this.maxDatacenterId || this.datacenterId < 0n) {
            throw new Error(`Datacenter ID can't be greater than ${this.maxDatacenterId} or less than 0`);
        }
    }

    /*
     * Generate next unique Snowflake ID
     */
    public generate(): string {
        let timestamp = this.currentTimestamp();

        if (timestamp < this.lastTimestamp) {
            throw new Error("Clock moved backwards. Refusing to generate id");
        }

        if (timestamp === this.lastTimestamp) {
            this.sequence = (this.sequence + 1n) & this.maxSequence;
            if (this.sequence === 0n) {
                // Sequence overflow, wait for next millisecond
                timestamp = this.tilNextMillis(this.lastTimestamp);
            }
        } else {
            this.sequence = 0n;
        }

        this.lastTimestamp = timestamp;

        const id = ((timestamp - this.epoch) << this.timestampShift) |
            (this.datacenterId << this.datacenterIdShift) |
            (this.machineId << this.machineIdShift) |
            this.sequence;

        return id.toString();
    }

    private tilNextMillis(lastTimestamp: bigint): bigint {
        let timestamp = this.currentTimestamp();
        while (timestamp <= lastTimestamp) {
            timestamp = this.currentTimestamp();
        }
        return timestamp;
    }

    private currentTimestamp(): bigint {
        return BigInt(Date.now());
    }

    /**
     * Parse a Snowflake ID to get its creation timestamp
     */
    public getTimestamp(id: string): Date {
        const idBigInt = BigInt(id);
        const timestamp = (idBigInt >> this.timestampShift) + this.epoch;
        return new Date(Number(timestamp));
    }
}

// In a real distributed system, machineId and datacenterId should be configurable via env vars
const machineId = process.env.SNOWFLAKE_MACHINE_ID ? parseInt(process.env.SNOWFLAKE_MACHINE_ID) : 1;
const datacenterId = process.env.SNOWFLAKE_DATACENTER_ID ? parseInt(process.env.SNOWFLAKE_DATACENTER_ID) : 1;

export default new SnowflakeService(machineId, datacenterId);
