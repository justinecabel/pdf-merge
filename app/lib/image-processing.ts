import type { ImageStyle } from '../types';

export type BackgroundRemovalMode = NonNullable<ImageStyle['backgroundRemoval']>;
export type ImageEnhancementMode = NonNullable<ImageStyle['enhancement']>;

type ImagePreparationOptions = {
  /** Deprecated compatibility option for sessions created before background modes. */
  removeBackground?: boolean;
  backgroundRemoval?: BackgroundRemovalMode;
  enhancement?: ImageEnhancementMode;
  targetAspect?: number;
};

type PaletteColor = { r: number; g: number; b: number; tolerance: number };

const derivativeCache = new Map<string, Promise<string>>();
let aiProcessor: Promise<(dataUrl: string) => Promise<string>> | null = null;
let aiEnhancer: Promise<(dataUrl: string) => Promise<string>> | null = null;

function resolvedMode(options: ImagePreparationOptions): BackgroundRemovalMode {
  if (options.backgroundRemoval) return options.backgroundRemoval;
  return options.removeBackground === false ? 'off' : options.removeBackground ? 'auto' : 'off';
}

function resolvedEnhancement(options: ImagePreparationOptions): ImageEnhancementMode {
  return options.enhancement ?? 'off';
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('This image format could not be opened.'));
    image.src = dataUrl;
  });
}

function distance(data: Uint8ClampedArray, pixel: number, color: PaletteColor) {
  const offset = pixel * 4;
  return Math.hypot(data[offset] - color.r, data[offset + 1] - color.g, data[offset + 2] - color.b);
}

/** Builds a small palette from the image perimeter, including dark backgrounds. */
function edgePalette(data: Uint8ClampedArray, width: number, height: number) {
  const bins = new Map<string, { count: number; r: number; g: number; b: number }>();
  let samples = 0;
  const add = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    if (data[offset + 3] < 245) return;
    const r = data[offset]; const g = data[offset + 1]; const b = data[offset + 2];
    const key = `${r >> 3}:${g >> 3}:${b >> 3}`;
    const entry = bins.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    entry.count += 1; entry.r += r; entry.g += g; entry.b += b;
    bins.set(key, entry); samples += 1;
  };
  for (let x = 0; x < width; x += 1) { add(x, 0); if (height > 1) add(x, height - 1); }
  for (let y = 1; y < height - 1; y += 1) { add(0, y); if (width > 1) add(width - 1, y); }
  if (!samples) return null;
  const candidates = [...bins.values()].sort((a, b) => b.count - a.count).filter((item) => item.count / samples >= 0.04).slice(0, 4);
  const coverage = candidates.reduce((total, item) => total + item.count, 0) / samples;
  if (!candidates.length || coverage < 0.34) return null;
  return candidates.map((item) => ({ r: item.r / item.count, g: item.g / item.count, b: item.b / item.count, tolerance: 38 }));
}

export function removeAutoBackground(imageData: ImageData) {
  const { data, width, height } = imageData;
  const palette = edgePalette(data, width, height);
  if (!palette) return false;
  const total = width * height;
  const background = new Uint8Array(total);
  const matches = (pixel: number, additionalTolerance = 0) => {
    const alpha = data[pixel * 4 + 3];
    return alpha < 16 || palette.some((color) => distance(data, pixel, color) <= color.tolerance + additionalTolerance);
  };
  const queue: number[] = [];
  const push = (pixel: number) => {
    if (pixel < 0 || pixel >= total || background[pixel] || !matches(pixel)) return;
    background[pixel] = 1;
    queue.push(pixel);
  };
  for (let x = 0; x < width; x += 1) { push(x); push((height - 1) * width + x); }
  for (let y = 1; y < height - 1; y += 1) { push(y * width); push(y * width + width - 1); }

  // 8-connected flood fill keeps anti-aliased edges connected.
  const neighbours = [-width - 1, -width, -width + 1, -1, 1, width - 1, width, width + 1];
  while (queue.length) {
    const pixel = queue.pop()!;
    const x = pixel % width;
    for (const offset of neighbours) {
      const next = pixel + offset;
      if (next < 0 || next >= total || Math.abs((next % width) - x) > 1) continue;
      push(next);
    }
  }

  // Clear large matching regions isolated by a circular border, without removing
  // tiny letter counters or fine marks.
  const inspected = new Uint8Array(total);
  const minimumInteriorArea = Math.max(72, Math.round(total * 0.0025));
  for (let start = 0; start < total; start += 1) {
    if (background[start] || inspected[start] || !matches(start)) continue;
    const component = [start];
    inspected[start] = 1;
    const pixels: number[] = [];
    while (component.length) {
      const pixel = component.pop()!;
      pixels.push(pixel);
      const x = pixel % width;
      for (const offset of neighbours) {
        const next = pixel + offset;
        if (next < 0 || next >= total || inspected[next] || Math.abs((next % width) - x) > 1 || !matches(next)) continue;
        inspected[next] = 1;
        component.push(next);
      }
    }
    if (pixels.length >= minimumInteriorArea) pixels.forEach((pixel) => { background[pixel] = 1; });
  }

  let removed = 0;
  for (let pixel = 0; pixel < total; pixel += 1) {
    if (!background[pixel]) continue;
    data[pixel * 4 + 3] = 0;
    removed += 1;
  }
  if (removed < total * 0.01) return false;

  // A restrained one-pixel feather reduces hard halos without eating detail.
  for (let pixel = 0; pixel < total; pixel += 1) {
    if (background[pixel] || !matches(pixel, 16)) continue;
    const x = pixel % width;
    const touchesBackground = neighbours.some((offset) => {
      const next = pixel + offset;
      return next >= 0 && next < total && Math.abs((next % width) - x) <= 1 && background[next] === 1;
    });
    if (touchesBackground) data[pixel * 4 + 3] = Math.min(data[pixel * 4 + 3], 190);
  }
  return true;
}

