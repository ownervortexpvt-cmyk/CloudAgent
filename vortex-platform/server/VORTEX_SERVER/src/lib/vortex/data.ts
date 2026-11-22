import { shortId } from "./crypto";

/**
 * VORTEX DATABASE — shared helpers (per-app DB provisioning).
 * SQL first (Postgres), then NoSQL (Redis, Mongo).
 */

export const ENGINES: Record<string, { label: string; versions: string[]; port: number }> = {
  POSTGRES: { label: "PostgreSQL", versions: ["16.4", "15.8"], port: 5432 },
  MYSQL: { label: "MySQL", versions: ["8.4", "8.0"], port: 3306 },
  REDIS: { label: "Redis", versions: ["7.4", "7.2"], port: 6379 },
  MONGO: { label: "MongoDB", versions: ["7.0", "6.0"], port: 27017 },
};

export const DEFAULT_ENGINE_VERSION: Record<string, string> = {
  POSTGRES: "16.4",
  MYSQL: "8.4",
  REDIS: "7.4",
  MONGO: "7.0",
};

export const DB_STATUS_TRANSITIONS: Record<string, string[]> = {
  PROVISIONING: ["RUNNING", "ERROR"],
  RUNNING: ["STOPPED", "DESTROYED"],
  STOPPED: ["RUNNING", "DESTROYED"],
  ERROR: ["STOPPED", "DESTROYED"],
};

export function newDbId(): string {
  return shortId("db", 8);
}

/** Internal DNS name: <name>.db.vortex.internal */
export function dnsNameFor(name: string): string {
  return `${name}.db.vortex.internal`;
}

export function engineLabel(engine: string): string {
  return ENGINES[engine]?.label || engine;
}
