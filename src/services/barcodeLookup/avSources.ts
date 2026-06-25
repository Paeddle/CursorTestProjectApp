import type { ProductLookupInput } from './types'

/** AV distributors and pro-AV retailers — prioritized for barcode and image lookup. */
export const AV_DISTRIBUTOR_HOSTS = [
  'adiglobaldistribution.com',
  'adiglobaldistribution.us',
  'snapone.com',
  'wesco.com',
  'bhphotovideo.com',
  'markertek.com',
  'fullcompass.com',
  'crutchfield.com',
  'cableorganizer.com',
  'circuitswest.com',
  'd-tools.com',
] as const

/** Common AV manufacturers — used for site-scoped product searches. */
export const AV_MANUFACTURER_HOSTS = [
  'lutron.com',
  'crestron.com',
  'control4.com',
  'extron.com',
  'shure.com',
  'sony.com',
  'samsung.com',
  'denon.com',
  'marantz.com',
  'jblpro.com',
  'qsc.com',
  'biamp.com',
  'savant.com',
  'urc.com',
  'rti.com',
  'legrand.us',
  'legrand.com',
  'josh.ai',
  'sonos.com',
  'klipsch.com',
  'polkaudio.com',
  'boseprofessional.com',
  'epson.com',
  'barco.com',
  'christiedigital.com',
  'peerless-av.com',
  'middleatlantic.com',
  'chiefmfg.com',
] as const

const DISTRIBUTOR_PATTERN = new RegExp(
  AV_DISTRIBUTOR_HOSTS.map((h) => h.replace(/\./g, '\\.')).join('|'),
  'i'
)
const MANUFACTURER_PATTERN = new RegExp(
  AV_MANUFACTURER_HOSTS.map((h) => h.replace(/\./g, '\\.')).join('|'),
  'i'
)

export function linkMatchesAvDistributor(url: string): boolean {
  return DISTRIBUTOR_PATTERN.test(url)
}

export function linkMatchesAvManufacturer(url: string): boolean {
  return MANUFACTURER_PATTERN.test(url)
}

export function linkMatchesAvSource(url: string): boolean {
  return linkMatchesAvDistributor(url) || linkMatchesAvManufacturer(url)
}

/** Guess manufacturer site from brand name for site: queries. */
export function manufacturerHostHint(manufacturer: string | null | undefined): string | null {
  const m = (manufacturer || '').trim().toLowerCase()
  if (!m) return null
  const aliases: Record<string, string> = {
    lutron: 'lutron.com',
    crestron: 'crestron.com',
    control4: 'control4.com',
    extron: 'extron.com',
    shure: 'shure.com',
    sony: 'sony.com',
    samsung: 'samsung.com',
    denon: 'denon.com',
    marantz: 'marantz.com',
    qsc: 'qsc.com',
    biamp: 'biamp.com',
    savant: 'savant.com',
    sonos: 'sonos.com',
    epson: 'epson.com',
    barco: 'barco.com',
    peerless: 'peerless-av.com',
    'peerless av': 'peerless-av.com',
    chief: 'chiefmfg.com',
    legrand: 'legrand.us',
    josh: 'josh.ai',
    klipsch: 'klipsch.com',
    polk: 'polkaudio.com',
    bose: 'boseprofessional.com',
  }
  for (const [key, host] of Object.entries(aliases)) {
    if (m.includes(key)) return host
  }
  return null
}

export function buildAvBarcodeSearchQueries(barcode: string): string[] {
  const code = barcode.replace(/\D/g, '')
  const queries = [
    `${code} site:adiglobaldistribution.com`,
    `${code} site:adiglobaldistribution.us`,
    `${code} site:snapone.com`,
    `${code} site:bhphotovideo.com`,
    `${code} site:markertek.com`,
    `${code} pro AV UPC`,
    `${code} barcode`,
  ]
  return [...new Set(queries)]
}

export function buildAvProductSearchQueries(input: ProductLookupInput): string[] {
  const part = (input.part_number || '').trim()
  const mfr = (input.manufacturer || '').trim()
  const item = (input.item || '').trim()
  const queries = new Set<string>()

  if (part) {
    queries.add(`${part} site:adiglobaldistribution.com`)
    queries.add(`${part} site:snapone.com`)
    queries.add(`${part} site:bhphotovideo.com`)
    if (mfr) {
      queries.add(`${mfr} ${part} UPC barcode`)
      queries.add(`${mfr} ${part} site:markertek.com`)
      const host = manufacturerHostHint(mfr)
      if (host) queries.add(`${part} site:${host}`)
    } else {
      queries.add(`${part} pro AV barcode UPC`)
    }
  }

  if (item && item !== part) {
    queries.add(`${mfr ? `${mfr} ` : ''}${item} site:adiglobaldistribution.com`)
    if (mfr) queries.add(`${mfr} ${item} product image`)
  }

  return [...queries].slice(0, 6)
}

export function buildAvImageSearchQueries(input: ProductLookupInput): string[] {
  const part = (input.part_number || '').trim()
  const mfr = (input.manufacturer || '').trim()
  const item = (input.item || '').trim()
  const label = [mfr, part || item].filter(Boolean).join(' ')
  const queries = new Set<string>()

  if (label) {
    queries.add(`${label} product`)
    queries.add(`${label} pro AV`)
  }
  if (part) {
    queries.add(`${part} site:adiglobaldistribution.com`)
    queries.add(`${part} site:bhphotovideo.com`)
    const host = manufacturerHostHint(mfr)
    if (host) queries.add(`${part} site:${host}`)
  }
  if (item && item !== part) {
    queries.add(`${mfr ? `${mfr} ` : ''}${item} product image`)
  }

  return [...queries].slice(0, 5)
}
