import type { PassportFields } from "./passport-ocr";
export type PassportCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export async function recognizePassport(
  file: File,
  signal: AbortSignal,
  onProgress: (percent: number) => void,
  crop: PassportCrop = { x: 0, y: 0, width: 100, height: 100 },
): Promise<PassportFields> {
  // Temporary explicit comparison switch for testing; no silent fallback.
  if (new URLSearchParams(location.search).get("passportOcr") === "tesseract") {
    return (await import("./recognize-passport-tesseract")).recognizePassport(
      file,
      signal,
      onProgress,
      crop,
    );
  }
  signal.throwIfAborted();
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  const canvas = document.createElement("canvas");
  try {
    signal.throwIfAborted();
    const sx = (bitmap.width * Math.max(0, Math.min(99, crop.x))) / 100,
      sy = (bitmap.height * Math.max(0, Math.min(99, crop.y))) / 100;
    const sw = Math.min(
        bitmap.width - sx,
        (bitmap.width * Math.max(1, crop.width)) / 100,
      ),
      sh = Math.min(
        bitmap.height - sy,
        (bitmap.height * Math.max(1, crop.height)) / 100,
      ),
      scale = Math.min(1, 2000 / Math.max(sw, sh));
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw Error("Image unavailable");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
      bitmap,
      sx,
      sy,
      sw,
      sh,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    return await new Promise<PassportFields>((resolve, reject) => {
      const worker = new Worker(
        new URL("./paddle-ocr.worker.ts", import.meta.url),
        { type: "module" },
      );
      let settled = false;
      const finish = (error?: Error, result?: PassportFields) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        worker.terminate();
        if (error) reject(error);
        else resolve(result || {});
      };
      const abort = () => finish(new DOMException("Cancelled", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      worker.onerror = () =>
        finish(Error("Не удалось запустить распознавание на этом устройстве."));
      worker.onmessage = (event: MessageEvent) => {
        if (event.data.type === "progress") onProgress(event.data.percent);
        if (event.data.type === "result") {
          onProgress(100);
          finish(undefined, event.data.fields);
        }
        if (event.data.type === "error") finish(Error(event.data.message));
      };
      if (signal.aborted) {
        abort();
        return;
      }
      worker.postMessage(
        {
          width: canvas.width,
          height: canvas.height,
          rgba: pixels.data.buffer,
          base: new URL("/ocr/paddle-v1/", location.origin).href,
        },
        [pixels.data.buffer],
      );
    });
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}
