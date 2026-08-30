export type FieldKind = 'text' | 'image';

export type NormalizedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TextStyle = {
  fontFamily: string;
  fontFileId?: string;
  fontWeight: 'regular' | 'bold';
  fontSize: number;
  minFontSize: number;
  color: string;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
};

export type CustomFont = {
  id: string;
  name: string;
  previewFamily: string;
  bytes: Uint8Array;
};

export type ImageStyle = {
  fit: 'contain' | 'cover';
  opacity: number;
  /** `removeBackground` is retained only to migrate in-memory sessions created before v1. */
  backgroundRemoval?: 'auto' | 'ai' | 'off';
  enhancement?: 'off' | 'ai';
  removeBackground?: boolean;
};

type BaseField = {
  id: string;
  name: string;
  pageIndex: number;
  layerIndex: number;
  rect: NormalizedRect;
  rotation: number;
};

export type TemplateField =
  | (BaseField & { type: 'text'; style: TextStyle })
  | (BaseField & { type: 'image'; style: ImageStyle });

export type ImageCellValue = {
  kind: 'image';
  name: string;
  dataUrl: string;
};

export type CellValue = string | ImageCellValue | null;

export type MergeRow = {
  id: string;
  values: Record<string, CellValue>;
};

export type PageGeometry = {
  width: number;
  height: number;
  transform: [number, number, number, number, number, number];
};
