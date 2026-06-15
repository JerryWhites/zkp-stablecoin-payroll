/**
 * Conditional logger utility.
 * Only logs in development mode (import.meta.env.DEV).
 * In production builds, all log calls are no-ops.
 */

const isDev = import.meta.env.DEV;

/* eslint-disable @typescript-eslint/no-explicit-any */
export const logger = {
  log: (...args: any[]) => {
    if (isDev) console.log(...args);
  },
  warn: (...args: any[]) => {
    if (isDev) console.warn(...args);
  },
  error: (...args: any[]) => {
    // Always log errors — they indicate real problems
    console.error(...args);
  },
  info: (...args: any[]) => {
    if (isDev) console.info(...args);
  },
  debug: (...args: any[]) => {
    if (isDev) console.debug(...args);
  },
};
/* eslint-enable @typescript-eslint/no-explicit-any */
