/** CRS chooser (§18–20, §77–78): search → inspect → select. Bundled codes
 *  plus raw proj4/WKT assignment behind an "Advanced" disclosure. Used for
 *  both Project CRS (mode "project") and dataset assignment (mode "assign").
 *  Assignment ≠ reprojection — coordinates never change here (§15). */
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { X, Search, Globe, Star } from "lucide-react";
import {
  bundledReferences, spatialReferenceRegistry,
} from "../core/spatial/registry";
import type { SpatialReference } from "../core/spatial/reference";
import { Button, Chip } from "../ui/kit";

const LS_CRS_RECENTS = "voxelpulse.crs-recents.v1";
const RECENTS_LIMIT = 6;

export function pushCrsRecent(id: string): void {
  try {
    const list: string[] = JSON.parse(localStorage.getItem(LS_CRS_RECENTS) ?? "[]");
    const next = [id, ...list.filter((r) => r !== id)].slice(0, RECENTS_LIMIT);
    localStorage.setItem(LS_CRS_RECENTS, JSON.stringify(next));
  } catch { /* private mode */ }
}

export function crsRecents(): string[] {
  try {
    return (JSON.parse(localStorage.getItem(LS_CRS_RECENTS) ?? "[]") as string[])
      .filter((id) => id !== "VP:LOCAL" && id !== "VP:UNKNOWN");
  } catch { return []; }
}

export function CrsChooser({ mode, current, onClose, onAssign }: {
  mode: "project" | "assign";
  /** Canonical id of the current reference (shown as selected). */
  current: string;
  onClose: () => void;
  /** Assign mode: receives the picked canonical id (assignment ≠ reprojection). */
  onAssign?: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [defText, setDefText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = bundledReferences();
    if (!q) return all.slice(0, 8);
    return all.filter((r) =>
      r.id.toLowerCase().includes(q) || (r.name ?? "").toLowerCase().includes(q)).slice(0, 12);
  }, [query]);

  const recents = useMemo(() =>
    crsRecents()
      .map((id) => {
        try { return spatialReferenceRegistry.resolve(id); } catch { return null; }
      })
      .filter((r): r is SpatialReference => r !== null),
  []);

  const pick = (ref: SpatialReference) => {
    pushCrsRecent(ref.id);
    if (mode === "project") {
      document.dispatchEvent(new CustomEvent("vp-set-crs", { detail: ref.id }));
    } else {
      onAssign?.(ref.id);
    }
    onClose();
  };

  const assignDefinition = () => {
    try {
      const ref = spatialReferenceRegistry.resolveDefinition(defText);
      setError(null);
      pick(ref);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(4,6,10,0.55)" }} onClick={onClose}>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="vp-floating w-[440px] rounded-[var(--vp-r-lg)] border shadow-[var(--vp-shadow-3)]"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b px-3.5 py-2.5" style={{ borderColor: "var(--vp-divider)" }}>
          <Globe size={14} className="text-[var(--vp-accent)]" />
          <span className="text-[13px] font-semibold text-[var(--vp-text-1)]">
            {mode === "project" ? "Project Spatial Reference" : "Assign Spatial Reference"}
          </span>
          {mode === "assign" && (
            <span className="text-[11px] text-[var(--vp-text-3)]">interprets existing coordinates — no reprojection</span>
          )}
          <button onClick={onClose} className="ml-auto text-[var(--vp-text-3)] hover:text-[var(--vp-text-1)]" aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="px-3.5 py-3">
          <div className="flex items-center gap-2 rounded-[var(--vp-r-md)] border px-2.5 py-1.5" style={{ borderColor: "var(--vp-border-strong)" }}>
            <Search size={13} className="text-[var(--vp-text-3)]" />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search EPSG code or name — “32643”, “UTM”…"
              className="w-full bg-transparent text-[12.5px] text-[var(--vp-text-1)] outline-none placeholder:text-[var(--vp-text-3)]" />
          </div>

          {recents.length > 0 && !query && (
            <div className="mt-2.5">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--vp-text-3)]">Recent</div>
              {recents.map((r) => <CrsRow key={r.id} ref_={r} selected={r.id === current} onPick={pick} recent />)}
            </div>
          )}

          <div className="mt-2.5 max-h-[260px] overflow-y-auto">
            {results.map((r) => <CrsRow key={r.id} ref_={r} selected={r.id === current} onPick={pick} />)}
            {results.length === 0 && (
              <div className="px-1 py-3 text-[12px] text-[var(--vp-text-3)]">
                No bundled match. Use Advanced to assign a proj4/WKT definition.
              </div>
            )}
          </div>

          <button onClick={() => setAdvanced(!advanced)}
            className="mt-2 text-[11px] font-medium uppercase tracking-wider text-[var(--vp-text-3)] hover:text-[var(--vp-text-1)]">
            {advanced ? "▾" : "▸"} Advanced — proj4 / WKT definition
          </button>
          {advanced && (
            <div className="mt-2">
              <textarea value={defText} onChange={(e) => setDefText(e.target.value)} rows={3}
                placeholder='+proj=lcc +lat_1=… | PROJCS[…]'
                className="w-full rounded-[var(--vp-r-md)] border bg-transparent px-2.5 py-2 font-[var(--vp-font-mono)] text-[11.5px] text-[var(--vp-text-1)] outline-none"
                style={{ borderColor: "var(--vp-border-strong)" }} />
              {error && <div className="mt-1 text-[11.5px] text-[var(--vp-error)]">{error}</div>}
              <div className="mt-2 flex justify-end">
                <Button onClick={assignDefinition} disabled={defText.trim().length < 8}>Assign definition</Button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function CrsRow({ ref_, selected, onPick, recent }: {
  ref_: SpatialReference; selected: boolean; onPick: (r: SpatialReference) => void; recent?: boolean;
}) {
  return (
    <button onClick={() => onPick(ref_)}
      className={`vp-focusable flex w-full items-center gap-2.5 rounded-[var(--vp-r-md)] px-2.5 py-1.5 text-left
        ${selected ? "bg-[var(--vp-accent-soft)]" : "hover:bg-[var(--vp-hover)]"}`}>
      {recent ? <Star size={11} className="shrink-0 text-[var(--vp-text-3)]" /> : null}
      <span className="font-[var(--vp-font-mono)] text-[12px] font-semibold text-[var(--vp-accent)]">{ref_.id}</span>
      <span className="truncate text-[12.5px] text-[var(--vp-text-1)]">{ref_.name}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <Chip tone="neutral">{ref_.kind}</Chip>
        <span className="text-[11px] text-[var(--vp-text-3)]">{ref_.horizontalUnit.symbol}</span>
      </span>
    </button>
  );
}
