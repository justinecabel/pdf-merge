'use client';

import type { PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  ArrowLeft, ArrowRight, Check, ChevronDown, Copy, Download, FileText, ImageIcon,
  GripVertical, Hand, Layers3, Minus, Plus, Printer, RotateCcw, SlidersHorizontal, Trash2, Type, X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AllPagesCanvas } from './components/AllPagesCanvas';
import { ReviewPagePreview } from './components/ReviewPagePreview';
import { clamp, uniqueFieldName } from './lib/geometry';
import { imageDataUrlToPng } from './lib/image-processing';
import type { CellValue, CustomFont, ImageCellValue, MergeRow, PageGeometry, TemplateField } from './types';

const createId = () => crypto.randomUUID();
const createRow = (): MergeRow => ({ id: createId(), values: {} });
type CanvasContextMenu =
  | { kind: 'page'; pageIndex: number; x: number; y: number }
  | { kind: 'field'; fieldId: string; x: number; y: number };

type DeviceFontSource = {
  family: string;
  fullName: string;
  style: string;
  postscriptName: string;
  blob: () => Promise<Blob>;
};

type DeviceFontWindow = Window & {
  queryLocalFonts?: () => Promise<DeviceFontSource[]>;
};

function ImageCell({ value, onChange }: { value: CellValue; onChange: (value: ImageCellValue | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const image = value && typeof value === 'object' && value.kind === 'image' ? value : null;
  const chooseFile = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/') && !/\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(file.name)) {
      window.alert('Please choose an image file.');
      return;
    }
    const sourceDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Could not read this image.'));
      reader.readAsDataURL(file);
    });
    try {
      onChange({ kind: 'image', name: file.name, dataUrl: await imageDataUrlToPng(sourceDataUrl) });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'This image format could not be opened.');
    }
  };
  return (
    <div className="image-cell">
      <input ref={inputRef} type="file" accept="image/*,.svg" hidden onChange={(event) => { void chooseFile(event.target.files?.[0]); event.target.value = ''; }} />
      <button className="cell-file" title={image?.name} onClick={() => inputRef.current?.click()}>
        {image ? <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.dataUrl} alt="" /><span>{image.name}</span>
        </> : <><ImageIcon size={13} /><span>Choose image</span></>}
      </button>
      {image && <button className="cell-clear" aria-label="Clear image" onClick={() => onChange(null)}><X size={12} /></button>}
    </div>
  );
}

type ScrollMetrics = {
  clientWidth: number;
  clientHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  scrollLeft: number;
  scrollTop: number;
};

function CanvasScrollbars({ targetRef }: { targetRef: RefObject<HTMLElement | null> }) {
  const horizontalRef = useRef<HTMLDivElement>(null);
  const verticalRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ axis: 'horizontal' | 'vertical'; start: number; scrollStart: number; available: number; maxScroll: number } | null>(null);
  const [metrics, setMetrics] = useState<ScrollMetrics>({ clientWidth: 0, clientHeight: 0, scrollWidth: 0, scrollHeight: 0, scrollLeft: 0, scrollTop: 0 });

  const updateMetrics = useCallback(() => {
    const target = targetRef.current;
    if (!target) return;
    setMetrics({
      clientWidth: target.clientWidth,
      clientHeight: target.clientHeight,
      scrollWidth: target.scrollWidth,
      scrollHeight: target.scrollHeight,
      scrollLeft: target.scrollLeft,
      scrollTop: target.scrollTop,
    });
  }, [targetRef]);

  useLayoutEffect(() => {
    const target = targetRef.current;
    if (!target || typeof ResizeObserver === 'undefined') return;
    const resizeObserver = new ResizeObserver(updateMetrics);
    const observeContent = () => {
      resizeObserver.disconnect();
      resizeObserver.observe(target);
      if (target.firstElementChild) resizeObserver.observe(target.firstElementChild);
      updateMetrics();
    };
    const mutationObserver = new MutationObserver(observeContent);
    observeContent();
    mutationObserver.observe(target, { childList: true, subtree: false });
    target.addEventListener('scroll', updateMetrics, { passive: true });
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      target.removeEventListener('scroll', updateMetrics);
    };
  }, [targetRef, updateMetrics]);

  const horizontalMax = Math.max(0, metrics.scrollWidth - metrics.clientWidth);
  const verticalMax = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
  const horizontalSize = horizontalMax ? Math.max(8, metrics.clientWidth / metrics.scrollWidth * 100) : 100;
  const verticalSize = verticalMax ? Math.max(8, metrics.clientHeight / metrics.scrollHeight * 100) : 100;
  const horizontalPosition = horizontalMax ? metrics.scrollLeft / horizontalMax * (100 - horizontalSize) : 0;
  const verticalPosition = verticalMax ? metrics.scrollTop / verticalMax * (100 - verticalSize) : 0;

  const startDrag = (axis: 'horizontal' | 'vertical', event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const target = targetRef.current;
    const track = axis === 'horizontal' ? horizontalRef.current : verticalRef.current;
    if (!target || !track) return;
    const trackLength = axis === 'horizontal' ? track.clientWidth : track.clientHeight;
    const size = axis === 'horizontal' ? horizontalSize : verticalSize;
    const available = trackLength * (1 - size / 100);
    const maxScroll = axis === 'horizontal' ? horizontalMax : verticalMax;
    if (!available || !maxScroll) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      axis,
      start: axis === 'horizontal' ? event.clientX : event.clientY,
      scrollStart: axis === 'horizontal' ? target.scrollLeft : target.scrollTop,
      available,
      maxScroll,
    };
  };

  const dragThumb = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const target = targetRef.current;
    if (!drag || !target) return;
    const pointer = drag.axis === 'horizontal' ? event.clientX : event.clientY;
    const next = drag.scrollStart + (pointer - drag.start) / drag.available * drag.maxScroll;
    if (drag.axis === 'horizontal') target.scrollLeft = next;
    else target.scrollTop = next;
  };

  const stopDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  };

  const jumpTrack = (axis: 'horizontal' | 'vertical', event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const target = targetRef.current;
    if (!target) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const trackLength = axis === 'horizontal' ? bounds.width : bounds.height;
    const size = axis === 'horizontal' ? horizontalSize : verticalSize;
    const thumbLength = trackLength * size / 100;
    const available = trackLength - thumbLength;
    const coordinate = axis === 'horizontal' ? event.clientX - bounds.left : event.clientY - bounds.top;
    const ratio = available ? clamp((coordinate - thumbLength / 2) / available, 0, 1) : 0;
    if (axis === 'horizontal') target.scrollLeft = ratio * horizontalMax;
    else target.scrollTop = ratio * verticalMax;
  };

  const handleKeyboard = (axis: 'horizontal' | 'vertical', event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = targetRef.current;
    if (!target) return;
    const maxScroll = axis === 'horizontal' ? horizontalMax : verticalMax;
    const current = axis === 'horizontal' ? target.scrollLeft : target.scrollTop;
    const page = axis === 'horizontal' ? target.clientWidth : target.clientHeight;
    let next: number | null = null;
    if (event.key === (axis === 'horizontal' ? 'ArrowLeft' : 'ArrowUp')) next = current - 40;
    if (event.key === (axis === 'horizontal' ? 'ArrowRight' : 'ArrowDown')) next = current + 40;
    if (event.key === 'PageUp') next = current - page;
    if (event.key === 'PageDown') next = current + page;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = maxScroll;
    if (next === null) return;
    event.preventDefault();
    if (axis === 'horizontal') target.scrollLeft = next;
    else target.scrollTop = next;
  };

  return <>
    <div ref={horizontalRef} className={`canvas-scrollbar horizontal${horizontalMax ? '' : ' disabled'}`} role="scrollbar" aria-label="Horizontal PDF scroll" aria-controls="pdf-canvas-scroll" aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={Math.round(horizontalMax)} aria-valuenow={Math.round(metrics.scrollLeft)} tabIndex={horizontalMax ? 0 : -1} onPointerDown={(event) => jumpTrack('horizontal', event)} onKeyDown={(event) => handleKeyboard('horizontal', event)}>
      <div className="canvas-scrollbar-thumb" style={{ width: `${horizontalSize}%`, left: `${horizontalPosition}%` }} onPointerDown={(event) => startDrag('horizontal', event)} onPointerMove={dragThumb} onPointerUp={stopDrag} onPointerCancel={stopDrag} />
    </div>
    <div ref={verticalRef} className={`canvas-scrollbar vertical${verticalMax ? '' : ' disabled'}`} role="scrollbar" aria-label="Vertical PDF scroll" aria-controls="pdf-canvas-scroll" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={Math.round(verticalMax)} aria-valuenow={Math.round(metrics.scrollTop)} tabIndex={verticalMax ? 0 : -1} onPointerDown={(event) => jumpTrack('vertical', event)} onKeyDown={(event) => handleKeyboard('vertical', event)}>
      <div className="canvas-scrollbar-thumb" style={{ height: `${verticalSize}%`, top: `${verticalPosition}%` }} onPointerDown={(event) => startDrag('vertical', event)} onPointerMove={dragThumb} onPointerUp={stopDrag} onPointerCancel={stopDrag} />
    </div>
    <div className="canvas-scrollbar-corner" aria-hidden="true" />
  </>;
}

