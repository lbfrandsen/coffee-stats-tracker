export const PAVEN_DISPLAY_COLOR = "#3b82f6";
export const BURGER_LARS_DISPLAY_COLOR = "#ef4444";
export const OTHER_PERSON_DISPLAY_COLOR = "#a855f7";

export function getPersonDisplayColor(name: string) {
  const normalizedName = name.trim().toLowerCase();

  if (normalizedName === "paven") return PAVEN_DISPLAY_COLOR;
  if (normalizedName === "burger lars") return BURGER_LARS_DISPLAY_COLOR;

  return OTHER_PERSON_DISPLAY_COLOR;
}
