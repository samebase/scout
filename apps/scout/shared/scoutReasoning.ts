export const SCOUT_REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;

export type ScoutReasoningEffort = (typeof SCOUT_REASONING_EFFORTS)[number];

export const SCOUT_REASONING_LABELS = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
} satisfies Record<ScoutReasoningEffort, string>;
