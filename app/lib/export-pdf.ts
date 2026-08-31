import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFFont, degrees, rgb } from 'pdf-lib';
import { fieldFrame } from './geometry';
import { imageBackgroundMode, imageDataUrlToPng, imageEnhancementMode } from './image-processing';
import type { CustomFont, ImageCellValue, MergeRow, PageGeometry, TemplateField } from '../types';

const assetBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const fontAsset = (filename: string) => `${assetBasePath}/fonts/${filename}`;

const FONT_FILES = {
  'Noto Sans-regular': fontAsset('NotoSans-Regular.ttf'),
  'Noto Sans-bold': fontAsset('NotoSans-Bold.ttf'),
  'Noto Serif-regular': fontAsset('NotoSerif-Regular.ttf'),
  'Noto Serif-bold': fontAsset('NotoSerif-Bold.ttf'),
  'Noto Sans Mono-regular': fontAsset('NotoSansMono-Regular.ttf'),
  'Noto Sans Mono-bold': fontAsset('NotoSansMono-Bold.ttf'),
} as const;

type FontKey = keyof typeof FONT_FILES;

function fieldFontKey(field: Extract<TemplateField, { type: 'text' }>) {
  return field.style.fontFileId
    ? `custom:${field.style.fontFileId}`
    : `builtin:${field.style.fontFamily || 'Noto Sans'}-${field.style.fontWeight || 'regular'}`;
}

export type ExportProgress = {
  completed: number;
  total: number;
  percent: number;
};

