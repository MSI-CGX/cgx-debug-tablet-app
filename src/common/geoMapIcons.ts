/**
 * Whitelist of Lucide icon names allowed for GeoJSON map layers (stored in app config).
 * Must match imports in `renderer/src/lib/geoMapLucideComponents.tsx`.
 */
export const GEO_MAP_LUCIDE_ICON_IDS = [
  'MapPin',
  'MapPinned',
  'Navigation',
  'Mountain',
  'TreePine',
  'Building2',
  'Car',
  'Ship',
  'Plane',
  'CircleDot',
  'Crosshair',
  'Flag',
  'House',
  'LocateFixed',
  'Radar',
  'Waypoints'
] as const

export type GeoMapLucideIconId = (typeof GEO_MAP_LUCIDE_ICON_IDS)[number]

export const DEFAULT_GEO_MAP_ICON: GeoMapLucideIconId = 'MapPin'

export function isGeoMapLucideIconId(value: string): value is GeoMapLucideIconId {
  return (GEO_MAP_LUCIDE_ICON_IDS as readonly string[]).includes(value)
}

export function normalizeGeoMapIconId(raw: unknown): GeoMapLucideIconId {
  if (typeof raw === 'string' && isGeoMapLucideIconId(raw)) {
    return raw
  }
  return DEFAULT_GEO_MAP_ICON
}
