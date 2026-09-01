import { Component, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { error: Error | null }

/** Keeps the HUD alive if the 3D canvas fails (e.g. WebGL unavailable). */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="vp-floating absolute inset-x-4 top-20 z-10 rounded-xl p-4">
          <div className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-error)]">
            3D viewport failed: {this.state.error.message}
          </div>
          <div className="mt-1 text-[12px] text-[var(--vp-text-2)]">
            WebGL may be unavailable — telemetry HUD still runs below.
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
