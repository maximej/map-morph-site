import { geoMercatorRaw } from "d3-geo";
import { geoEckert4Raw } from "d3-geo-projection";

const MAX_MERCATOR_LATITUDE = 85.05112878 * Math.PI / 180;

export const safeMercatorRaw = (lambda, phi) =>
  geoMercatorRaw(lambda, Math.max(-MAX_MERCATOR_LATITUDE,
    Math.min(MAX_MERCATOR_LATITUDE, phi)));

export function interpolateRaw(a, b, t) {
  const clamped = Math.max(0, Math.min(1, t));
  return (lambda, phi) => {
    const p0 = a(lambda, phi), p1 = b(lambda, phi);
    return [p0[0] + (p1[0] - p0[0]) * clamped,
            p0[1] + (p1[1] - p0[1]) * clamped];
  };
}

export function planarRaw(t) {
  return interpolateRaw(safeMercatorRaw, geoEckert4Raw, t);
}
