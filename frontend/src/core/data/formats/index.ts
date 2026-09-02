/** Adapter registration point (§12) — the only place that wires formats. */
import { formatRegistry } from "./registry";
import { lasAdapter } from "./las";
import { plyAdapter } from "./ply";
import { pcdAdapter } from "./pcd";
import { XyzAdapter } from "./xyz";

let registered = false;

/** Idempotent registration of the built-in adapters. */
export function registerBuiltinAdapters(): void {
  if (registered) return;
  formatRegistry.register(lasAdapter);
  formatRegistry.register(plyAdapter);
  formatRegistry.register(pcdAdapter);
  formatRegistry.register(new XyzAdapter());
  registered = true;
}
