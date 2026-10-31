export type ColorMode = 'HEX' | 'RGB' | 'HSL'

export type ToolType = 'none' | 'rect' | 'circle' | 'arrow' | 'mosaic' | 'text'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
  title?: string
}

export interface BaseObject {
  id: string
  color: string
  strokeWidth: number
}

export interface RectObject extends BaseObject {
  type: 'rect'
  x: number
  y: number
  width: number
  height: number
}

export interface CircleObject extends BaseObject {
  type: 'circle'
  x: number
  y: number
  width: number
  height: number
}

export interface ArrowObject extends BaseObject {
  type: 'arrow'
  x1: number
  y1: number
  x2: number
  y2: number
  /** 连接在非箭头端（起点 (x1, y1)）的带边框文本 */
  text?: string
}

export interface MosaicObject {
  id: string
  type: 'mosaic'
  x: number
  y: number
  width: number
  height: number
  blockSize: number
}

export interface TextObject {
  id: string
  type: 'text'
  x: number
  y: number
  text: string
  color: string
  fontSize: number
  width?: number
  height?: number
}

export type AnnotationObject =
  | RectObject
  | CircleObject
  | ArrowObject
  | MosaicObject
  | TextObject

export interface PinnedItemData {
  id: string
  dataUrl: string
  width: number
  height: number
  x: number
  y: number
}
