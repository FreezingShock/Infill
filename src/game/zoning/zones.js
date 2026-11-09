// Zone paints, in plain words. Each paint is one of the engine's zone codes, so lots keep working with
// every template, setback and height rule. `kind` says which demand bar a paint listens to.
const ZONE_PAINTS = [
  { id: 'low', name: 'Houses', z: 'R1-1', kind: 'homes', col: 0xf2dfa2, blurb: 'Detached homes, up to 2 storeys' },
  { id: 'mid', name: 'Townhomes and small multi', z: 'R2-1', kind: 'homes', col: 0xf0b27a, blurb: 'Duplexes and courts, up to 3 storeys' },
  { id: 'apts', name: 'Apartments', z: 'R3-1', kind: 'homes', col: 0xe08a5a, blurb: 'Courtyard and mid-rise apartments, up to 4 storeys' },
  { id: 'mixed', name: 'Shops and homes', z: 'RAS4-1', kind: 'shops', col: 0xc9735b, blurb: 'Shops below, homes above, up to 5 storeys' },
  { id: 'shops', name: 'Main street', z: 'C2-1VL', kind: 'shops', col: 0xd3615a, blurb: 'Shops, cafes and offices, up to 4 storeys' },
  { id: 'park', name: 'Parks and plazas', z: 'OS-1', kind: 'civic', col: 0x7fb069, blurb: 'Green space, always welcome' },
  { id: 'civic', name: 'Civic', z: 'PF-1', kind: 'civic', col: 0x7d9fc9, blurb: 'Libraries, courts and play space' },
];
const PAINT_BY_Z = Object.fromEntries(ZONE_PAINTS.map((p) => [p.z, p]));
const KIND_OF_FAMILY = { R1: 'homes', RE11: 'homes', R2: 'homes', R3: 'homes', RAS4: 'shops', C2: 'shops', P: 'civic', PF: 'civic', OS: 'civic' };

export { KIND_OF_FAMILY, PAINT_BY_Z, ZONE_PAINTS };
