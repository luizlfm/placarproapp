declare module 'dom-to-image-more' {
  export interface DomToImageOptions {
    bgcolor?: string;
    width?: number;
    height?: number;
    scale?: number;
    cacheBust?: boolean;
    style?: Record<string, string>;
    filter?: (node: Node) => boolean;
    quality?: number;
  }

  export function toPng(node: HTMLElement, options?: DomToImageOptions): Promise<string>;
  export function toJpeg(node: HTMLElement, options?: DomToImageOptions): Promise<string>;
  export function toBlob(node: HTMLElement, options?: DomToImageOptions): Promise<Blob>;
  export function toSvg(node: HTMLElement, options?: DomToImageOptions): Promise<string>;
  export function toPixelData(node: HTMLElement, options?: DomToImageOptions): Promise<Uint8ClampedArray>;

  const _default: {
    toPng: typeof toPng;
    toJpeg: typeof toJpeg;
    toBlob: typeof toBlob;
    toSvg: typeof toSvg;
    toPixelData: typeof toPixelData;
  };
  export default _default;
}