function parseHexColor(hex: string) {
  const normalized = hex.replace('#', '');
  const value = Number.parseInt(normalized.length === 3
    ? normalized.split('').map((part) => part + part).join('')
    : normalized, 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

function imageValue(value: unknown): value is ImageCellValue {
  return Boolean(value && typeof value === 'object' && (value as ImageCellValue).kind === 'image');
}

async function fetchBytes(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load required font: ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

function dataUrlToBytes(dataUrl: string) {
  const base64 = dataUrl.split(',')[1] ?? '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function fitText(
  value: string,
  font: Pick<PDFFont, 'widthOfTextAtSize'>,
  preferredSize: number,
  minimumSize: number,
  width: number,
  height: number,
  lineHeight: number,
) {
  const sourceLines = value.replace(/\r/g, '').split('\n');
  let size = preferredSize;
  const fits = (candidate: number) => {
    const widest = Math.max(0, ...sourceLines.map((line) => font.widthOfTextAtSize(line, candidate)));
    return widest <= width && sourceLines.length * candidate * lineHeight <= height;
  };
  while (size > minimumSize && !fits(size)) size = Math.max(minimumSize, size - 0.5);

  const maxLines = Math.max(1, Math.floor(height / (size * lineHeight)));
  return sourceLines.slice(0, maxLines).map((line) => {
    if (font.widthOfTextAtSize(line, size) <= width) return line;
    let clipped = line;
    while (clipped && font.widthOfTextAtSize(clipped, size) > width) clipped = clipped.slice(0, -1);
    return clipped;
  }).filter((line, index) => line.length > 0 || index === 0);
}

export async function generateMergedPdf(
  sourceBytes: Uint8Array,
  fields: TemplateField[],
  rows: MergeRow[],
  geometries: PageGeometry[],
  onProgress?: (progress: ExportProgress) => void,
  customFonts: CustomFont[] = [],
  templatePageImages: Record<number, string> = {},
) {
  if (!rows.length) throw new Error('Add at least one row before exporting.');
  const source = await PDFDocument.load(sourceBytes);
  const output = await PDFDocument.create();
  output.registerFontkit(fontkit);

  const fontKeys = [...new Set(fields.filter((field): field is Extract<TemplateField, { type: 'text' }> => field.type === 'text').map(fieldFontKey))];
  const fontEntries = await Promise.all(fontKeys.map(async (key) => {
    const fontBytes = key.startsWith('custom:')
      ? customFonts.find((font) => font.id === key.slice('custom:'.length))?.bytes
      : await fetchBytes(FONT_FILES[key.slice('builtin:'.length) as FontKey]);
    if (!fontBytes) throw new Error('A selected custom font is no longer available. Choose it again.');
    return [key, await output.embedFont(fontBytes, { subset: true })] as const;
  }));
  const fonts = new Map<string, PDFFont>(fontEntries);
  const imageCache = new Map<string, Awaited<ReturnType<typeof output.embedPng>>>();
  const templatePageCache = new Map<string, Awaited<ReturnType<typeof output.embedPng>>>();
  const pageIndexes = source.getPageIndices();
  const total = rows.length * pageIndexes.length;
  let completed = 0;

  for (const row of rows) {
    const copiedPages = await output.copyPages(source, pageIndexes);
    copiedPages.forEach((page) => output.addPage(page));
    for (let sourcePageIndex = 0; sourcePageIndex < copiedPages.length; sourcePageIndex += 1) {
      const page = copiedPages[sourcePageIndex];
      const geometry = geometries[sourcePageIndex];
      if (!geometry) continue;
      const templatePage = templatePageImages[sourcePageIndex];
      if (templatePage) {
        let templateImage = templatePageCache.get(templatePage);
        if (!templateImage) {
          templateImage = await output.embedPng(dataUrlToBytes(templatePage));
          templatePageCache.set(templatePage, templateImage);
        }
        page.drawImage(templateImage, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
      }
      const pageFields = fields.filter((field) => field.pageIndex === sourcePageIndex).sort((a, b) => a.layerIndex - b.layerIndex);
      for (const field of pageFields) {
        const value = row.values[field.id];
        if (field.type === 'text') {
          if (typeof value !== 'string' || !value) continue;
          const key = fieldFontKey(field);
          const font = fonts.get(key);
          if (!font) continue;
          const frame = fieldFrame(field.rect, geometry, field.rotation);
          const lines = fitText(value, font, field.style.fontSize, field.style.minFontSize, frame.width, frame.height, field.style.lineHeight);
          const angleRadians = (frame.angle * Math.PI) / 180;
          const xAxis = { x: Math.cos(angleRadians), y: Math.sin(angleRadians) };
          const yAxis = { x: -Math.sin(angleRadians), y: Math.cos(angleRadians) };
          const size = (() => {
            let candidate = field.style.fontSize;
            const sourceLines = value.replace(/\r/g, '').split('\n');
            while (candidate > field.style.minFontSize) {
              const widest = Math.max(...sourceLines.map((line) => font.widthOfTextAtSize(line, candidate)), 0);
              if (widest <= frame.width && sourceLines.length * candidate * field.style.lineHeight <= frame.height) break;
              candidate = Math.max(field.style.minFontSize, candidate - 0.5);
            }
            return candidate;
          })();
          lines.forEach((line, lineIndex) => {
            const lineWidth = font.widthOfTextAtSize(line, size);
            const alignOffset = field.style.align === 'center' ? (frame.width - lineWidth) / 2 : field.style.align === 'right' ? frame.width - lineWidth : 0;
            const verticalOffset = frame.height - size - lineIndex * size * field.style.lineHeight;
            page.drawText(line, {
              x: frame.origin.x + xAxis.x * alignOffset + yAxis.x * verticalOffset,
              y: frame.origin.y + xAxis.y * alignOffset + yAxis.y * verticalOffset,
              font,
              size,
              color: parseHexColor(field.style.color),
              rotate: degrees(frame.angle),
            });
          });
        } else if (imageValue(value)) {
          const frame = fieldFrame(field.rect, geometry, field.rotation);
          const backgroundRemoval = imageBackgroundMode(field.style);
          const enhancement = imageEnhancementMode(field.style);
          const cacheKey = `${value.dataUrl}:${field.style.fit}:${enhancement}:${backgroundRemoval}:${frame.width.toFixed(3)}:${frame.height.toFixed(3)}`;
          let image = imageCache.get(cacheKey);
          if (!image) {
            const dataUrl = backgroundRemoval !== 'off' || enhancement !== 'off' || field.style.fit === 'cover'
              ? await imageDataUrlToPng(value.dataUrl, {
                backgroundRemoval,
                enhancement,
                targetAspect: field.style.fit === 'cover' ? frame.width / frame.height : undefined,
              })
              : value.dataUrl;
            image = await output.embedPng(dataUrlToBytes(dataUrl));
            imageCache.set(cacheKey, image);
          }
          let drawWidth = frame.width;
          let drawHeight = frame.height;
          if (field.style.fit === 'contain') {
            const ratio = Math.min(frame.width / image.width, frame.height / image.height);
            drawWidth = image.width * ratio;
            drawHeight = image.height * ratio;
          }
          const angleRadians = (frame.angle * Math.PI) / 180;
          const xAxis = { x: Math.cos(angleRadians), y: Math.sin(angleRadians) };
          const yAxis = { x: -Math.sin(angleRadians), y: Math.cos(angleRadians) };
          const offsetX = (frame.width - drawWidth) / 2;
          const offsetY = (frame.height - drawHeight) / 2;
          page.drawImage(image, {
            x: frame.origin.x + xAxis.x * offsetX + yAxis.x * offsetY,
            y: frame.origin.y + xAxis.y * offsetX + yAxis.y * offsetY,
            width: drawWidth,
            height: drawHeight,
            rotate: degrees(frame.angle),
            opacity: field.style.opacity,
          });
        }
      }
      completed += 1;
      onProgress?.({ completed, total, percent: Math.round((completed / total) * 100) });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }
  return output.save({ useObjectStreams: true });
}

export function downloadFile(bytes: Uint8Array, filename: string, type: string) {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function downloadPdf(bytes: Uint8Array, filename: string) {
  downloadFile(bytes, filename, 'application/pdf');
}

export function openPrintablePdf(bytes: Uint8Array, target?: Window | null) {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const opened = target ?? window.open('about:blank', '_blank');
  if (!opened) {
    URL.revokeObjectURL(url);
    throw new Error('Allow pop-ups to open the printable PDF.');
  }
  opened.opener = null;
  opened.location.href = url;
  window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
}
