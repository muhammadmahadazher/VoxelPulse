/** Leveled internal logging (§96). Default level is "warn" so the production
 *  console stays quiet; set localStorage `voxelpulse.debug = "1"` (or the
 *  exact level) to surface debug/info diagnostics. */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel(): LogLevel {
  try {
    const raw = localStorage.getItem("voxelpulse.debug");
    if (!raw) return "warn";
    if (raw === "1" || raw === "true") return "debug";
    if (raw in LEVELS) return raw as LogLevel;
  } catch { /* non-DOM context */ }
  return "warn";
}

export interface Logger {
  debug(msg: string, ...rest: unknown[]): void;
  info(msg: string, ...rest: unknown[]): void;
  warn(msg: string, ...rest: unknown[]): void;
  error(msg: string, ...rest: unknown[]): void;
}

export function createLogger(scope: string): Logger {
  const emit = (level: LogLevel) => (msg: string, ...rest: unknown[]) => {
    if (LEVELS[level] < LEVELS[currentLevel()]) return;
    const fn = level === "debug" ? console.debug : level === "info" ? console.info : console[level];
    fn(`[vp:${scope}] ${msg}`, ...rest);
  };
  return {
    debug: emit("debug"),
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
  };
}
