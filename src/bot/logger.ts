import { appendFileSync } from "node:fs";

export type BotLogFields = Record<string, unknown>;

export interface BotLogger {
  info: (message: string, fields?: BotLogFields) => void;
  warn: (message: string, fields?: BotLogFields) => void;
  error: (message: string, fields?: BotLogFields) => void;
}

export function createBotLogger(): BotLogger {
  return {
    info(message, fields) {
      writeJsonLog("info", message, fields);
    },
    warn(message, fields) {
      writeJsonLog("warn", message, fields);
    },
    error(message, fields) {
      writeJsonLog("error", message, fields);
    },
  };
}

export function createDevLogger(filePath: string): BotLogger {
  return {
    info(message, fields) {
      writeDevLog("info", message, fields, filePath);
    },
    warn(message, fields) {
      writeDevLog("warn", message, fields, filePath);
    },
    error(message, fields) {
      writeDevLog("error", message, fields, filePath);
    },
  };
}

export const noopLogger: BotLogger = {
  info() {},
  warn() {},
  error() {},
};

function writeJsonLog(level: "info" | "warn" | "error", message: string, fields?: BotLogFields) {
  const entry = {
    level,
    time: new Date().toISOString(),
    msg: message,
    ...normalizeFields(fields),
  };

  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

function writeDevLog(
  level: "info" | "warn" | "error",
  message: string,
  fields: BotLogFields | undefined,
  filePath: string,
) {
  const entry = {
    level,
    time: new Date().toISOString(),
    msg: message,
    ...normalizeFields(fields),
  };

  process.stdout.write(`${formatHumanLog(level, message, fields)}\n`);
  appendFileSync(filePath, `${JSON.stringify(entry)}\n`);
}

function formatHumanLog(
  level: "info" | "warn" | "error",
  message: string,
  fields?: BotLogFields,
) {
  const normalizedFields = normalizeFields(fields);
  const parts = Object.entries(normalizedFields).map(([key, value]) => {
    if (value && typeof value === "object") {
      return `${key}=${JSON.stringify(value)}`;
    }

    return `${key}=${String(value)}`;
  });

  return [`[${level.toUpperCase()}]`, message, ...parts].join(" ");
}

function normalizeFields(fields?: BotLogFields) {
  if (!fields) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, normalizeValue(value)]),
  );
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  return value;
}
