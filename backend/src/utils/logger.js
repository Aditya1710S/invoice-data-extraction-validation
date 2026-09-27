// Minimal structured logger. Swap for pino/winston later if needed —
// every call site already goes through this module so that's a one-file change.

function timestamp() {
  return new Date().toISOString();
}

function base(level, msg, meta) {
  const line = `[${timestamp()}] [${level}] ${msg}`;
  if (meta !== undefined) {
    console.log(line, meta);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (msg, meta) => base("INFO", msg, meta),
  warn: (msg, meta) => base("WARN", msg, meta),
  error: (msg, meta) => base("ERROR", msg, meta),
  debug: (msg, meta) => {
    if (process.env.NODE_ENV !== "production") base("DEBUG", msg, meta);
  },
};
