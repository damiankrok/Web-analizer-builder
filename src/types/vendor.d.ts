/** Minimal ambient types for untyped decoder libraries used by the Node adapter. */
declare module 'pngjs' {
  export class PNG {
    constructor(options?: { width?: number; height?: number })
    width: number
    height: number
    data: Buffer
    static sync: { read(buffer: Buffer): PNG; write(png: PNG): Buffer }
  }
}

declare module 'omggif' {
  export class GifReader {
    constructor(buf: Uint8Array)
    width: number
    height: number
    numFrames(): number
    decodeAndBlitFrameRGBA(frame: number, out: number[] | Uint8ClampedArray): void
  }
}

declare module 'jsts/org/locationtech/jts/geom.js' {
  const anyExport: any
  export = anyExport
}
