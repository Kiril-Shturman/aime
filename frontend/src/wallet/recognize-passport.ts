import { parsePassportText, type PassportFields } from "./passport-ocr";

export async function recognizePassport(
  file: File,
  signal: AbortSignal,
  onProgress: (percent: number) => void,
): Promise<PassportFields> {
  const { createWorker } = await import("tesseract.js");
  signal.throwIfAborted();
  const image = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  let canvas: HTMLCanvasElement | undefined;
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  const stop = () => {
    void worker?.terminate();
  };
  signal.addEventListener("abort", stop, { once: true });
  try {
    signal.throwIfAborted();
    const scale = Math.min(1, 2400 / Math.max(image.width, image.height));
    canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw Error("Image unavailable");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    // Only models and code are fetched. The image is sent to our local Web Worker.
    worker = await createWorker("rus", 1, {
      workerPath: new URL("/ocr/v7/worker.min.js", location.origin).href,
      corePath: new URL("/ocr/v7", location.origin).href,
      langPath: new URL("/ocr/v7", location.origin).href,
      workerBlobURL: false,
      cacheMethod: "none",
      logger: ({ status, progress }) => {
        if (!signal.aborted)
          onProgress(
            status === "recognizing text"
              ? 35 + Math.round(progress * 65)
              : Math.round(progress * 30),
          );
      },
      errorHandler: () => {},
    });
    signal.throwIfAborted();
    await worker.setParameters({ preserve_interword_spaces: "1" });
    const result = await worker.recognize(
      canvas,
      { rotateAuto: true },
      { text: true },
    );
    signal.throwIfAborted();
    return parsePassportText(result.data.text);
  } finally {
    signal.removeEventListener("abort", stop);
    await worker?.terminate();
    image.close();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
