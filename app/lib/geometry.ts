import type { NormalizedRect, PageGeometry } from '../types';

export type Point = { x: number; y: number };

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeRotation(value: number) {
  return ((Math.round(value) % 360) + 360) % 360;
}

export function applyInverseTransform(
  point: Point,
  transform: PageGeometry['transform'],
): Point {
  const [a, b, c, d, e, f] = transform;
  const determinant = a * d - b * c;
  return {
    x: (d * (point.x - e) - c * (point.y - f)) / determinant,
    y: (-b * (point.x - e) + a * (point.y - f)) / determinant,
  };
}

export function rotateVisualPoint(point: Point, center: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

export function fieldFrame(rect: NormalizedRect, geometry: PageGeometry, rotation: number) {
  const left = rect.x * geometry.width;
  const top = rect.y * geometry.height;
  const width = rect.width * geometry.width;
  const height = rect.height * geometry.height;
  const center = { x: left + width / 2, y: top + height / 2 };
  const localBottomLeft = rotateVisualPoint(
    { x: left, y: top + height },
    center,
    rotation,
  );
  const localRight = rotateVisualPoint(
    { x: left + width, y: top + height },
    center,
    rotation,
  );
  const origin = applyInverseTransform(localBottomLeft, geometry.transform);
  const right = applyInverseTransform(localRight, geometry.transform);
  const angle = (Math.atan2(right.y - origin.y, right.x - origin.x) * 180) / Math.PI;
  return { origin, angle, width, height, center, left, top };
}

export function uniqueFieldName(base: string, existing: string[]) {
  if (!existing.includes(base)) return base;
  let index = 2;
  while (existing.includes(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}
