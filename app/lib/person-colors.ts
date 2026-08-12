export const PAVEN_DISPLAY_COLOR = "#3b82f6";
export const BURGER_LARS_DISPLAY_COLOR = "#ef4444";

const FALLBACK_PERSON_DISPLAY_COLORS = [
  "#22c55e",
  "#eab308",
  "#a855f7",
  "#06b6d4",
] as const;

export function getPersonDisplayColor(name: string, fallbackIndex: number) {
  const normalizedName = name.trim().toLowerCase();

  if (normalizedName === "paven") return PAVEN_DISPLAY_COLOR;
  if (normalizedName === "burger lars") return BURGER_LARS_DISPLAY_COLOR;

  return FALLBACK_PERSON_DISPLAY_COLORS[
    fallbackIndex % FALLBACK_PERSON_DISPLAY_COLORS.length
  ];
}
