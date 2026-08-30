import { describe, expect, it } from 'vitest';
import { removeAutoBackground } from './image-processing';

function image(width: number, height: number, color: [number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    data[pixel * 4] = color[0]; data[pixel * 4 + 1] = color[1]; data[pixel * 4 + 2] = color[2]; data[pixel * 4 + 3] = 255;
  }
  return { data, width, height } as ImageData;
}

function setPixel(imageData: ImageData, x: number, y: number, color: [number, number, number]) {
  const offset = (y * imageData.width + x) * 4;
  imageData.data[offset] = color[0]; imageData.data[offset + 1] = color[1]; imageData.data[offset + 2] = color[2]; imageData.data[offset + 3] = 255;
}

describe('removeAutoBackground', () => {
  it('removes a dark edge background but retains a foreground mark', () => {
    const sample = image(20, 20, [0, 0, 0]);
    for (let y = 7; y < 13; y += 1) for (let x = 7; x < 13; x += 1) setPixel(sample, x, y, [220, 40, 35]);
    expect(removeAutoBackground(sample)).toBe(true);
    expect(sample.data[3]).toBe(0);
    expect(sample.data[(10 * 20 + 10) * 4 + 3]).toBe(255);
  });

  it('clears a large matching background region enclosed by a circle-like border', () => {
    const sample = image(28, 28, [255, 255, 255]);
    for (let x = 4; x <= 23; x += 1) { setPixel(sample, x, 4, [20, 20, 20]); setPixel(sample, x, 23, [20, 20, 20]); }
    for (let y = 4; y <= 23; y += 1) { setPixel(sample, 4, y, [20, 20, 20]); setPixel(sample, 23, y, [20, 20, 20]); }
    expect(removeAutoBackground(sample)).toBe(true);
    expect(sample.data[(14 * 28 + 14) * 4 + 3]).toBe(0);
    expect(sample.data[(4 * 28 + 14) * 4 + 3]).toBe(255);
  });

  it('preserves a small contrasting text-like detail', () => {
    const sample = image(20, 20, [245, 245, 245]);
    setPixel(sample, 10, 10, [10, 10, 10]);
    expect(removeAutoBackground(sample)).toBe(true);
    expect(sample.data[(10 * 20 + 10) * 4 + 3]).toBe(255);
  });
});
