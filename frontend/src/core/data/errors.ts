/** Structured data-engine errors (§32–33). User-facing `message`, technical
 *  `detail`, and adapter/source `context` travel together; raw TypeError-style
 *  exceptions never reach the UI directly. */

export type DatasetErrorCode =
  | "unsupported-format"
  | "invalid-data"
  | "read-failed"
  | "network-failed"
  | "decode-failed"
  | "out-of-memory"
  | "cancelled";

export class VpDataError extends Error {
  readonly code: DatasetErrorCode;
  readonly detail?: string;
  readonly context?: Record<string, unknown>;

  constructor(code: DatasetErrorCode, message: string, opts?: {
    detail?: string;
    context?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(message, { cause: opts?.cause });
    this.name = "VpDataError";
    this.code = code;
    this.detail = opts?.detail;
    this.context = opts?.context;
  }
}

/** True when the error represents deliberate cancellation (job or fetch abort). */
export function isCancelledError(e: unknown): boolean {
  if (e instanceof VpDataError) return e.code === "cancelled";
  return (e as { name?: string } | null)?.name === "AbortError";
}

export function cancellationError(reason = "operation was cancelled"): VpDataError {
  return new VpDataError("cancelled", "Cancelled", { detail: reason });
}

/** Wrap an unknown thrown value into a VpDataError (idempotent). */
export function toVpDataError(
  e: unknown,
  fallbackCode: DatasetErrorCode,
  message: string,
  context?: Record<string, unknown>,
): VpDataError {
  if (e instanceof VpDataError) return e;
  if (isCancelledError(e)) return cancellationError();
  const raw = e instanceof Error ? e.message : String(e);
  return new VpDataError(fallbackCode, message, { detail: raw, context, cause: e });
}
