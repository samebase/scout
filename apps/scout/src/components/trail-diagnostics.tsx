import { createPortal } from "react-dom";
import type { TrailDiagnosticsFrame } from "#lib/terrain-trail-diagnostics";

export function TrailDiagnostics({ frame }: { frame: TrailDiagnosticsFrame }) {
  const { viewport, bounds, obstacles, checkpoints } = frame;
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-50" aria-label="Route diagnostics">
      <svg
        aria-hidden="true"
        className="absolute overflow-hidden"
        style={{ left: viewport.left, top: viewport.top }}
        width={viewport.width}
        height={viewport.height}
      >
        <polyline
          points={frame.directPath.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke="#475569"
          strokeWidth="2"
          strokeDasharray="4 5"
          opacity="0.7"
        />
        <rect
          x={bounds.left + 1}
          y={bounds.top + 1}
          width={Math.max(0, bounds.right - bounds.left - 2)}
          height={Math.max(0, bounds.bottom - bounds.top - 2)}
          fill="none"
          stroke="#15803d"
          strokeWidth="2"
          strokeDasharray="6 4"
        />
        {obstacles.map((box, index) => (
          <rect
            key={index}
            x={box.left}
            y={box.top}
            width={box.right - box.left}
            height={box.bottom - box.top}
            fill="#7c3aed08"
            stroke="#7c3aed"
            strokeDasharray="3 4"
          />
        ))}
        {checkpoints.map((point) => (
          <g key={point.number}>
            <circle
              cx={point.x}
              cy={point.y}
              r={11}
              fill="none"
              stroke={point.outside > 0 ? "#dc2626" : "#15803d"}
              strokeWidth="2"
            />
            <text
              x={Math.max(bounds.left + 12, Math.min(bounds.right - 18, point.x + 14))}
              y={Math.max(bounds.top + 18, Math.min(bounds.bottom - 12, point.y - 14))}
              fontSize="14"
              fontWeight="600"
              stroke="white"
              strokeWidth="3"
              paintOrder="stroke"
              fill="#111827"
            >
              {point.number}
            </text>
          </g>
        ))}
      </svg>
      <div className="absolute right-4 bottom-4 w-72 rounded-lg border border-slate-300 bg-white/95 p-3 font-mono text-xs text-slate-900 shadow-sm">
        <p className="mb-2 font-semibold">Route diagnostics</p>
        <p className="mb-2 text-[11px]">
          Dashed: direct route · Green: visible bounds · Purple: content
        </p>
        {checkpoints.map((point) => (
          <p key={point.number} className={point.outside > 0 ? "text-red-700" : "text-slate-900"}>
            {point.number}: {Math.round(point.x)}, {Math.round(point.y)} px ·{" "}
            {point.outside > 0
              ? `${Math.ceil(point.outside)} px outside`
              : point.covered
                ? "behind content"
                : "in view"}
          </p>
        ))}
        {frame.timing && (
          <p className="mt-2">
            Render: {frame.timing.framesPerSecond.toFixed(0)} fps
            <br />
            CPU draw: {frame.timing.drawMilliseconds.toFixed(1)} ms
            <br />
            GPU completion: {frame.timing.completionMilliseconds?.toFixed(1) ?? "—"} ms
          </p>
        )}
        <p className="mt-2">Checkpoint drift: {frame.meanSpeed.toFixed(3)}</p>
        <p>Relative checkpoint motion: {frame.relativeSpeed.toFixed(3)}</p>
        {frame.climb && (
          <p className="mt-2">
            Climb: {frame.climb.route.toFixed(2)} · Direct: {frame.climb.direct.toFixed(2)}
            <br />
            Required by checkpoints: {frame.climb.required.toFixed(2)}
          </p>
        )}
        {frame.renderError !== null && (
          <p>Planner / GPU difference: {frame.renderError.toFixed(3)} px</p>
        )}
        <details className="pointer-events-auto mt-2">
          <summary className="cursor-pointer">Scene snapshot</summary>
          <textarea
            aria-label="Scene snapshot"
            readOnly
            className="mt-2 h-24 w-full select-text border p-1"
            value={JSON.stringify(frame.snapshot)}
          />
        </details>
      </div>
    </div>,
    document.body,
  );
}
