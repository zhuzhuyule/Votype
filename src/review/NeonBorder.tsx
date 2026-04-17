// NeonBorder — an SVG overlay that draws a chasing dashed stroke around its
// parent element. The stroke uses `pathLength="100"` so the dash pattern is
// in percentages of the perimeter regardless of element size, and animating
// `stroke-dashoffset` scrolls the dashes at truly uniform tangential speed
// along the rounded-rect path (including corners).
//
// Two dashes 180° apart (via `strokeDasharray="14 36 14 36"`) read as two
// light segments chasing each other around the border.

import React from "react";

interface NeonBorderProps {
  /** Corner radius in pixels — match the parent's `border-radius`. */
  radius?: number;
  /** Unique DOM id for the SVG <linearGradient>. Must be unique per render
   *  so stacking multiple NeonBorders on one page doesn't collide. */
  gradientId: string;
  /** Stroke width in pixels (screen-space, via non-scaling-stroke). */
  strokeWidth?: number;
  /** Animation period in seconds. Smaller button => faster feels snappier,
   *  larger cards => slightly slower reads calmer. */
  durationSec?: number;
}

// Chain spans ~half the perimeter. With `pathLength="100"` and dasharray
// `"2 48 2 48"` (two chasing comets 50 units apart), the chain's 24 dashes
// at step-2 fill path positions 1..49 (and the mirrored 51..99 for the
// second comet), leaving tiny 2-unit gaps at 0/50/100. Each dash touches
// its neighbour, so the taper reads as a continuous flowing bar.
const DASH_COUNT = 24;
const DASH_STEP = 2; // path units between adjacent dash right edges
const HEAD_WIDTH = 0.775; // halved head — narrower leading bulge
const TAIL_WIDTH = 0.35;

// Rainbow hue sweep across the chain. Starts at 340° (hot pink) and wraps
// UP through 360°/0° (red) → 60° (yellow) → 120° (green) → 180° (cyan)
// → 200° (sky blue) at the tail. That's a 220° sweep that lands on every
// primary/secondary hue, giving the chain a full multi-colour gradient
// rather than a two-stop pink→cyan.
const HEAD_HUE = 340;
const HUE_SWEEP = 220; // end hue = (HEAD_HUE + HUE_SWEEP) mod 360 = 200

const DASH_STEPS = Array.from({ length: DASH_COUNT }, (_, i) => {
  const t = i / (DASH_COUNT - 1); // 0 at head, 1 at tail
  const hue = (HEAD_HUE + HUE_SWEEP * t) % 360;
  return {
    offset: -(DASH_COUNT - 1 - i) * DASH_STEP - 1, // -47, -45, ..., -1
    width: HEAD_WIDTH - t * (HEAD_WIDTH - TAIL_WIDTH),
    alpha: 1 - t * 0.95, // 1.0 → 0.05
    color: `hsl(${hue}, 95%, ${78 - t * 8}%)`,
  };
});

export const NeonBorder: React.FC<NeonBorderProps> = ({
  radius = 8,
  gradientId: _gradientId,
  strokeWidth = 2,
  durationSec = 2.4,
}) => {
  // The chain's head at path position 15, tail at position 1 (length ≈ 14).
  // Dasharray `"1 49 1 49"` draws a 1-unit dash then 49-unit gap, repeating —
  // which places TWO dashes 50 units apart (two comets 180° around the loop).
  // Each rect's dash is positioned via `stroke-dashoffset` at -offset; the
  // whole chain then scrolls uniformly via the `review-neon-scroll` keyframe,
  // its animation-delay negative-biased so each rect enters its cycle at the
  // phase matching its target offset.
  return (
    <svg
      aria-hidden="true"
      className="review-neon-border-svg"
      style={
        {
          overflow: "visible",
          ["--review-neon-duration" as string]: `${durationSec}s`,
        } as React.CSSProperties
      }
      preserveAspectRatio="none"
    >
      {DASH_STEPS.map((step, i) => (
        <rect
          key={i}
          className="review-neon-border-rect"
          x="0"
          y="0"
          width="100%"
          height="100%"
          rx={radius}
          ry={radius}
          fill="none"
          stroke={step.color}
          strokeWidth={strokeWidth * step.width}
          strokeLinecap="butt"
          vectorEffect="non-scaling-stroke"
          pathLength="100"
          /* 2-unit dashes (vs 1-unit) so adjacent rects' dashes TOUCH at
             their shared path coordinate — with the 2-unit offset step the
             chain reads as a single continuous bar, not 8 discrete dots.
             Critical for larger elements (content cards) where each path
             unit spans many pixels; on tiny buttons the bigger touching
             dashes still look right because the per-step width ramp keeps
             the taper visible. */
          strokeDasharray="2 48 2 48"
          opacity={step.alpha}
          style={{
            // Negative delay = animation is already that far into its cycle
            // at mount time. For keyframes 0 → -100 over `durationSec`, being
            // `(-offset)%` into the cycle gives the desired initial offset.
            animationDelay: `${(step.offset / 100) * durationSec}s`,
          }}
        />
      ))}
    </svg>
  );
};
