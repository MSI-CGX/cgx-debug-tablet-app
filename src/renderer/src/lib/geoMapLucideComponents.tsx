import type { LucideIcon } from 'lucide-react'
import {
  Building2,
  Car,
  CircleDot,
  Crosshair,
  Flag,
  House,
  LocateFixed,
  MapPin,
  MapPinned,
  Mountain,
  Navigation,
  Plane,
  Radar,
  Ship,
  TreePine,
  Waypoints
} from 'lucide-react'
import {
  DEFAULT_GEO_MAP_ICON,
  type GeoMapLucideIconId
} from '../../../common/geoMapIcons'

export const GEO_MAP_LUCIDE_COMPONENTS: Record<GeoMapLucideIconId, LucideIcon> = {
  MapPin,
  MapPinned,
  Navigation,
  Mountain,
  TreePine,
  Building2,
  Car,
  Ship,
  Plane,
  CircleDot,
  Crosshair,
  Flag,
  House,
  LocateFixed,
  Radar,
  Waypoints
}

export function getGeoMapLucideComponent(id: GeoMapLucideIconId): LucideIcon {
  return GEO_MAP_LUCIDE_COMPONENTS[id] ?? GEO_MAP_LUCIDE_COMPONENTS[DEFAULT_GEO_MAP_ICON]
}
