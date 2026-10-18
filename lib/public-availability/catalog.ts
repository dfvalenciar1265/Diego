/**
 * Catálogo fijo del sitio Casa Blue Cartagena. Los IDs y capacidades los confirmó Diego; nunca se
 * buscan apartamentos por nombre. El orden es el que espera el sitio. Los IDs no salen jamás en
 * la respuesta pública: solo el slug.
 */
export interface CatalogUnit {
  slug: string
  capacity: number
  propertyId: string
}

export const CASA_BLUE_CATALOG: readonly CatalogUnit[] = Object.freeze([
  { slug: 'mar-adentro-1305', capacity: 6, propertyId: '0b6170ff-6049-4e21-b6bc-c4237cc2c0f6' },
  { slug: 'torres-del-lago-1303', capacity: 8, propertyId: '4b10f347-cf1b-4b89-81b6-b73c41d697a3' },
  { slug: 'crespo-1214', capacity: 4, propertyId: '2be6deec-8061-453e-b1ae-ce0bd177fadd' },
  { slug: 'conquistador-1821', capacity: 8, propertyId: 'b73c70dd-204b-42f1-a1e1-674de53eca84' },
  { slug: 'marina-del-rey-1104', capacity: 5, propertyId: '823591d2-e4a9-4893-bd01-f1394a38545d' },
  { slug: 'palmetto-1001', capacity: 6, propertyId: '097d3266-e9d6-4ed0-a403-6dd051c5d042' },
  { slug: 'tocahagua-1208', capacity: 4, propertyId: '66a7c1ee-2117-4178-890e-181cd904778c' },
  { slug: 'tocahagua-708', capacity: 4, propertyId: '6a878ed2-148b-4078-9f66-90aab3e76b19' },
].map(u => Object.freeze(u)))

export const CATALOG_PROPERTY_IDS: readonly string[] = CASA_BLUE_CATALOG.map(u => u.propertyId)
