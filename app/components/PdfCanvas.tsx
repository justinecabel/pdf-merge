'use client';

import type { PDFPageProxy } from 'pdfjs-dist';
import { ImageIcon, RotateCw } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { clamp, normalizeRotation } from '../lib/geometry';
import { imageBackgroundMode, imageDataUrlToPng, imageEnhancementMode } from '../lib/image-processing';
import type { CustomFont, MergeRow, NormalizedRect, TemplateField } from '../types';

type Props = {
  page: PDFPageProxy | null;
  zoom: number;
  fields: TemplateField[];
  row: MergeRow | null;
  customFonts: CustomFont[];
  selectedIds: string[];
  placementMode?: 'text' | 'image' | null;
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: Partial<TemplateField>) => void;
  onDelete: (id: string) => void;
  onFieldContextMenu: (fieldId: string, position: { x: number; y: number }) => void;
  onPlace?: (type: 'text' | 'image', point: { x: number; y: number }) => void;
  onNudge?: (fieldId: string, dx: number, dy: number) => void;
  interactive?: boolean;
};

function FittedTextPreview({
  value, fontFamily, fontWeight, preferredSize, minimumSize, color, align, lineHeight, fitKey,
}: {
  value: string;
  fontFamily: string;
  fontWeight: 400 | 700;
  preferredSize: number;
  minimumSize: number;
  color: string;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  fitKey: string;
}) {
  const textRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const text = textRef.current;
    if (!text) return;
    let size = preferredSize;
    text.style.fontSize = `${size}px`;
    while (size > minimumSize && (text.scrollWidth > text.clientWidth || text.scrollHeight > text.clientHeight)) {
      size = Math.max(minimumSize, size - 0.5);
      text.style.fontSize = `${size}px`;
    }
  }, [fitKey, fontFamily, fontWeight, lineHeight, minimumSize, preferredSize, value]);

  return <span ref={textRef} className="field-text-preview" style={{
    fontFamily, fontWeight, fontSize: `${preferredSize}px`, color, textAlign: align, lineHeight,
  }}>{value}</span>;
}

function TextFieldPlaceholder({ name }: { name: string }) {
  return <span className="field-name-placeholder"><span>Text field</span><strong>{name}</strong></span>;
}

function PreparedImagePreview({ dataUrl, fit, opacity, backgroundRemoval, enhancement, targetAspect }: { dataUrl: string; fit: 'contain' | 'cover'; opacity: number; backgroundRemoval: 'auto' | 'ai' | 'off'; enhancement: 'off' | 'ai'; targetAspect?: number }) {
  const [prepared, setPrepared] = useState<{ source: string; url: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (backgroundRemoval === 'off' && enhancement === 'off') return () => { cancelled = true; };
    void imageDataUrlToPng(dataUrl, { backgroundRemoval, enhancement, targetAspect }).then((prepared) => {
      if (!cancelled) {
        setPrepared({ source: dataUrl, url: prepared });
      }
    }).catch(() => {
      if (!cancelled) {
        setPrepared(null);
      }
    });
    return () => { cancelled = true; };
  }, [backgroundRemoval, dataUrl, enhancement, targetAspect]);
  const previewUrl = (backgroundRemoval !== 'off' || enhancement !== 'off') && prepared?.source === dataUrl ? prepared.url : dataUrl;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={`field-image-preview ${fit}`} src={previewUrl} alt="" style={{ opacity }} />;
}

