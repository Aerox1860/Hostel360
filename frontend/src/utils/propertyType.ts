export const PROPERTY_TYPES = [
  { value: "boys_pg_hostel", label: "Boys PG / Boys Hostel" },
  { value: "girls_pg_hostel", label: "Girls PG / Girls Hostel" },
  { value: "co_living_pg", label: "Co-Living PG" },
  { value: "co_living_hostel", label: "Co-Living Hostel" },
] as const;

export type PropertyType = (typeof PROPERTY_TYPES)[number]["value"];

const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = Object.fromEntries(
  PROPERTY_TYPES.map(({ value, label }) => [value, label])
) as Record<PropertyType, string>;

export function propertyTypeLabel(value?: string | null): string {
  return value && value in PROPERTY_TYPE_LABELS
    ? PROPERTY_TYPE_LABELS[value as PropertyType]
    : "Property type not specified";
}
