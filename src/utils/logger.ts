/**
 * Logger — SPEC §18.1
 *
 * Thin wrapper over pino with deferred import (pino is an optional dependency
 * effectively; if it fails to load at runtime we fall back to a console-based
 * shim so M1 smoke test works even before `npm install` finishes on a fresh
 * clone).
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  trace(msg: string, extra?: unknown): void;
  debug(msg: string, extra?: unknown): void;
  info(msg: string, extra?: unknown): void;
  warn(msg: string, extra?: unknown): void;
  error(msg: string, extra?: unknown): void;
  level: LogLevel;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

function consoleLogger(level: LogLevel): Logger {
  const emit = (lvl: LogLevel, msg: string, extra?: unknown) => {
    if (LEVEL_RANK[lvl] < LEVEL_RANK[level]) return;
    const prefix = `[${lvl}]`;
    if (extra !== undefined) {
      // eslint-disable-next-line no-console
      console.error(prefix, msg, extra);
    } else {
      // eslint-disable-next-line no-console
      console.error(prefix, msg);
    }
  };
  return {
    trace: (m, x) => emit('trace', m, x),
    debug: (m, x) => emit('debug', m, x),
    info: (m, x) => emit('info', m, x),
    warn: (m, x) => emit('warn', m, x),
    error: (m, x) => emit('error', m, x),
    level,
  };
}

export async function createLogger(level: LogLevel = 'info'): Promise<Logger> {
  try {
    // Dynamic import — pino is a hard dep in package.json but keep this resilient.
    const pino = (await import('pino')).default;
    const inner = pino({
      level,
      transport: process.stderr.isTTY
        ? {
            target: 'pino/file',
            options: { destination: 2 }, // stderr
          }
        : undefined,
    });
    return {
      trace: (m, x) => inner.trace(x ?? {}, m),
      debug: (m, x) => inner.debug(x ?? {}, m),
      info: (m, x) => inner.info(x ?? {}, m),
      warn: (m, x) => inner.warn(x ?? {}, m),
      error: (m, x) => inner.error(x ?? {}, m),
      level,
    };
  } catch {
    return consoleLogger(level);
  }
}

// Sync fallback for tests / places that don't want to await.
export function createLoggerSync(level: LogLevel = 'info'): Logger {
  return consoleLogger(level);
}
