import { Boxes, FilePlus2, FolderOpen, Radio, Mountain, Car, Keyboard } from "lucide-react";
import { useProjectStore } from "../stores/projectStore";

export interface StartAction { kind: "new" | "open" | "addData" | "example" | "shortcuts"; example?: string }

/** Premium start screen — no auto-demo; examples load intentionally. */
export function StartScreen({ onAction }: { onAction: (a: StartAction) => void }) {
  const recents = useProjectStore((s) => s.recents);
  const btn = "vp-focusable flex w-full items-center gap-2.5 rounded-md border border-[var(--vp-border)] px-4 py-2.5 text-left text-[12px] text-[var(--vp-text-1)] transition-colors hover:border-[var(--vp-accent)] hover:bg-[var(--vp-accent-soft)]";

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[var(--vp-canvas)]">
      <div className="w-[440px]">
        <div className="mb-1 flex items-center gap-2.5">
          <Boxes size={22} className="text-[var(--vp-accent)]" />
          <span className="text-[18px] font-semibold tracking-wide text-[var(--vp-text-1)]">VoxelPulse</span>
        </div>
        <p className="mb-7 text-[12px] leading-relaxed text-[var(--vp-text-2)]">
          Open-source spatial computing for LiDAR, GIS and perception.
        </p>

        <div className="flex flex-col gap-2">
          <button className={btn} onClick={() => onAction({ kind: "new" })}>
            <FilePlus2 size={14} className="text-[var(--vp-text-2)]" /> New Project
          </button>
          <button className={btn} onClick={() => onAction({ kind: "open" })}>
            <FolderOpen size={14} className="text-[var(--vp-text-2)]" /> Open Project… <span className="ml-auto text-[10px] text-[var(--vp-text-3)]">⌘O</span>
          </button>
          <button className={btn} onClick={() => onAction({ kind: "addData" })}>
            <Boxes size={14} className="text-[var(--vp-text-2)]" /> Add Point Cloud… <span className="ml-auto text-[10px] text-[var(--vp-text-3)]">.las .ply .pcd .xyz</span>
          </button>
        </div>

        <div className="mt-7">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--vp-text-3)]">Examples</div>
          <div className="flex gap-2">
            <ExampleCard icon={<Radio size={14} />} label="Urban LiDAR Demo" onClick={() => onAction({ kind: "example", example: "urban" })} />
            <ExampleCard icon={<Car size={14} />} label="Robotics Street" onClick={() => onAction({ kind: "example", example: "warehouse" })} />
            <ExampleCard icon={<Mountain size={14} />} label="Drone Scan" onClick={() => onAction({ kind: "example", example: "drone" })} />
          </div>
        </div>

        {recents.length > 0 && (
          <div className="mt-7">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--vp-text-3)]">Recent Projects</div>
            <div className="flex flex-col gap-0.5">
              {recents.slice(0, 4).map((r) => (
                <button key={r} onClick={() => onAction({ kind: "open" })}
                  className="vp-focusable rounded px-2 py-1 text-left text-[11px] text-[var(--vp-text-2)] hover:bg-white/5 hover:text-[var(--vp-text-1)]">
                  {r}
                </button>
              ))}
            </div>
          </div>
        )}

        <button onClick={() => onAction({ kind: "shortcuts" })}
          className="mt-8 flex items-center gap-1.5 text-[11px] text-[var(--vp-text-3)] hover:text-[var(--vp-text-2)]">
          <Keyboard size={12} /> Keyboard shortcuts
        </button>
      </div>
    </div>
  );
}

function ExampleCard({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="vp-focusable flex flex-1 flex-col items-start gap-2 rounded-md border border-[var(--vp-border)] p-3 text-left transition-colors hover:border-[var(--vp-accent)] hover:bg-[var(--vp-accent-soft)]"
    >
      <span className="text-[var(--vp-accent)]">{icon}</span>
      <span className="text-[11px] text-[var(--vp-text-1)]">{label}</span>
    </button>
  );
}