export default function MergeShell() {
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLElement>(null);
  const dataTableRef = useRef<HTMLDivElement>(null);
  const pendingDataFocusRef = useRef<{ rowId: string; fieldId: string } | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [geometries, setGeometries] = useState<PageGeometry[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [fields, setFields] = useState<TemplateField[]>([]);
  const [customFonts, setCustomFonts] = useState<CustomFont[]>([]);
  const [deviceFontOptions, setDeviceFontOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [rows, setRows] = useState<MergeRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [placementMode, setPlacementMode] = useState<'text' | 'image' | null>(null);
  const [handMode, setHandMode] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [altHeld, setAltHeld] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [contextMenu, setContextMenu] = useState<CanvasContextMenu | null>(null);
  const [reviewCopyIndex, setReviewCopyIndex] = useState(0);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [mobilePropertiesOpen, setMobilePropertiesOpen] = useState(false);
  const [mobileLayersOpen, setMobileLayersOpen] = useState(false);
  const [layerDropTarget, setLayerDropTarget] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'loading' | 'exporting' | 'printing' | null>(null);
  const [progress, setProgress] = useState(0);
  const zoomRef = useRef(zoom);
  const zoomAnchorRef = useRef<{ x: number; y: number; contentX: number; contentY: number; scale: number } | null>(null);
  const zoomFrameRef = useRef<number | null>(null);
  const zoomDeltaRef = useRef(0);
  const spaceHeldRef = useRef(false);
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);
  const deviceFontSourcesRef = useRef(new Map<string, DeviceFontSource>());
  const importedDeviceFontIdsRef = useRef(new Map<string, string>());

  const selected = useMemo(() => fields.find((field) => field.id === selectedId) ?? null, [fields, selectedId]);
  const selectedFields = useMemo(() => fields.filter((field) => selectedIds.includes(field.id)), [fields, selectedIds]);
  const currentFields = useMemo(() => fields.filter((field) => field.pageIndex === currentPage), [fields, currentPage]);
  const hasSession = Boolean(pdfDoc);
  const view = pathname.startsWith('/data') ? 'data' : pathname.startsWith('/review') ? 'review' : 'template';
  const activeReviewCopyIndex = Math.min(reviewCopyIndex, Math.max(rows.length - 1, 0));
  const activeReviewRow = rows[activeReviewCopyIndex] ?? null;

  useEffect(() => { document.title = view === 'template' ? 'Template' : view === 'data' ? 'Data' : 'Review'; }, [view]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const target = editorRef.current;
    if (!anchor || !target) return;
    target.scrollLeft = Math.max(0, anchor.contentX * anchor.scale - anchor.x);
    target.scrollTop = Math.max(0, anchor.contentY * anchor.scale - anchor.y);
    zoomAnchorRef.current = null;
  }, [zoom]);

  useEffect(() => {
    const target = editorRef.current;
    if (!target) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.altKey) return;
      event.preventDefault();
      const bounds = target.getBoundingClientRect();
      zoomAnchorRef.current = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
        contentX: (target.scrollLeft + event.clientX - bounds.left) / zoomRef.current,
        contentY: (target.scrollTop + event.clientY - bounds.top) / zoomRef.current,
        scale: zoomRef.current,
      };
      zoomDeltaRef.current += event.deltaY;
      if (zoomFrameRef.current !== null) return;
      zoomFrameRef.current = requestAnimationFrame(() => {
        const delta = zoomDeltaRef.current;
        zoomDeltaRef.current = 0;
        zoomFrameRef.current = null;
        const next = clamp(zoomRef.current + (delta < 0 ? 0.1 : -0.1), 0.5, 2);
        if (zoomAnchorRef.current) zoomAnchorRef.current.scale = next;
        zoomRef.current = next;
        setZoom(next);
      });
    };
    target.addEventListener('wheel', onWheel, { passive: false });
    return () => { target.removeEventListener('wheel', onWheel); if (zoomFrameRef.current !== null) cancelAnimationFrame(zoomFrameRef.current); };
  }, [pdfDoc]);

  useEffect(() => {
    if (!hasSession || typeof window === 'undefined') return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasSession]);

  useEffect(() => {
    if (view !== 'template') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt') { setAltHeld(true); return; }
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (event.code === 'Space' && pdfDoc) {
        event.preventDefault();
        spaceHeldRef.current = true;
        setSpaceHeld(true);
        return;
      }
      if (event.key === 'Escape' && placementMode) { setPlacementMode(null); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        const ids = fields.map((field) => field.id);
        setSelectedIds(ids);
        setSelectedId(ids[0] ?? null);
        setNameDraft('');
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') { setAltHeld(false); return; }
      if (event.code !== 'Space') return;
      spaceHeldRef.current = false;
      setSpaceHeld(false);
    };
    const clearSpacePan = () => {
      spaceHeldRef.current = false;
      panRef.current = null;
      setSpaceHeld(false);
      setAltHeld(false);
      setIsPanning(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearSpacePan);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearSpacePan);
    };
  }, [fields, pdfDoc, placementMode, view]);

  const openPdfPreview = async (bytes: Uint8Array) => {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const task = pdfjs.getDocument({ data: bytes.slice() });
    const document = await task.promise;
    const pageGeometries: PageGeometry[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const sourcePage = await document.getPage(pageNumber);
      const viewport = sourcePage.getViewport({ scale: 1 });
      pageGeometries.push({
        width: viewport.width,
        height: viewport.height,
        transform: [...viewport.transform] as PageGeometry['transform'],
      });
    }
    return { document, pageGeometries };
  };

  /**
   * PDFs may rely on embedded or unavailable fonts that do not survive a merge
   * consistently across PDF viewers. Rendering the source pages first preserves
   * their exact visual appearance; merge fields are then drawn on top.
   */
  const renderTemplatePages = async () => {
    if (!pdfDoc) return {};
    const rendered: Record<number, string> = {};
    for (let pageIndex = 0; pageIndex < pdfDoc.numPages; pageIndex += 1) {
      const page = await pdfDoc.getPage(pageIndex + 1);
      const naturalViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(1.5, 2000 / Math.max(naturalViewport.width, naturalViewport.height));
      const viewport = page.getViewport({ scale: Math.max(1, scale) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas rendering is not available in this browser.');
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      rendered[pageIndex] = canvas.toDataURL('image/png');
    }
    return rendered;
  };

  const loadPdf = async (file?: File) => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please choose a PDF file.');
      return;
    }
    setBusy('loading');
    setError('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { document, pageGeometries } = await openPdfPreview(bytes);
      await pdfDoc?.destroy();
      setPdfDoc(document);
      setPdfBytes(bytes);
      setGeometries(pageGeometries);
      setCurrentPage(0);
      setReviewCopyIndex(0);
      const isCompactViewport = typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches;
      setZoom(isCompactViewport ? 0.65 : 1);
      setFields([]);
      setRows([createRow()]);
      setCustomFonts([]); setDeviceFontOptions([]); deviceFontSourcesRef.current.clear(); importedDeviceFontIdsRef.current.clear();
      setSelectedId(null);
      setSelectedIds([]);
      setPlacementMode(null);
      setHandMode(false);
      setContextMenu(null);
      setMobilePropertiesOpen(false);
      setMobileLayersOpen(false);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'The PDF could not be opened.';
      setError(/password|encrypted/i.test(message) ? 'Password-protected PDFs are not supported.' : 'This PDF is invalid, encrypted, or unreadable.');
    } finally {
      setBusy(null);
      if (pdfInputRef.current) pdfInputRef.current.value = '';
    }
  };

  const updateField = useCallback((id: string, patch: Partial<TemplateField>) => {
    setFields((current) => current.map((field) => field.id === id ? ({ ...field, ...patch } as TemplateField) : field));
  }, []);

  const importFonts = async (file?: File) => {
    if (!file) return;
    const extension = file.name.toLowerCase().split('.').pop();
    if (!['ttf', 'otf', 'zip'].includes(extension ?? '')) {
      setError('Upload a .ttf, .otf, or .zip file containing font faces.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('Font uploads must be 20 MB or smaller.');
      return;
    }
    setError('');
    try {
      const sources: Array<{ name: string; bytes: Uint8Array }> = [];
      if (extension === 'zip') {
        const JSZip = (await import('jszip')).default;
        const archive = await JSZip.loadAsync(await file.arrayBuffer());
        const entries = Object.values(archive.files).filter((entry) => !entry.dir && /\.(ttf|otf)$/i.test(entry.name));
        if (!entries.length) throw new Error('That ZIP does not contain any .ttf or .otf font files.');
        if (entries.length > 20) throw new Error('A ZIP can contain up to 20 font files.');
        let totalBytes = 0;
        for (const entry of entries) {
          const bytes = await entry.async('uint8array');
          totalBytes += bytes.byteLength;
          if (totalBytes > 50 * 1024 * 1024) throw new Error('The uncompressed font files are too large.');
          sources.push({ name: entry.name.split('/').pop() ?? entry.name, bytes });
        }
      } else {
        sources.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
      }
      const imported: CustomFont[] = [];
      for (const source of sources) {
        const id = createId();
        const previewFamily = `Merge Custom ${id}`;
        const fontBytes = new Uint8Array(source.bytes);
        const face = new FontFace(previewFamily, fontBytes.buffer);
        await face.load();
        document.fonts.add(face);
        imported.push({ id, name: source.name.replace(/\.(ttf|otf)$/i, ''), previewFamily, bytes: source.bytes });
      }
      setCustomFonts((current) => [...current, ...imported]);
      if (imported[0] && selectedFields.length && selectedFields.every((field) => field.type === 'text')) {
        const selectedSet = new Set(selectedFields.map((field) => field.id));
        setFields((current) => current.map((field) => field.type === 'text' && selectedSet.has(field.id)
          ? { ...field, style: { ...field.style, fontFamily: imported[0].name, fontFileId: imported[0].id, fontWeight: 'regular' } }
          : field));
      }
    } catch (caught) {
      setError(caught instanceof Error ? `Could not import font: ${caught.message}` : 'Could not import that font file.');
    } finally {
      if (fontInputRef.current) fontInputRef.current.value = '';
    }
  };

  const applyCustomFont = (font: CustomFont) => {
    if (!selectedFields.length || !selectedFields.every((field) => field.type === 'text')) return;
    const selectedSet = new Set(selectedFields.map((field) => field.id));
    setFields((current) => current.map((field) => field.type === 'text' && selectedSet.has(field.id)
      ? { ...field, style: { ...field.style, fontFamily: font.name, fontFileId: font.id, fontWeight: 'regular' } }
      : field));
  };

  const applyBuiltInFont = (fontFamily: string) => {
    if (!selectedFields.length || !selectedFields.every((field) => field.type === 'text')) return;
    const selectedSet = new Set(selectedFields.map((field) => field.id));
    setFields((current) => current.map((field) => field.type === 'text' && selectedSet.has(field.id)
      ? { ...field, style: { ...field.style, fontFamily, fontFileId: undefined } }
      : field));
  };

  const findDeviceFonts = async () => {
    const api = (window as DeviceFontWindow).queryLocalFonts;
    if (!api) {
      setError('Device-font access is not available in this browser. Upload a .ttf or .otf font file instead.');
      return;
    }
    setError('');
    try {
      const sources = await api();
      const unique = new Map<string, { id: string; label: string }>();
      deviceFontSourcesRef.current.clear();
      sources.forEach((source, index) => {
        const id = `${source.postscriptName || source.fullName || source.family}:${index}`;
        const label = source.fullName || `${source.family} ${source.style}`.trim();
        if (unique.has(label)) return;
        deviceFontSourcesRef.current.set(id, source);
        unique.set(label, { id, label });
      });
      setDeviceFontOptions([...unique.values()].sort((left, right) => left.label.localeCompare(right.label)));
      if (!unique.size) setError('No device fonts were returned. Upload a .ttf or .otf font file instead.');
    } catch (caught) {
      setError(caught instanceof Error ? `Could not access device fonts: ${caught.message}` : 'Device-font access was not granted. Upload a .ttf or .otf font file instead.');
    }
  };

  const requestDeviceFonts = () => {
    if (!window.confirm('Allow this site to ask your browser for the names of installed fonts? The selected font file is read only when you choose it.')) return;
    void findDeviceFonts();
  };

  const importDeviceFont = async (sourceId: string) => {
    const source = deviceFontSourcesRef.current.get(sourceId);
    if (!source) return;
    setError('');
    try {
      const existingId = importedDeviceFontIdsRef.current.get(sourceId);
      let font = existingId ? customFonts.find((item) => item.id === existingId) : undefined;
      if (!font) {
        const blob = await source.blob();
        if (blob.size > 20 * 1024 * 1024) throw new Error('That device font is larger than 20 MB.');
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const id = createId();
        const previewFamily = `Merge Device ${id}`;
        const face = new FontFace(previewFamily, new Uint8Array(bytes).buffer);
        await face.load();
        document.fonts.add(face);
        font = { id, name: source.fullName || source.family, previewFamily, bytes };
        importedDeviceFontIdsRef.current.set(sourceId, id);
        setCustomFonts((current) => [...current, font!]);
      }
      applyCustomFont(font);
    } catch (caught) {
      setError(caught instanceof Error ? `Could not use device font: ${caught.message}` : 'Could not use that device font.');
    }
  };

  const selectField = useCallback((id: string | null) => {
    setSelectedId(id);
    setSelectedIds(id ? [id] : []);
    setNameDraft(fields.find((field) => field.id === id)?.name ?? '');
    // On compact screens, keep the canvas immediately usable after a selection.
    // Field settings remain available through the explicit top-bar controls button.
    setMobilePropertiesOpen(false);
  }, [fields]);

  const placeField = (type: 'text' | 'image', pageIndex: number, point: { x: number; y: number }) => {
    const names = fields.map((field) => field.name);
    const width = type === 'text' ? 0.44 : 0.26;
    const height = type === 'text' ? 0.075 : 0.2;
    const layerIndex = Math.max(-1, ...fields.filter((field) => field.pageIndex === pageIndex).map((field) => field.layerIndex)) + 1;
    const field: TemplateField = type === 'text'
      ? {
          id: createId(), type, name: uniqueFieldName('Text', names), pageIndex, layerIndex,
          rect: { x: clamp(point.x - width / 2, 0, 1 - width), y: clamp(point.y - height / 2, 0, 1 - height), width, height }, rotation: 0,
          style: { fontFamily: 'Noto Sans', fontWeight: 'regular', fontSize: 18, minFontSize: 6, color: '#111111', align: 'left', lineHeight: 1.2 },
        }
      : {
          id: createId(), type, name: uniqueFieldName('Image', names), pageIndex, layerIndex,
          rect: { x: clamp(point.x - width / 2, 0, 1 - width), y: clamp(point.y - height / 2, 0, 1 - height), width, height }, rotation: 0,
          style: { fit: 'contain', opacity: 1, backgroundRemoval: 'auto', enhancement: 'off' },
        };
    setFields((current) => [...current, field]);
    setSelectedId(field.id);
    setSelectedIds([field.id]);
    setNameDraft(field.name);
    setPlacementMode(null);
    setMobilePropertiesOpen(false);
    if (type === 'text') {
      const row = rows[0] ?? createRow();
      if (!rows.length) setRows([row]);
      pendingDataFocusRef.current = { rowId: row.id, fieldId: field.id };
      router.push('/data');
    }
  };

  const nudgeSelection = useCallback((originId: string, dx: number, dy: number) => {
    const ids = selectedIds.includes(originId) ? selectedIds : [originId];
    setFields((current) => {
      const moving = current.filter((field) => ids.includes(field.id));
      if (!moving.length) return current;
      const safeDx = clamp(dx, Math.max(...moving.map((field) => -field.rect.x)), Math.min(...moving.map((field) => 1 - field.rect.width - field.rect.x)));
      const safeDy = clamp(dy, Math.max(...moving.map((field) => -field.rect.y)), Math.min(...moving.map((field) => 1 - field.rect.height - field.rect.y)));
      return current.map((field) => ids.includes(field.id)
        ? { ...field, rect: { ...field.rect, x: field.rect.x + safeDx, y: field.rect.y + safeDy } }
        : field);
    });
  }, [selectedIds]);

  const reorderLayers = useCallback((draggedId: string, targetId: string) => {
    const dragged = fields.find((field) => field.id === draggedId);
    const target = fields.find((field) => field.id === targetId);
    if (!dragged || !target || dragged.pageIndex !== target.pageIndex || draggedId === targetId) return;
    const ordered = fields.filter((field) => field.pageIndex === dragged.pageIndex).sort((a, b) => b.layerIndex - a.layerIndex);
    const from = ordered.findIndex((field) => field.id === draggedId);
    const [moved] = ordered.splice(from, 1);
    const targetIndex = ordered.findIndex((field) => field.id === targetId);
    ordered.splice(targetIndex, 0, moved);
    const nextLayers = new Map(ordered.map((field, index) => [field.id, ordered.length - 1 - index]));
    setFields((current) => current.map((field) => nextLayers.has(field.id) ? { ...field, layerIndex: nextLayers.get(field.id)! } : field));
  }, [fields]);

  const deleteField = useCallback((id: string) => {
    const field = fields.find((item) => item.id === id);
    if (!field) return;
    setFields((current) => current.filter((item) => item.id !== id));
    setRows((current) => current.map((row) => {
      const values = { ...row.values };
      delete values[id];
      return { ...row, values };
    }));
    setSelectedId((current) => current === id ? null : current);
    setSelectedIds((current) => current.filter((selected) => selected !== id));
    if (selectedId === id) {
      setNameDraft('');
      setMobilePropertiesOpen(false);
    }
  }, [fields, selectedId]);

  const deleteSelectedFields = () => {
    if (!selectedIds.length) return;
    if (selectedIds.length === 1) { deleteField(selectedIds[0]); return; }
    const removed = new Set(selectedIds);
    setFields((current) => current.filter((field) => !removed.has(field.id)));
    setRows((current) => current.map((row) => {
      const values = { ...row.values };
      removed.forEach((id) => delete values[id]);
      return { ...row, values };
    }));
    setSelectedId(null); setSelectedIds([]); setNameDraft(''); setMobilePropertiesOpen(false);
  };

  const deletePage = async (pageIndex: number) => {
    if (!pdfDoc || !pdfBytes) return;
    const removedFields = fields.filter((field) => field.pageIndex === pageIndex);
    const fieldNote = removedFields.length ? ` This also removes ${removedFields.length} field${removedFields.length === 1 ? '' : 's'} on it and their data columns.` : '';
    if (!window.confirm(`Delete page ${pageIndex + 1}?${fieldNote}`)) return;

    setContextMenu(null);
    if (pdfDoc.numPages === 1) {
      await pdfDoc.destroy();
      setPdfDoc(null); setPdfBytes(null); setGeometries([]); setCurrentPage(0); setReviewCopyIndex(0);
      setFields([]); setRows([]); setCustomFonts([]); setDeviceFontOptions([]); deviceFontSourcesRef.current.clear(); importedDeviceFontIdsRef.current.clear(); setSelectedId(null); setSelectedIds([]); setPlacementMode(null); setHandMode(false); setNameDraft(''); setMobilePropertiesOpen(false); setMobileLayersOpen(false);
      return;
    }
    setBusy('loading');
    setError('');
    try {
      const { PDFDocument } = await import('pdf-lib');
      const template = await PDFDocument.load(pdfBytes);
      template.removePage(pageIndex);
      const nextBytes = new Uint8Array(await template.save());
      const { document, pageGeometries } = await openPdfPreview(nextBytes);
      const removedIds = new Set(removedFields.map((field) => field.id));
      await pdfDoc.destroy();
      setPdfDoc(document);
      setPdfBytes(nextBytes);
      setGeometries(pageGeometries);
      setCurrentPage(Math.min(pageIndex, document.numPages - 1));
      setFields((current) => current
        .filter((field) => field.pageIndex !== pageIndex)
        .map((field) => field.pageIndex > pageIndex ? { ...field, pageIndex: field.pageIndex - 1 } : field));
      if (removedIds.size) {
        setRows((current) => current.map((row) => {
          const values = { ...row.values };
          removedIds.forEach((id) => delete values[id]);
          return { ...row, values };
        }));
      }
      setSelectedId(null);
      setSelectedIds([]);
      setPlacementMode(null);
      setNameDraft('');
      setMobilePropertiesOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? `Could not delete this page: ${caught.message}` : 'Could not delete this page.');
    } finally {
      setBusy(null);
    }
  };


  const commitName = () => {
    if (!selected) return;
    const next = nameDraft.trim();
    if (!next) { setError('Field names cannot be empty.'); setNameDraft(selected.name); return; }
    if (fields.some((field) => field.id !== selected.id && field.name.toLowerCase() === next.toLowerCase())) {
      setError('Every field needs a unique name.'); setNameDraft(selected.name); return;
    }
    setError('');
    updateField(selected.id, { name: next } as Partial<TemplateField>);
  };

  const updateCell = (rowId: string, fieldId: string, value: CellValue) => setRows((current) => current.map((row) => row.id === rowId
    ? { ...row, values: { ...row.values, [fieldId]: value } }
    : row));

  const focusDataCell = useCallback((rowId: string, fieldId: string) => {
    requestAnimationFrame(() => {
      const table = dataTableRef.current;
      if (!table) return;
      const cell = Array.from(table.querySelectorAll<HTMLElement>('[data-merge-cell]'))
        .find((item) => item.dataset.rowId === rowId && item.dataset.fieldId === fieldId);
      const control = cell?.querySelector<HTMLElement>('textarea,.cell-file');
      if (!control) return;
      control.focus();
      if (control instanceof HTMLTextAreaElement) control.select();
      cell?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }, []);

  useLayoutEffect(() => {
    const pending = pendingDataFocusRef.current;
    if (!pending || view !== 'data') return;
    pendingDataFocusRef.current = null;
    focusDataCell(pending.rowId, pending.fieldId);
  }, [rows, focusDataCell, view]);

  const addRowAndFocus = (fieldIndex = 0) => {
    const row = createRow();
    const field = fields[fieldIndex] ?? fields[0];
    if (field) pendingDataFocusRef.current = { rowId: row.id, fieldId: field.id };
    setRows((current) => [...current, row]);
  };

  const handleDataCellKeyDown = (event: ReactKeyboardEvent<HTMLElement>, rowIndex: number, fieldIndex: number) => {
    if (event.nativeEvent.isComposing) return;
    const isButton = event.target instanceof HTMLButtonElement;
    const isTextarea = event.target instanceof HTMLTextAreaElement;
    const moveTo = (nextRow: number, nextField: number, createIfMissing = false) => {
      if (nextRow >= rows.length && createIfMissing) {
        addRowAndFocus(nextField);
        return;
      }
      const row = rows[nextRow];
      const field = fields[nextField];
      if (row && field) focusDataCell(row.id, field.id);
    };

    if (event.key === 'Escape') {
      (event.target as HTMLElement).blur();
      return;
    }
    if (event.key === 'Enter') {
      if (isButton || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const nextRow = rowIndex + (event.shiftKey ? -1 : 1);
      moveTo(nextRow, fieldIndex, !event.shiftKey);
      return;
    }
    if (event.key === 'Tab') {
      if (event.shiftKey && rowIndex === 0 && fieldIndex === 0) return;
      event.preventDefault();
      let nextRow = rowIndex;
      let nextField = fieldIndex + (event.shiftKey ? -1 : 1);
      if (nextField >= fields.length) { nextField = 0; nextRow += 1; }
      if (nextField < 0) { nextField = fields.length - 1; nextRow -= 1; }
      moveTo(nextRow, nextField, !event.shiftKey);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (isTextarea && event.currentTarget.querySelector('textarea')?.value.includes('\n')) return;
      event.preventDefault();
      moveTo(rowIndex + (event.key === 'ArrowUp' ? -1 : 1), fieldIndex, event.key === 'ArrowDown');
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (isTextarea) {
        const textarea = event.target as HTMLTextAreaElement;
        const atStart = textarea.selectionStart === 0 && textarea.selectionEnd === 0;
        const atEnd = textarea.selectionStart === textarea.value.length && textarea.selectionEnd === textarea.value.length;
        if ((event.key === 'ArrowLeft' && !atStart) || (event.key === 'ArrowRight' && !atEnd)) return;
      }
      if (!isTextarea && !isButton) return;
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      let nextRow = rowIndex;
      let nextField = fieldIndex + direction;
      if (nextField >= fields.length) { nextField = 0; nextRow += 1; }
      if (nextField < 0) { nextField = fields.length - 1; nextRow -= 1; }
      if (nextRow < 0) return;
      event.preventDefault();
      moveTo(nextRow, nextField, direction > 0);
    }
  };

  const duplicateRow = (id: string) => setRows((current) => {
    const index = current.findIndex((row) => row.id === id);
    if (index < 0) return current;
    const next = [...current];
    next.splice(index + 1, 0, { id: createId(), values: { ...current[index].values } });
    return next;
  });

  const deleteRow = (id: string) => {
    setExportMenuOpen(false);
    setReviewCopyIndex(0);
    setRows((current) => current.filter((row) => row.id !== id));
  };

  const reset = async () => {
    if (!window.confirm('Discard this PDF, all fields, and every row?')) return;
    await pdfDoc?.destroy();
    setPdfDoc(null); setPdfBytes(null); setGeometries([]); setCurrentPage(0);
    setFields([]); setRows([]); setCustomFonts([]); setDeviceFontOptions([]); deviceFontSourcesRef.current.clear(); importedDeviceFontIdsRef.current.clear(); setSelectedId(null); setSelectedIds([]); setPlacementMode(null); setHandMode(false); setContextMenu(null); setReviewCopyIndex(0); setMobilePropertiesOpen(false); setMobileLayersOpen(false); setError(''); setProgress(0);
  };

  const moveReviewCopy = (direction: -1 | 1) => setReviewCopyIndex((copy) => Math.max(0, Math.min(rows.length - 1, copy + direction)));

  const createOutput = async (mode: 'exporting' | 'printing', separate = false) => {
    if (!pdfBytes || !fields.length || !rows.length) return;
    const printTarget = mode === 'printing' ? window.open('about:blank', '_blank') : null;
    if (mode === 'printing' && !printTarget) {
      setError('Allow pop-ups to open the printable PDF.');
      return;
    }
    setBusy(mode); setProgress(0); setError('');
    try {
      const { downloadFile, downloadPdf, generateMergedPdf, openPrintablePdf } = await import('./lib/export-pdf');
      const renderedTemplatePages = await renderTemplatePages();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      if (separate) {
        const JSZip = (await import('jszip')).default;
        const archive = new JSZip();
        for (const [rowIndex, row] of rows.entries()) {
          const bytes = await generateMergedPdf(pdfBytes, fields, [row], geometries, ({ percent }) => {
            setProgress(Math.round(((rowIndex + percent / 100) / rows.length) * 100));
          }, customFonts, renderedTemplatePages);
          archive.file(`mail-merge-${String(rowIndex + 1).padStart(3, '0')}.pdf`, bytes);
        }
        const zipBytes = await archive.generateAsync({ type: 'uint8array' }, (metadata) => setProgress(Math.round(metadata.percent)));
        downloadFile(zipBytes, `mail-merge-${stamp}.zip`, 'application/zip');
        return;
      }
      const bytes = await generateMergedPdf(pdfBytes, fields, rows, geometries, ({ percent }) => setProgress(percent), customFonts, renderedTemplatePages);
      if (mode === 'exporting') {
        downloadPdf(bytes, `mail-merge-${stamp}.pdf`);
      } else openPrintablePdf(bytes, printTarget);
    } catch (caught) {
      printTarget?.close();
      setError(caught instanceof Error ? caught.message : 'The PDF export could not be created.');
    } finally { setBusy(null); }
  };

  const sharedValue = <T,>(values: T[]) => values.length && values.every((value) => value === values[0]) ? values[0] : '' as T | '';
  const selectedFontValue = selectedFields.length === 1 && selectedFields[0].type === 'text'
    ? (selectedFields[0].style.fontFileId ? `custom:${selectedFields[0].style.fontFileId}` : `builtin:${selectedFields[0].style.fontFamily || 'Noto Sans'}`)
    : '';
  const selectionIsText = selectedFields.length > 0 && selectedFields.every((field) => field.type === 'text');
  const selectionIsImage = selectedFields.length > 0 && selectedFields.every((field) => field.type === 'image');
  const updateSelected = (patch: Partial<TemplateField>) => setFields((current) => current.map((field) => selectedIds.includes(field.id) ? ({ ...field, ...patch } as TemplateField) : field));
  const updateSelectedTextStyle = (patch: Record<string, unknown>) => setFields((current) => current.map((field) => selectedIds.includes(field.id) && field.type === 'text' ? ({ ...field, style: { ...field.style, ...patch } }) : field));
  const updateSelectedImageStyle = (patch: Record<string, unknown>) => setFields((current) => current.map((field) => selectedIds.includes(field.id) && field.type === 'image' ? ({ ...field, style: { ...field.style, ...patch } }) : field));

  const beginCanvasPan = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (!handMode && !spaceHeldRef.current)) return false;
    if (event.target instanceof Element && event.target.closest('.page-context-menu')) return false;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    panRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, scrollLeft: target.scrollLeft, scrollTop: target.scrollTop };
    target.setPointerCapture(event.pointerId);
    setIsPanning(true);
    return true;
  };

  const moveCanvasPan = (event: ReactPointerEvent<HTMLElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const target = event.currentTarget;
    target.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX);
    target.scrollTop = pan.scrollTop - (event.clientY - pan.startY);
  };

  const endCanvasPan = (event: ReactPointerEvent<HTMLElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    panRef.current = null;
    setIsPanning(false);
  };

  const emptyWorkflow = (title: string, copy: string) => (
    <div className="workflow-empty">
      <div className="empty-icon"><FileText size={20} /></div>
      <h1>{title}</h1>
      <p>{copy}</p>
      <Link className="button button-dark" href="/">Go to template</Link>
    </div>
  );

  const dataTable = !pdfDoc
    ? emptyWorkflow('Open a PDF first', 'Your PDF and fields are set up on the Template page.')
    : !fields.length
      ? emptyWorkflow('Add your fields first', 'Place at least one text or image field before entering merge data.')
      : (
        <div ref={dataTableRef} className="table-scroll table-scroll-full">
          <table>
            <thead><tr><th className="row-number">#</th>{fields.map((field) => <th key={field.id}><span>{field.name}</span><small>{field.type === 'text' ? 'TEXT' : 'IMAGE'}</small></th>)}<th className="row-actions">Actions</th></tr></thead>
            <tbody>{rows.map((row, rowIndex) => <tr key={row.id}>
              <td className="row-number">{rowIndex + 1}</td>
              {fields.map((field, fieldIndex) => <td key={field.id} data-merge-cell data-row-id={row.id} data-field-id={field.id} onKeyDown={(event) => handleDataCellKeyDown(event, rowIndex, fieldIndex)}>{field.type === 'text'
                ? <textarea rows={1} aria-label={`${field.name}, row ${rowIndex + 1}`} value={typeof row.values[field.id] === 'string' ? row.values[field.id] as string : ''} placeholder="Blank" onChange={(event) => updateCell(row.id, field.id, event.target.value)} />
                : <ImageCell value={row.values[field.id] ?? null} onChange={(value) => updateCell(row.id, field.id, value)} />}</td>)}
              <td className="row-actions"><button className="table-action" title="Duplicate row" aria-label={`Duplicate row ${rowIndex + 1}`} onClick={() => duplicateRow(row.id)}><Copy size={13} /></button><button className="table-action" title="Delete row" aria-label={`Delete row ${rowIndex + 1}`} onClick={() => deleteRow(row.id)}><Trash2 size={13} /></button></td>
            </tr>)}</tbody>
          </table>
        </div>
      );

  return (
    <main className={`app-shell view-${view}`}>
      <header className="topbar">
        <div className="topbar-spacer" aria-hidden="true" />
        <nav className="workflow-nav" aria-label="Mail merge workflow">
          <Link href="/" className={view === 'template' ? 'active' : ''} aria-current={view === 'template' ? 'step' : undefined}><span>1</span> Template</Link>
          <Link href="/data" className={view === 'data' ? 'active' : ''} aria-current={view === 'data' ? 'step' : undefined}><span>2</span> Data</Link>
          <Link href="/review" className={view === 'review' ? 'active' : ''} aria-current={view === 'review' ? 'step' : undefined}><span>3</span> Review</Link>
        </nav>
        <div className="topbar-actions">
          <input ref={pdfInputRef} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => void loadPdf(event.target.files?.[0])} />
          {view === 'template' && pdfDoc && <button className={`icon-button${handMode || spaceHeld ? ' active' : ''}`} aria-label="Hand tool" aria-pressed={handMode || spaceHeld} title="Hand tool — drag to pan" onClick={() => { setHandMode((current) => !current); setPlacementMode(null); }}><Hand size={14} /></button>}
          {view === 'template' && selectedIds.length > 0 && <button className="icon-button compact-properties-trigger" aria-label="Edit selected fields" title="Edit selected fields" onClick={() => setMobilePropertiesOpen(true)}><SlidersHorizontal size={14} /></button>}
          <button className="icon-button" aria-label="Start over" title="Start over" onClick={() => void reset()} disabled={!pdfDoc || Boolean(busy)}><RotateCcw size={14} /></button>
        </div>
      </header>

      {error && <div className="error-banner" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={14} /></button></div>}

      {view === 'template' && <section className="workspace">
        <aside className="toolbar">
          <p className="eyebrow">Fields</p>
          <button className={`tool-button${placementMode === 'text' ? ' active' : ''}`} disabled={!pdfDoc || Boolean(busy)} onClick={() => { setHandMode(false); setPlacementMode((mode) => mode === 'text' ? null : 'text'); }}><Type size={17} /><span><strong>Text</strong></span><Plus size={13} /></button>
          <button className={`tool-button${placementMode === 'image' ? ' active' : ''}`} disabled={!pdfDoc || Boolean(busy)} onClick={() => { setHandMode(false); setPlacementMode((mode) => mode === 'image' ? null : 'image'); }}><ImageIcon size={17} /><span><strong>Image</strong></span><Plus size={13} /></button>
          {pdfDoc && <button className="tool-button compact-layers-trigger" onClick={() => { setMobilePropertiesOpen(false); setMobileLayersOpen(true); }}><Layers3 size={17} /><span><strong>Layers</strong></span><GripVertical size={13} /></button>}
          {pdfDoc && <div className="field-list">
            <p className="eyebrow field-list-title"><Layers3 size={12} /> Layers · page {currentPage + 1}</p>
            {currentFields.length ? currentFields.slice().sort((a, b) => b.layerIndex - a.layerIndex).map((field) => (
              <button key={field.id} draggable className={`field-list-item${selectedIds.includes(field.id) ? ' active' : ''}${layerDropTarget === field.id ? ' layer-drop-target' : ''}`} onDragStart={(event) => { event.dataTransfer.setData('text/plain', field.id); setLayerDropTarget(null); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setLayerDropTarget(field.id); }} onDragEnd={() => setLayerDropTarget(null)} onDrop={(event) => { event.preventDefault(); reorderLayers(event.dataTransfer.getData('text/plain'), field.id); setLayerDropTarget(null); }} onClick={() => selectField(field.id)}>
                <GripVertical size={13} /><span>{field.type === 'text' ? <Type size={13} /> : <ImageIcon size={13} />}{field.name}</span>
              </button>
            )) : <p className="muted tiny">No fields on this page.</p>}
          </div>}
        </aside>

        <section className={`editor${pdfDoc ? ' has-document' : ''}`} aria-label="PDF editor">
          {!pdfDoc ? (
            <div className="canvas-empty">
              <div className="empty-icon"><FileText size={20} /></div>
              <h1>Start with a PDF</h1>
              <p>Open a PDF, place variable fields, then add one row for each personalized copy.</p>
              <button className="button button-dark" onClick={() => pdfInputRef.current?.click()}>Choose PDF</button>
            </div>
          ) : <>
            <section id="pdf-canvas-scroll" ref={editorRef} className={`canvas-scroll${handMode || spaceHeld ? ' hand-mode' : ''}${isPanning ? ' panning' : ''}${altHeld ? ' zoom-mode' : ''}`} onPointerDownCapture={(event) => {
              if (beginCanvasPan(event)) return;
              if (!(event.target instanceof Element && event.target.closest('.page-context-menu'))) setContextMenu(null);
            }} onPointerMoveCapture={moveCanvasPan} onPointerUpCapture={endCanvasPan} onPointerCancelCapture={endCanvasPan}>
              <AllPagesCanvas document={pdfDoc} zoom={zoom} fields={fields} row={null} customFonts={customFonts} activePage={currentPage} selectedIds={selectedIds} placementMode={placementMode} onActivatePage={setCurrentPage} onSelect={selectField} onChange={updateField} onDelete={deleteField} onPlace={placeField} onNudge={nudgeSelection} onPageContextMenu={(pageIndex, position) => {
                setCurrentPage(pageIndex);
                setContextMenu({ kind: 'page', pageIndex, ...position });
              }} onFieldContextMenu={(fieldId, position) => {
                const field = fields.find((item) => item.id === fieldId);
                if (!field) return;
                setCurrentPage(field.pageIndex);
                selectField(fieldId);
                setContextMenu({ kind: 'field', fieldId, ...position });
              }} />
              {contextMenu && <div className="page-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
                {contextMenu.kind === 'page'
                  ? <button role="menuitem" disabled={Boolean(busy)} onClick={() => void deletePage(contextMenu.pageIndex)}><Trash2 size={13} /><span>Delete page {contextMenu.pageIndex + 1}</span></button>
                  : <button role="menuitem" onClick={() => { setContextMenu(null); deleteField(contextMenu.fieldId); }}><Trash2 size={13} /><span>Delete field {fields.find((field) => field.id === contextMenu.fieldId)?.name ?? ''}</span></button>}
              </div>}
            </section>
            <div className="page-controls" aria-label="PDF page controls">
              <span><strong>{pdfDoc.numPages}</strong> pages · active page <strong>{currentPage + 1}</strong></span>
              <span className="control-divider" />
              <button className="icon-button" aria-label="Zoom out" disabled={zoom <= .5} onClick={() => setZoom((value) => clamp(value - .1, .5, 2))}><Minus size={14} /></button>
              <span className="zoom-value">{Math.round(zoom * 100)}%</span>
              <button className="icon-button" aria-label="Zoom in" disabled={zoom >= 2} onClick={() => setZoom((value) => clamp(value + .1, .5, 2))}><Plus size={14} /></button>
            </div>
            <CanvasScrollbars targetRef={editorRef} />
          </>}
        </section>

        {mobilePropertiesOpen && <button className="properties-scrim" aria-label="Close field properties" onClick={() => setMobilePropertiesOpen(false)} />}
        <aside className={`properties${mobilePropertiesOpen ? ' mobile-open' : ''}`} aria-label="Field properties">
          <div className="properties-heading"><p className="eyebrow">Properties</p><button className="properties-close icon-button" aria-label="Close field properties" onClick={() => setMobilePropertiesOpen(false)}><X size={15} /></button></div>
          {!selectedFields.length ? <p className="muted">Select a field on the page to edit it.</p> : <div className="property-form">
            <label><span>Name</span><input value={selectedFields.length === 1 ? nameDraft : ''} placeholder={selectedFields.length > 1 ? 'Multiple fields' : undefined} readOnly={selectedFields.length > 1} onChange={(event) => setNameDraft(event.target.value)} onBlur={commitName} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
            <div className="property-grid">
              <label><span>Page</span><input value={sharedValue(selectedFields.map((field) => field.pageIndex + 1))} placeholder="Multiple" readOnly /></label>
              <label><span>Rotation</span><input type="number" min="0" max="359" value={sharedValue(selectedFields.map((field) => field.rotation))} placeholder="Multiple" onChange={(event) => { if (event.target.value) updateSelected({ rotation: Number(event.target.value) } as Partial<TemplateField>); }} /></label>
            </div>
            {selectionIsText ? <>
              <input ref={fontInputRef} type="file" accept=".ttf,.otf,.zip,application/zip,application/x-zip-compressed" hidden onChange={(event) => void importFonts(event.target.files?.[0])} />
              <label><span>Merge font</span><select value={selectedFontValue} aria-label={selectedFields.length > 1 ? 'Merge font — multiple fields selected' : 'Merge font'} onChange={(event) => {
                const choice = event.target.value;
                if (choice === 'action:device') {
                  requestDeviceFonts();
                } else if (choice === 'action:upload') {
                  fontInputRef.current?.click();
                } else if (choice.startsWith('device:')) {
                  void importDeviceFont(choice.slice('device:'.length));
                } else if (choice.startsWith('custom:')) {
                  const font = customFonts.find((item) => item.id === choice.slice('custom:'.length));
                  if (font) applyCustomFont(font);
                } else if (choice.startsWith('builtin:')) {
                  applyBuiltInFont(choice.slice('builtin:'.length));
                }
              }}><option value="">{selectedFields.length > 1 ? 'Multiple fields selected' : 'Choose a font'}</option><optgroup label="Embedded fonts"><option value="builtin:Noto Sans">Noto Sans</option><option value="builtin:Noto Serif">Noto Serif</option><option value="builtin:Noto Sans Mono">Noto Sans Mono</option></optgroup>{deviceFontOptions.length > 0 && <optgroup label="Device fonts">{deviceFontOptions.map((font) => <option key={font.id} value={`device:${font.id}`}>{font.label}</option>)}</optgroup>}{customFonts.length > 0 && <optgroup label="Uploaded fonts">{customFonts.map((font) => <option key={font.id} value={`custom:${font.id}`}>{font.name}</option>)}</optgroup>}<optgroup label="More fonts"><option value="action:device">Find device fonts…</option><option value="action:upload">Upload font file…</option></optgroup></select></label>
              <div className="property-grid">
                <label><span>Weight</span><select value={sharedValue(selectedFields.map((field) => field.type === 'text' ? field.style.fontWeight : ''))} onChange={(event) => updateSelectedTextStyle({ fontWeight: event.target.value })}><option value="">Multiple</option><option value="regular">Regular</option><option value="bold">Bold</option></select></label>
                <label><span>Size</span><input type="number" min="6" max="144" value={sharedValue(selectedFields.map((field) => field.type === 'text' ? field.style.fontSize : ''))} placeholder="Multiple" onChange={(event) => { if (event.target.value) updateSelectedTextStyle({ fontSize: Number(event.target.value) }); }} /></label>
              </div>
              <div className="property-grid">
                <label><span>Minimum</span><input type="number" min="4" value={sharedValue(selectedFields.map((field) => field.type === 'text' ? field.style.minFontSize : ''))} placeholder="Multiple" onChange={(event) => { if (event.target.value) updateSelectedTextStyle({ minFontSize: Number(event.target.value) }); }} /></label>
                <label><span>Line height</span><input type="number" min="1" max="2" step="0.1" value={sharedValue(selectedFields.map((field) => field.type === 'text' ? field.style.lineHeight : ''))} placeholder="Multiple" onChange={(event) => { if (event.target.value) updateSelectedTextStyle({ lineHeight: Number(event.target.value) }); }} /></label>
              </div>
              <label><span>Alignment</span><select value={sharedValue(selectedFields.map((field) => field.type === 'text' ? field.style.align : ''))} onChange={(event) => updateSelectedTextStyle({ align: event.target.value })}><option value="">Multiple</option><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
              <label className="color-label"><span>Text color</span><div><input type="color" value={sharedValue(selectedFields.map((field) => field.type === 'text' ? field.style.color : '')) || '#111111'} onChange={(event) => updateSelectedTextStyle({ color: event.target.value })} /><code>{sharedValue(selectedFields.map((field) => field.type === 'text' ? field.style.color : '')) || 'Multiple'}</code></div></label>
            </> : selectionIsImage ? <>
              <label><span>Fit</span><select value={sharedValue(selectedFields.map((field) => field.type === 'image' ? field.style.fit : ''))} onChange={(event) => updateSelectedImageStyle({ fit: event.target.value })}><option value="">Multiple</option><option value="contain">Contain</option><option value="cover">Cover</option></select></label>
              <label><span>Opacity</span><input type="range" min="0.1" max="1" step="0.05" value={sharedValue(selectedFields.map((field) => field.type === 'image' ? field.style.opacity : '')) || 1} onChange={(event) => updateSelectedImageStyle({ opacity: Number(event.target.value) })} /></label>
              <label><span>Enhance</span><select value={sharedValue(selectedFields.map((field) => field.type === 'image' ? (field.style.enhancement ?? 'off') : ''))} onChange={(event) => { if (event.target.value) updateSelectedImageStyle({ enhancement: event.target.value }); }}><option value="">Multiple</option><option value="off">Original</option><option value="ai">AI enhance</option></select></label>
              <label><span>Background</span><select value={sharedValue(selectedFields.map((field) => field.type === 'image' ? (field.style.backgroundRemoval ?? (field.style.removeBackground === false ? 'off' : 'auto')) : ''))} onChange={(event) => { if (event.target.value) updateSelectedImageStyle({ backgroundRemoval: event.target.value, removeBackground: undefined }); }}><option value="">Multiple</option><option value="auto">Auto</option><option value="ai">AI quality</option><option value="off">Keep background</option></select></label>
            </> : null}
            <button className="button danger-button" onClick={deleteSelectedFields}><Trash2 size={13} /> Delete {selectedFields.length === 1 ? 'field' : `${selectedFields.length} fields`}</button>
          </div>}
        </aside>
        {mobileLayersOpen && <button className="layers-scrim" aria-label="Close layers" onClick={() => setMobileLayersOpen(false)} />}
        <aside className={`layers-panel${mobileLayersOpen ? ' mobile-open' : ''}`} aria-label="Layers">
          <div className="layers-panel-heading"><p className="eyebrow">Layers · page {currentPage + 1}</p><button className="icon-button" aria-label="Close layers" onClick={() => setMobileLayersOpen(false)}><X size={15} /></button></div>
          <div className="layers-panel-list">{currentFields.length ? currentFields.slice().sort((a, b) => b.layerIndex - a.layerIndex).map((field) => (
            <button key={field.id} draggable className={`field-list-item${selectedIds.includes(field.id) ? ' active' : ''}${layerDropTarget === field.id ? ' layer-drop-target' : ''}`} onDragStart={(event) => { event.dataTransfer.setData('text/plain', field.id); setLayerDropTarget(null); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setLayerDropTarget(field.id); }} onDragEnd={() => setLayerDropTarget(null)} onDrop={(event) => { event.preventDefault(); reorderLayers(event.dataTransfer.getData('text/plain'), field.id); setLayerDropTarget(null); }} onClick={() => { selectField(field.id); setMobileLayersOpen(false); setMobilePropertiesOpen(true); }}>
              <GripVertical size={13} /><span>{field.type === 'text' ? <Type size={13} /> : <ImageIcon size={13} />}{field.name}</span>
            </button>
          )) : <p className="muted tiny">No fields on this page.</p>}</div>
        </aside>
      </section>}

      {view === 'data' && <section className="workflow-page data-workflow-page">
        <div className="workflow-page-heading">
          <div><p className="eyebrow">Step 2 of 3</p><h1>Merge data</h1><p>{pdfDoc ? `Each row creates one complete copy of your ${pdfDoc.numPages}-page template.` : 'Open a PDF and add fields before entering merge data.'}</p></div>
          <button className="button" disabled={!pdfDoc || !fields.length || Boolean(busy)} onClick={() => addRowAndFocus()}><Plus size={14} /> Add row</button>
        </div>
        {dataTable}
        <div className="workflow-bottom-dock"><div className="workflow-bottom-dock-content"><Link href="/" className="button"><ArrowLeft size={14} /> Template</Link><Link href="/review" className="button button-dark">Review output <ArrowRight size={14} /></Link></div></div>
      </section>}

      {view === 'review' && <section className="workflow-page review-workflow-page">
        <div className="workflow-page-heading"><div><p className="eyebrow">Step 3 of 3</p><h1>Review and export</h1><p>Confirm the batch size and field placement before creating the combined PDF.</p></div></div>
        {!pdfDoc || !fields.length ? emptyWorkflow('Nothing to review yet', 'Complete the Template and Data steps before exporting.') : <>
          <section className="review-page-panel" aria-label="Page preview">
            <div className="review-page-toolbar">
              <div><p className="eyebrow">Copy preview</p><h2>Copy {activeReviewCopyIndex + 1} of {rows.length} · All {pdfDoc.numPages} pages</h2></div>
              <div><button className="button" aria-label="Previous copy" onClick={() => moveReviewCopy(-1)} disabled={activeReviewCopyIndex === 0}><ArrowLeft size={14} /> Previous copy</button><button className="button" aria-label="Next copy" onClick={() => moveReviewCopy(1)} disabled={activeReviewCopyIndex === rows.length - 1}>Next copy <ArrowRight size={14} /></button></div>
            </div>
            <div className="review-page-canvas"><ReviewPagePreview document={pdfDoc} fields={fields} row={activeReviewRow} customFonts={customFonts} /></div>
          </section>
        </>}
        <div className="workflow-bottom-dock"><div className="workflow-bottom-dock-content"><Link href="/data" className="button"><ArrowLeft size={14} /> Merge data</Link>{pdfDoc && fields.length && <div className="review-bottom-actions"><button className="button" onClick={() => void createOutput('printing')} disabled={!rows.length || Boolean(busy)}><Printer size={14} /> Print</button>{rows.length > 1 ? <div className="export-combo"><div className="export-combo-buttons"><button className="button button-dark" onClick={() => void createOutput('exporting')} disabled={Boolean(busy)}><Download size={14} /> Export PDF</button><button className="button button-dark export-options-trigger" aria-label="Export options" aria-expanded={exportMenuOpen} onClick={() => setExportMenuOpen((open) => !open)} disabled={Boolean(busy)}><ChevronDown size={14} /></button></div>{exportMenuOpen && <div className="export-menu" role="menu"><button role="menuitem" onClick={() => { setExportMenuOpen(false); void createOutput('exporting', true); }} disabled={Boolean(busy)}>One PDF per row (.zip)</button></div>}</div> : <button className="button button-dark" onClick={() => void createOutput('exporting')} disabled={!rows.length || Boolean(busy)}><Download size={14} /> Export PDF</button>}</div>}</div></div>
      </section>}

      {busy && <div className="busy-overlay" role="status" aria-live="polite"><div className="busy-card"><span className="busy-mark">{busy === 'loading' ? <FileText size={18} /> : <Check size={18} />}</span><div><strong>{busy === 'loading' ? 'Opening PDF' : busy === 'printing' ? 'Preparing print copy' : 'Creating PDF'}</strong><p>{busy === 'loading' ? 'Reading pages locally…' : `${progress}% complete`}</p></div>{busy !== 'loading' && <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>}</div></div>}
    </main>
  );
}
