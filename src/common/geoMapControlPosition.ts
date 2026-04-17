export const GEO_MAP_CONTROL_POSITIONS = ['top', 'bottom', 'left', 'right'] as const

export type GeoMapControlPosition = (typeof GEO_MAP_CONTROL_POSITIONS)[number]

export const DEFAULT_GEO_MAP_CONTROL_POSITION: GeoMapControlPosition = 'bottom'

export function normalizeGeoMapControlPosition(raw: unknown): GeoMapControlPosition {
  if (
    typeof raw === 'string' &&
    (GEO_MAP_CONTROL_POSITIONS as readonly string[]).includes(raw)
  ) {
    return raw as GeoMapControlPosition
  }
  return DEFAULT_GEO_MAP_CONTROL_POSITION
}
