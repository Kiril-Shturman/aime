import { parsePassportText, type PassportFields } from "./passport-ocr";
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
  const { createWorker, PSM } = await import("tesseract.js");
  signal.throwIfAborted();
  const image = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  const canvases: HTMLCanvasElement[] = [];
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  const stop = () => {
    void worker?.terminate();
  };
  signal.addEventListener("abort", stop, { once: true });
  try {
    signal.throwIfAborted();
    const sx = (image.width * Math.max(0, Math.min(99, crop.x))) / 100;
    const sy = (image.height * Math.max(0, Math.min(99, crop.y))) / 100;
    const sw = Math.min(
      image.width - sx,
      (image.width * Math.max(1, crop.width)) / 100,
    );
    const sh = Math.min(
      image.height - sy,
      (image.height * Math.max(1, crop.height)) / 100,
    );
    const scale = Math.min(3, 2600 / Math.max(sw, sh));
    const canvas = document.createElement("canvas");
    canvases.push(canvas);
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw Error("Image unavailable");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    // Stretch luminance, rather than thresholding away faint printed labels.
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const histogram = new Uint32Array(256);
    for (let i = 0; i < pixels.data.length; i += 4)
      histogram[
        Math.round(
          0.299 * pixels.data[i] +
            0.587 * pixels.data[i + 1] +
            0.114 * pixels.data[i + 2],
        )
      ]++;
    const count = canvas.width * canvas.height;
    let low = 0,
      high = 255,
      sum = 0;
    while (low < 254 && (sum += histogram[low]) < count * 0.01) low++;
    sum = 0;
    while (high > low + 1 && (sum += histogram[high]) < count * 0.01) high--;
    for (let i = 0; i < pixels.data.length; i += 4) {
      const gray =
        0.299 * pixels.data[i] +
        0.587 * pixels.data[i + 1] +
        0.114 * pixels.data[i + 2];
      const v = Math.max(
        0,
        Math.min(255, ((gray - low) * 255) / Math.max(1, high - low)),
      );
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = v;
    }
    context.putImageData(pixels, 0, 0);
    let pass = 0;
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
              ? Math.min(99, 30 + pass * 20 + Math.round(progress * 20))
              : Math.round(progress * 25),
          );
      },
      errorHandler: () => {},
    });
    signal.throwIfAborted();
    await worker.setParameters({
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
    });
    const merged: PassportFields = {};
    const run = async (source: HTMLCanvasElement, sparse = false) => {
      signal.throwIfAborted();
      await worker!.setParameters({
        tessedit_pageseg_mode: sparse ? PSM.SPARSE_TEXT : PSM.AUTO,
      });
      const result = await worker!.recognize(
        source,
        { rotateAuto: true },
        { text: true },
      );
      signal.throwIfAborted();
      const found = parsePassportText(result.data.text);
      for (const key of Object.keys(found) as (keyof PassportFields)[])
        if (!merged[key]) merged[key] = found[key];
      pass++;
    };
    await run(canvas);
    if (Object.keys(merged).length < 5) await run(canvas, true);
    // Read the lower identity page separately; portraits, stamps and the fold
    // otherwise disrupt line segmentation across a full passport spread.
    if (!merged.first_name || !merged.last_name || !merged.birth_date) {
      const bottom = document.createElement("canvas");
      canvases.push(bottom);
      bottom.width = canvas.width;
      bottom.height = Math.round(canvas.height * 0.6);
      bottom
        .getContext("2d")!
        .drawImage(
          canvas,
          0,
          canvas.height * 0.4,
          canvas.width,
          canvas.height * 0.6,
          0,
          0,
          bottom.width,
          bottom.height,
        );
      await run(bottom, true);
    }
    if (!merged.passport) {
      signal.throwIfAborted();
      const strip = document.createElement("canvas");
      canvases.push(strip);
      strip.width = canvas.height;
      strip.height = Math.max(1, Math.round(canvas.width * 0.2));
      const ctx = strip.getContext("2d")!;
      ctx.translate(0, strip.height);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(
        canvas,
        canvas.width * 0.8,
        0,
        canvas.width * 0.2,
        canvas.height,
        0,
        0,
        strip.height,
        strip.width,
      );
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        tessedit_char_whitelist: "0123456789 ",
      });
      const result = await worker.recognize(strip, {}, { text: true });
      signal.throwIfAborted();
      const number = parsePassportText(result.data.text).passport;
      if (number && result.data.confidence >= 70) merged.passport = number;
    }
    if (
      merged.passport_issue_date &&
      merged.birth_date &&
      merged.passport_issue_date <= merged.birth_date
    )
      delete merged.passport_issue_date;
    onProgress(100);
    return merged;
  } finally {
    signal.removeEventListener("abort", stop);
    await worker?.terminate();
    image.close();
    for (const canvas of canvases) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
