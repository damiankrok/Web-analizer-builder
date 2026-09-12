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

/**
 * Vite's inline-worker import form. The standalone build needs the worker
 * inlined as a blob so that starting it costs no extra request — a host that
 * blocks scripted requests would otherwise stop it dead.
 */
declare module '*?worker&inline' {
  const WorkerCtor: new () => Worker
  export default WorkerCtor
}

/** Vite's build-time environment, narrowed to the flags this app reads. */
interface ImportMetaEnv {
  readonly VITE_STANDALONE?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
