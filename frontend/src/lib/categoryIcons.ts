import { Bike, CircleDot, Cog, Disc3, Droplets, HardHat, Link2, Waves, Zap, type LucideIcon } from 'lucide-react'

const ICONS: Record<string, LucideIcon> = {
  'Engine parts': Cog, 'Drive & transmission': Link2, Brakes: Disc3, 'Electrical & lighting': Zap,
  'Suspension & steering': Waves, 'Wheels & tyres': CircleDot, 'Body & frame': Bike, 'Service parts': Droplets,
  Accessories: HardHat,
}

/** The icon for a top-level part category (a cog for any new ones). */
export function categoryIcon(name: string): LucideIcon {
  return ICONS[name] ?? Cog
}
