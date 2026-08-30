import { describe, expect, it } from 'vitest';
import { applyInverseTransform, fieldFrame, normalizeRotation, uniqueFieldName } from './geometry';

describe('geometry', () => {
  it('maps a visual rectangle to a standard PDF coordinate system', () => {
    const frame = fieldFrame(
      { x: 0.25, y: 0.5, width: 0.5, height: 0.25 },
      { width: 612, height: 792, transform: [1, 0, 0, -1, 0, 792] },
      0,
    );
    expect(frame.origin.x).toBeCloseTo(153);
    expect(frame.origin.y).toBeCloseTo(198);
    expect(frame.width).toBeCloseTo(306);
    expect(frame.height).toBeCloseTo(198);
    expect(frame.angle).toBeCloseTo(0);
  });

  it('uses the inverse page transform for rotated PDF pages', () => {
    const point = applyInverseTransform({ x: 0, y: 612 }, [0, 1, 1, 0, 0, 0]);
    expect(point.x).toBeCloseTo(612);
    expect(point.y).toBeCloseTo(0);
    const frame = fieldFrame(
      { x: 0, y: 0, width: 1, height: 1 },
      { width: 792, height: 612, transform: [0, 1, 1, 0, 0, 0] },
      0,
    );
    expect(frame.angle).toBeCloseTo(90);
  });

  it('normalizes rotation and creates unique column names', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(uniqueFieldName('Text', ['Text', 'Text 2'])).toBe('Text 3');
    expect(uniqueFieldName('Image', [])).toBe('Image');
  });
});
