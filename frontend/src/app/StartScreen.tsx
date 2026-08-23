import { FilePlus2, FolderOpen, UploadCloud, Radio, Mountain, Car, Keyboard, ArrowRight } from "lucide-react";
import { useProjectStore } from "../stores/projectStore";
import { BrandMark } from "./AppHeader";
import { Button } from "../ui/kit";

export interface StartAction { kind: "new" | "open" | "addData" | "example" | "shortcuts"; example?: string }

/** Welcome workspace — the first impression. Restrained spatial motif,
 *  readable hero typography, deliberate actions. */
export function StartScreen({ onAction }: { onAction: (a: StartAction) => void }) {
  const recents = useProjectStore((s) => s.recents);

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center overflow-hidden"
      style={{ background: "var(--vp-canvas)" }}>
      {/* subtle spatial dot-field motif */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.35]" aria-hidden>
        <defs>
          <radialGradient id="fade" cx="50%" cy="42%" r="65%">
            <stop offset="0" stopColor="var(--vp-text-3)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--vp-text-3)" stopOpacity="0" />
          </radialGradient>
        </defs>
        {Array.from({ length: 22 }, (_, row) =>
          Array.from({ length: 34 }, (_, col) => {
            const cx = 40 + col * 56 + (row % 2) * 28;
            const cy = 60 + row * 52;
            const r = 1.1 + ((row * 34 + col * 7) % 5) * 0.28;
            return <circle key={`${row}-${col}`} cx={cx} cy={cy} r={r} fill="url(#fade)" />;
          })
        )}
      </svg>

      <div className="relative w-[520px]">
        <div className="mb-4 flex items-center gap-3">
          <BrandMark size={26} />
          <span className="text-[15px] font-semibold tracking-[0.32em] text-[var(--vp-text-2)]">
            V O X E L P U L S E
          </span>
        </div>
        <h1 className="mb-3 text-[var(--vp-fs-hero)] font-semibold leading-[1.15] tracking-tight text-[var(--vp-text-1)]">
          Spatial computing for<br />LiDAR, GIS and perception.
        </h1>
        <p className="mb-8 max-w-[400px] text-[14px] leading-relaxed text-[var(--vp-text-2)]">
          Explore point clouds, terrain and sensor data in a GPU-accelerated
          3D workstation — open source, in your browser.
        </p>

        <div className="mb-9 flex items-center gap-3">
          <Button variant="primary" size="lg" onClick={() => onAction({ kind: "new" })}>
            <FilePlus2 size={16} /> New Project
          </Button>
          <Button size="lg" onClick={() => onAction({ kind: "open" })}>
            <FolderOpen size={16} /> Open Project
          </Button>
          <Button variant="ghost" size="lg" onClick={() => onAction({ kind: "addData" })}>
            <UploadCloud size={16} /> Add Data
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-8">
          <div>
            <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--vp-text-3)]">Examples</div>
            <div className="flex flex-col gap-1">
              <ExampleRow icon={<Radio size={15} />} label="Urban LiDAR Demo" hint="traffic · detections" onClick={() => onAction({ kind: "example", example: "urban" })} />
              <ExampleRow icon={<Car size={15} />} label="Robotics Street" hint="warehouse AGVs" onClick={() => onAction({ kind: "example", example: "warehouse" })} />
              <ExampleRow icon={<Mountain size={15} />} label="Drone Scan" hint="aerial survey" onClick={() => onAction({ kind: "example", example: "drone" })} />
            </div>
          </div>
          {recents.length > 0 && (
            <div>
              <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--vp-text-3)]">Recent Projects</div>
              <div className="flex flex-col gap-1">
                {recents.slice(0, 3).map((r) => (
                  <button key={r} onClick={() => onAction({ kind: "open" })}
                    className="vp-focusable group flex min-h-[32px] items-center gap-2 rounded-[var(--vp-r-md)] px-2 text-left text-[13px] text-[var(--vp-text-2)] transition-colors hover:bg-[var(--vp-hover)] hover:text-[var(--vp-text-1)]">
                    <span className="truncate">{r}</span>
                    <ArrowRight size={13} className="ml-auto shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <button onClick={() => onAction({ kind: "shortcuts" })}
          className="mt-9 flex items-center gap-1.5 text-[12.5px] text-[var(--vp-text-3)] transition-colors hover:text-[var(--vp-text-2)]">
          <Keyboard size={14} /> Keyboard shortcuts
        </button>
      </div>
    </div>
  );
}

function ExampleRow({ icon, label, hint, onClick }: {
  icon: React.ReactNode; label: string; hint: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className="vp-focusable group flex min-h-[36px] items-center gap-2.5 rounded-[var(--vp-r-md)] border border-transparent px-2.5 text-left transition-all hover:border-[var(--vp-border)] hover:bg-[var(--vp-hover)]">
      <span className="text-[var(--vp-accent)]">{icon}</span>
      <span className="flex flex-col">
        <span className="text-[13px] font-medium text-[var(--vp-text-1)]">{label}</span>
        <span className="text-[11.5px] text-[var(--vp-text-3)]">{hint}</span>
      </span>
      <ArrowRight size={14} className="ml-auto text-[var(--vp-text-3)] opacity-0 transition-opacity group-hover:opacity-70" />
    </button>
  );
}
