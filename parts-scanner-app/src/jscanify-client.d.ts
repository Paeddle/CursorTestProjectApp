declare module 'jscanify/client' {
  interface JScanifyInstance {
    extractPaper(
      image: HTMLImageElement | HTMLCanvasElement,
      resultWidth: number,
      resultHeight: number,
      cornerPoints?: unknown
    ): HTMLCanvasElement | null
  }
  const JScanify: new () => JScanifyInstance
  export default JScanify
}
