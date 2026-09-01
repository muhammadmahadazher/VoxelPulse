/**
 * Deterministic label decluttering (§4–6 of Phase 1.6).
 *
 * A single throttled pass (every 6 frames ≈ 5 Hz) projects each tracked
 * detection to screen space, sorts by priority (selected first, then
 * confidence), and grants "detailed label" slots to the top N that do not
 * overlap an already-placed label. Everything else falls back to a minimal
 * marker. No React state, no layout thrash — results are read via refs.
 *
 * Occlusion decision (documented per §6): full depth-buffer occlusion was
 * evaluated and deferred — the projected-position pass already culls
 * off-screen and behind-camera labels, and per-label depth sampling every
 * frame was judged too costly for Phase 1.6. Selected entities are always
 * shown. Full occlusion is future renderer work.
 */
import * as THREE from "three";
import type { SensorObject } from "../store";
import { useStore } from "../store";

export const MAX_DETAILED_LABELS = 8;
const PASS_INTERVAL = 6; // frames between declutter passes (~5 Hz at 30 FPS)
const MIN_SCREEN_DIST = 120; // px between detailed labels
const HIDE_SCREEN_DIST = 46; // px — suppress the minimal chip entirely below this

interface Ranked {
  id: number;
  conf: number;
  selected: boolean;
  sx: number;
  sy: number;
}

interface SlotState {
  detailed: boolean;
  visible: boolean; // projected on screen at all
}

const v = new THREE.Vector3();

export class LabelDeclutterer {
  private entries = new Map<number, { obj: SensorObject; center: THREE.Vector3 }>();
  private results = new Map<number, SlotState>();
  private frameCount = 0;

  /** Run one throttled pass; returns true when results were refreshed. */
  begin(camera: THREE.Camera, width: number, height: number): boolean {
    this.frameCount++;
    if (this.frameCount % PASS_INTERVAL !== 1) return false;
    const selectedId = useStore.getState().selectedTrack;

    const ranked: Ranked[] = [];
    for (const [id, e] of this.entries) {
      v.copy(e.center).project(camera);
      const onScreen = v.z < 1 && v.x > -1.05 && v.x < 1.05 && v.y > -1.05 && v.y < 1.05;
      if (!onScreen) {
        this.results.set(id, { detailed: false, visible: false });
        continue;
      }
      this.results.set(id, { detailed: false, visible: true });
      ranked.push({
        id, conf: e.obj.conf, selected: id === selectedId,
        sx: (v.x * 0.5 + 0.5) * width, sy: (-v.y * 0.5 + 0.5) * height,
      });
    }
    // priority: selected always first, then confidence. Two rings: a detailed
    // slot needs 120 px clearance from every placed label; a minimal chip is
    // suppressed entirely when it would sit within 46 px of one.
    ranked.sort((a, b) => (a.selected === b.selected ? b.conf - a.conf : a.selected ? -1 : 1));
    const placed: { x: number; y: number }[] = [];
    let slots = MAX_DETAILED_LABELS;
    for (const r of ranked) {
      const nearest = placed.length
        ? Math.min(...placed.map((p) => Math.hypot(p.x - r.sx, p.y - r.sy)))
        : Infinity;
      if (slots > 0 && nearest >= MIN_SCREEN_DIST) {
        this.results.set(r.id, { detailed: true, visible: true });
        placed.push({ x: r.sx, y: r.sy });
        slots--;
      } else {
        this.results.set(r.id, { detailed: false, visible: nearest >= HIDE_SCREEN_DIST });
      }
    }
    return true;
  }

  register(id: number, obj: SensorObject, center: THREE.Vector3): void {
    this.entries.set(id, { obj, center });
  }
  unregister(id: number): void {
    this.entries.delete(id);
    this.results.delete(id);
  }
  state(id: number): SlotState {
    return this.results.get(id) ?? { detailed: false, visible: true };
  }
}

export const labelDeclutterer = new LabelDeclutterer();