export function PdfCanvas({ page, zoom, fields, row, customFonts, selectedIds, placementMode = null, onSelect, onChange, onDelete, onFieldContextMenu, onPlace, onNudge, interactive = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const viewport = useMemo(() => page ? page.getViewport({ scale: zoom }) : { width: 0, height: 0 }, [page, zoom]);

  useEffect(() => {
    if (!page || !canvasRef.current) return;
    const canvas = canvasRef.current;
    let cancelled = false;
    const pixelRatio = Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 2);
    const renderViewport = page.getViewport({ scale: zoom * pixelRatio });
    const renderCanvas = document.createElement('canvas');
    renderCanvas.width = Math.floor(renderViewport.width);
    renderCanvas.height = Math.floor(renderViewport.height);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const context = renderCanvas.getContext('2d');
    if (!context) return;
    const task = page.render({ canvas: renderCanvas, canvasContext: context, viewport: renderViewport });
    void task.promise.then(() => {
      if (cancelled || !canvas.isConnected) return;
      canvas.width = renderCanvas.width;
      canvas.height = renderCanvas.height;
      canvas.getContext('2d')?.drawImage(renderCanvas, 0, 0);
    }).catch(() => undefined);
    return () => { cancelled = true; task.cancel(); };
  }, [page, viewport.height, viewport.width, zoom]);

  const updateRect = (id: string, rect: NormalizedRect) => onChange(id, { rect } as Partial<TemplateField>);

  const startMove = (event: React.PointerEvent, field: TemplateField) => {
    if (!stageRef.current || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(field.id);
    const startX = event.clientX;
    const startY = event.clientY;
    const initial = field.rect;
    const move = (next: PointerEvent) => {
      const dx = (next.clientX - startX) / viewport.width;
      const dy = (next.clientY - startY) / viewport.height;
      updateRect(field.id, {
        ...initial,
        x: clamp(initial.x + dx, 0, 1 - initial.width),
        y: clamp(initial.y + dy, 0, 1 - initial.height),
      });
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
  };

  const startResize = (event: React.PointerEvent, field: TemplateField) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(field.id);
    const startX = event.clientX;
    const startY = event.clientY;
    const initial = field.rect;
    const move = (next: PointerEvent) => updateRect(field.id, {
      ...initial,
      width: clamp(initial.width + (next.clientX - startX) / viewport.width, 0.035, 1 - initial.x),
      height: clamp(initial.height + (next.clientY - startY) / viewport.height, 0.025, 1 - initial.y),
    });
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
  };

  const startRotate = (event: React.PointerEvent, field: TemplateField) => {
    if (!stageRef.current || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(field.id);
    const bounds = stageRef.current.getBoundingClientRect();
    const centerX = bounds.left + (field.rect.x + field.rect.width / 2) * viewport.width;
    const centerY = bounds.top + (field.rect.y + field.rect.height / 2) * viewport.height;
    const move = (next: PointerEvent) => {
      const angle = (Math.atan2(next.clientY - centerY, next.clientX - centerX) * 180) / Math.PI + 90;
      onChange(field.id, { rotation: normalizeRotation(angle) } as Partial<TemplateField>);
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
  };

  const handleKey = (event: React.KeyboardEvent, field: TemplateField) => {
    const step = event.shiftKey ? 0.01 : 0.002;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onDelete(field.id);
      return;
    }
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    if (onNudge) onNudge(field.id, delta[0], delta[1]);
    else updateRect(field.id, {
      ...field.rect,
      x: clamp(field.rect.x + delta[0], 0, 1 - field.rect.width),
      y: clamp(field.rect.y + delta[1], 0, 1 - field.rect.height),
    });
  };

  if (!page) return <div className="page-loading">Rendering page…</div>;

  return (
    <div
      ref={stageRef}
      className={`page-stage${interactive ? '' : ' read-only'}${placementMode ? ` placing placing-${placementMode}` : ''}`}
      style={{ width: viewport.width, height: viewport.height }}
      onPointerDown={interactive ? (event) => {
        if (placementMode && event.button === 0 && (event.target === event.currentTarget || event.target instanceof HTMLCanvasElement)) {
          const bounds = event.currentTarget.getBoundingClientRect();
          event.preventDefault();
          onPlace?.(placementMode, { x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1), y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1) });
          return;
        }
        onSelect(null);
      } : undefined}
    >
      <canvas ref={canvasRef} aria-label="PDF page preview" />
      {fields.map((field) => {
        const value = row?.values[field.id];
        const selected = selectedIds.includes(field.id);
        const previewFamily = field.type === 'text' && field.style.fontFileId
          ? customFonts.find((font) => font.id === field.style.fontFileId)?.previewFamily ?? field.style.fontFamily
          : field.type === 'text' ? field.style.fontFamily : '';
        return (
          <div
            key={field.id}
            className={`field-box${selected ? ' selected' : ''}`}
            style={{
              left: `${field.rect.x * 100}%`, top: `${field.rect.y * 100}%`,
              width: `${field.rect.width * 100}%`, height: `${field.rect.height * 100}%`,
              transform: `rotate(${field.rotation}deg)`, zIndex: 2 + field.layerIndex,
            }}
            tabIndex={interactive ? 0 : -1}
            role={interactive ? 'button' : undefined}
            aria-label={`${field.name} field`}
            onKeyDown={interactive ? (event) => handleKey(event, field) : undefined}
            onPointerDown={interactive ? (event) => startMove(event, field) : undefined}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const nativeEvent = event.nativeEvent as PointerEvent;
              if (interactive && nativeEvent.pointerType !== 'touch' && event.button === 2) {
                onFieldContextMenu(field.id, { x: event.clientX, y: event.clientY });
              }
            }}
          >
            {field.type === 'image' && <span className="field-tag">{field.name}</span>}
            {field.type === 'text' ? interactive ? <TextFieldPlaceholder name={field.name} /> : (
              <FittedTextPreview
                value={typeof value === 'string' && value ? value : field.name}
                fontFamily={previewFamily}
                fontWeight={field.style.fontWeight === 'bold' ? 700 : 400}
                preferredSize={Math.max(1, field.style.fontSize * zoom)}
                minimumSize={Math.max(1, field.style.minFontSize * zoom)}
                color={field.style.color}
                align={field.style.align}
                lineHeight={field.style.lineHeight}
                fitKey={`${field.rect.width}:${field.rect.height}:${zoom}`}
              />
            ) : (
              value && typeof value === 'object' && value.kind === 'image'
                ? <PreparedImagePreview dataUrl={value.dataUrl} fit={field.style.fit} opacity={field.style.opacity} backgroundRemoval={imageBackgroundMode(field.style)} enhancement={imageEnhancementMode(field.style)} targetAspect={field.style.fit === 'cover' ? (field.rect.width * viewport.width) / (field.rect.height * viewport.height) : undefined} />
                : <span className="image-placeholder"><ImageIcon size={16} /></span>
            )}
            {interactive && selected && <>
              <button className="rotate-handle" aria-label="Rotate field" onPointerDown={(event) => startRotate(event, field)}><RotateCw size={11} /></button>
              <span className="resize-handle" onPointerDown={(event) => startResize(event, field)} />
            </>}
          </div>
        );
      })}
    </div>
  );
}