async function createAiProcessor() {
  const { AutoModel, AutoProcessor, RawImage, env } = await import('@huggingface/transformers');
  if (env.backends.onnx.wasm) env.backends.onnx.wasm.proxy = false;
  const modelId = 'Xenova/modnet';
  const processor = await AutoProcessor.from_pretrained(modelId);
  let model;
  try {
    model = await AutoModel.from_pretrained(modelId, { device: 'webgpu' });
  } catch {
    model = await AutoModel.from_pretrained(modelId, { device: 'wasm' });
  }
  return async (dataUrl: string) => {
    const image = await RawImage.fromURL(dataUrl);
    const { pixel_values } = await processor(image);
    const result = await model({ input: pixel_values });
    const maskData = (await RawImage.fromTensor(result.output[0].mul(255).to('uint8')).resize(image.width, image.height)).data;
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Image processing is unavailable in this browser.');
    context.drawImage(image.toCanvas(), 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < maskData.length; index += 1) pixels.data[index * 4 + 3] = Math.min(pixels.data[index * 4 + 3], maskData[index]);
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL('image/png');
  };
}

async function removeAiBackground(dataUrl: string) {
  aiProcessor ??= createAiProcessor();
  return (await aiProcessor)(dataUrl);
}

async function createAiEnhancer() {
  const { AutoProcessor, RawImage, Swin2SRForImageSuperResolution } = await import('@huggingface/transformers');
  const modelId = 'Xenova/swin2SR-classical-sr-x2-64';
  const processor = await AutoProcessor.from_pretrained(modelId);
  let model;
  try {
    model = await Swin2SRForImageSuperResolution.from_pretrained(modelId, { device: 'webgpu' });
  } catch {
    model = await Swin2SRForImageSuperResolution.from_pretrained(modelId, { device: 'wasm' });
  }
  return async (dataUrl: string) => {
    const image = await RawImage.fromURL(dataUrl);
    const inputs = await processor(image);
    const outputs = await model(inputs);
    const output = outputs.reconstruction.squeeze().clamp_(0, 1).mul_(255).round_().to('uint8');
    const outputImage = RawImage.fromTensor(output);
    const canvas = document.createElement('canvas');
    canvas.width = outputImage.width;
    canvas.height = outputImage.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image enhancement is unavailable in this browser.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(outputImage.toCanvas(), 0, 0);
    return canvas.toDataURL('image/png');
  };
}

async function enhanceAiImage(dataUrl: string) {
  aiEnhancer ??= createAiEnhancer();
  return (await aiEnhancer)(dataUrl);
}

async function cropAndProcess(dataUrl: string, options: ImagePreparationOptions, mode: BackgroundRemovalMode) {
  const image = await loadImage(dataUrl);
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = image.naturalWidth;
  let sourceHeight = image.naturalHeight;
  if (options.targetAspect && options.targetAspect > 0) {
    const sourceAspect = sourceWidth / sourceHeight;
    if (sourceAspect > options.targetAspect) {
      sourceWidth = sourceHeight * options.targetAspect;
      sourceX = (image.naturalWidth - sourceWidth) / 2;
    } else {
      sourceHeight = sourceWidth / options.targetAspect;
      sourceY = (image.naturalHeight - sourceHeight) / 2;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth));
  canvas.height = Math.max(1, Math.round(sourceHeight));
  const context = canvas.getContext('2d', { willReadFrequently: mode === 'auto' });
  if (!context) throw new Error('Image processing is unavailable in this browser.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  if (mode === 'auto') {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    removeAutoBackground(pixels);
    context.putImageData(pixels, 0, 0);
  }
  return canvas.toDataURL('image/png');
}

/** Normalizes browser-decodable images and returns a cached transparent PNG derivative. */
export function imageDataUrlToPng(dataUrl: string, options: ImagePreparationOptions = {}) {
  const mode = resolvedMode(options);
  const enhancement = resolvedEnhancement(options);
  const aspect = options.targetAspect?.toFixed(5) ?? '';
  const key = `${enhancement}:${mode}:${aspect}:${dataUrl}`;
  let result = derivativeCache.get(key);
  if (!result) {
    result = (async () => {
      let source = dataUrl;
      if (enhancement === 'ai') {
        try {
          source = await enhanceAiImage(source);
        } catch {
          source = dataUrl;
        }
      }
      if (mode === 'ai') {
        try {
          const aiImage = await removeAiBackground(source);
          return cropAndProcess(aiImage, options, 'off');
        } catch {
          return cropAndProcess(source, options, 'off');
        }
      }
      return cropAndProcess(source, options, mode);
    })();
    derivativeCache.set(key, result);
  }
  return result;
}

export const imageBackgroundMode = (style: ImageStyle): BackgroundRemovalMode => style.backgroundRemoval ?? (style.removeBackground === false ? 'off' : 'auto');
export const imageEnhancementMode = (style: ImageStyle): ImageEnhancementMode => style.enhancement ?? 'off';
