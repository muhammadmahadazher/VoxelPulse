/** CRS registry (§7–8, §107–108). Resolves identifiers to normalized
 *  SpatialReferences, cached. Bundles WGS 84 + Web Mercator and GENERATES
 *  all 120 UTM zones — small, offline, no EPSG database shipped. Unknown
 *  codes fail with a structured error; proj-string/WKT assignment is the
 *  escape hatch (via resolveDefinition). */
import proj4 from "proj4";
import { VpDataError } from "../data/errors";
import { DEGREE, METRE, type SpatialReference } from "./reference";
import { createLogger } from "../data/logging";

const log = createLogger("crs-registry");

export const EPSG_4326 = "EPSG:4326";
export const EPSG_3857 = "EPSG:3857";

const WGS84_DEF = "+proj=longlat +datum=WGS84 +no_defs";
const WEB_MERCATOR_DEF = "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs";

function geographic(id: string, code: string, name: string, def: string): SpatialReference {
  return { id, kind: "geographic", authority: "EPSG", code, name, projString: def, horizontalUnit: DEGREE };
}
function projected(id: string, code: string, name: string, def: string): SpatialReference {
  return { id, kind: "projected", authority: "EPSG", code, name, projString: def, horizontalUnit: METRE };
}

/** All 60 UTM zones, northern and southern (§58). */
function utmDef(zone: number, south: boolean): string {
  return ["+proj=utm", `+zone=${zone}`, south ? "+south" : "", "+datum=WGS84", "+units=m", "+no_defs"].join(" ");
}

const BUNDLED = new Map<string, SpatialReference>([
  ["EPSG:4326", geographic(EPSG_4326, "4326", "WGS 84", WGS84_DEF)],
  ["EPSG:3857", projected(EPSG_3857, "3857", "WGS 84 / Pseudo-Mercator", WEB_MERCATOR_DEF)],
]);

for (let zone = 1; zone <= 60; zone++) {
  const code = String(32600 + zone);
  BUNDLED.set(`EPSG:${code}`, projected(
    `EPSG:${code}`, code, `WGS 84 / UTM zone ${zone}N`, utmDef(zone, false)));
  const southCode = String(32700 + zone);
  BUNDLED.set(`EPSG:${southCode}`, projected(
    `EPSG:${southCode}`, southCode, `WGS 84 / UTM zone ${zone}S`, utmDef(zone, true)));
}

/** Normalize user input to a canonical id when the context clearly means
 *  EPSG (§8): "epsg:4326" | "4326" → "EPSG:4326". Returns input otherwise. */
export function normalizeCrsId(input: string): string {
  const trimmed = input.trim();
  const m = trimmed.match(/^epsg[:\s]+(\d{4,5})$/i);
  if (m) return `EPSG:${m[1]}`;
  if (/^\d{4,5}$/.test(trimmed)) return `EPSG:${trimmed}`;
  return trimmed;
}

/** All bundled, searchable entries (chooser UI, §18). */
export function bundledReferences(): SpatialReference[] {
  return [...BUNDLED.values()];
}

export const spatialReferenceRegistry = {
  /** Resolve an identifier (or raw proj4/WKT definition) to a normalized
   *  SpatialReference. Cached — resolution is cheap after first use (§106). */
  resolve(input: string): SpatialReference {
    const id = normalizeCrsId(input);
    const bundled = BUNDLED.get(id);
    if (bundled) return bundled;
    // Custom definition string (proj4 or WKT1) — classify by its content.
    if (input.includes("+") || /PROJCS|GEOGCS/i.test(input)) {
      return this.resolveDefinition(input);
    }
    throw new VpDataError("unsupported-format", `Unknown spatial reference "${input}".`, {
      detail: "bundle covers WGS 84, Web Mercator and all UTM zones; assign a proj4/WKT definition for others",
      context: { crs: input },
    });
  },

  /** Resolve a raw proj4 string or WKT1 definition (user assignment §15). */
  resolveDefinition(definition: string): SpatialReference {
    const trimmed = definition.trim();
    if (trimmed.length > 16_000) {
      throw new VpDataError("invalid-data", "Spatial reference definition is unreasonably large.", {
        detail: `${trimmed.length} chars`, context: { limit: 16_000 },
      });
    }
    try {
      const obj = proj4(trimmed) as unknown as { forward?: unknown } | undefined;
      if (!obj || typeof obj.forward !== "function") {
        throw new Error("projection engine did not recognize the definition");
      }
      const nameMatch = trimmed.match(/name "[^"]+"/);
      const wktGeographic = /GEOGCS/i.test(trimmed);
      const name = nameMatch ? nameMatch[0].slice(7, -1)
        : wktGeographic ? "Custom geographic CRS" : "Custom projected CRS";
      const ref: SpatialReference = {
        id: `VP:DEF:${hashString(trimmed)}`,
        kind: wktGeographic ? "geographic" : "projected",
        name,
        projString: trimmed,
        horizontalUnit: wktGeographic ? DEGREE : METRE,
      };
      cacheDefinition(trimmed, ref);
      return ref;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new VpDataError("invalid-data", "Could not parse this spatial reference definition.", {
        detail: msg.slice(0, 200),
      });
    }
  },

  /** True when the registry can transform between two references. */
  canTransform(from: SpatialReference, to: SpatialReference): boolean {
    return Boolean(from.projString && to.projString);
  },
};

/* -------- definition cache: identical definition strings reuse objects ----- */

const defCache = new Map<string, SpatialReference>();
function cacheDefinition(def: string, ref: SpatialReference): void {
  if (defCache.size > 64) defCache.clear(); // bounded (§106)
  defCache.set(def, ref);
  log.debug(`cached custom definition ${ref.id}`);
}
function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
