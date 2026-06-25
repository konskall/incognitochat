import { describe, it, expect } from 'vitest';
import { parseNominatimCity } from './geocode';

describe('parseNominatimCity', () => {
  it('prefers city, then town/village/municipality/county/state', () => {
    expect(parseNominatimCity({ address: { city: 'Thessaloniki', state: 'Central Macedonia' } })).toBe('Thessaloniki');
    expect(parseNominatimCity({ address: { town: 'Katerini' } })).toBe('Katerini');
    expect(parseNominatimCity({ address: { village: 'Litochoro' } })).toBe('Litochoro');
    expect(parseNominatimCity({ address: { municipality: 'Pylaia-Chortiatis' } })).toBe('Pylaia-Chortiatis');
    expect(parseNominatimCity({ address: { county: 'Thessaloniki Regional Unit' } })).toBe('Thessaloniki Regional Unit');
    expect(parseNominatimCity({ address: { state: 'Attica' } })).toBe('Attica');
  });
  it('returns null when no usable field / malformed input', () => {
    expect(parseNominatimCity({ address: {} })).toBeNull();
    expect(parseNominatimCity({})).toBeNull();
    expect(parseNominatimCity(null)).toBeNull();
    expect(parseNominatimCity('nope')).toBeNull();
  });
});
