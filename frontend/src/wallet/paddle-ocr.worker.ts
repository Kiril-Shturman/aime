import * as ort from "onnxruntime-web/wasm";
import {
  detectionInput,
  detectionBoxes,
  recognitionInput,
  decodeCTC,
  readingOrder,
  type PixelImage,
} from "./paddle-ocr-core";
import { parsePassportText } from "./passport-ocr";

self.addEventListener(
  "message",
  async (
    event: MessageEvent<{
      width: number;
      height: number;
      rgba: ArrayBuffer;
      base: string;
    }>,
  ) => {
    const { width, height, rgba, base } = event.data;
    const image: PixelImage = {
      width,
      height,
      data: new Uint8ClampedArray(rgba),
    };
    let det: ort.InferenceSession | undefined,
      rec: ort.InferenceSession | undefined;
    const progress = (percent: number) =>
      self.postMessage({ type: "progress", percent });
    try {
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = base;
      const options: ort.InferenceSession.SessionOptions = {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
        logSeverityLevel: 3,
      };
      progress(3);
      const dictionaryResponse = await fetch(base + "dictionary.json");
      if (!dictionaryResponse.ok) throw Error("Dictionary unavailable");
      const dictionary: string[] = await dictionaryResponse.json();
      det = await ort.InferenceSession.create(base + "det.onnx", options);
      progress(15);
      rec = await ort.InferenceSession.create(base + "rec.onnx", options);
      progress(25);
      const input = detectionInput(image),
        tensor = new ort.Tensor("float32", input.data, [
          1,
          3,
          input.height,
          input.width,
        ]);
      const output = await det.run({ [det.inputNames[0]]: tensor });
      tensor.dispose();
      const map = output[det.outputNames[0]],
        dims = map.dims;
      const boxes = detectionBoxes(
        map.data as Float32Array,
        dims[dims.length - 1],
        dims[dims.length - 2],
        width,
        height,
      );
      Object.values(output).forEach((value) => value.dispose());
      progress(38);
      const lines: { text: string; box: (typeof boxes)[number] }[] = [];
      const read = async (box: (typeof boxes)[number], flip = false) => {
        const input = recognitionInput(image, box, flip),
          tensor = new ort.Tensor("float32", input.data, [
            1,
            3,
            input.height,
            input.width,
          ]);
        const output = await rec!.run({ [rec!.inputNames[0]]: tensor });
        tensor.dispose();
        const result = output[rec!.outputNames[0]],
          dims = result.dims;
        const decoded = decodeCTC(
          result.data as Float32Array,
          dims[dims.length - 2],
          dims[dims.length - 1],
          dictionary,
        );
        Object.values(output).forEach((value) => value.dispose());
        return decoded;
      };
      for (let i = 0; i < boxes.length; i++) {
        let line = await read(boxes[i]);
        if (line.confidence < 0.7) {
          const reversed = await read(boxes[i], true);
          if (reversed.confidence > line.confidence) line = reversed;
        }
        if (line.text && line.confidence >= 0.55)
          lines.push({ text: line.text, box: boxes[i] });
        progress(38 + Math.round(((i + 1) / Math.max(1, boxes.length)) * 60));
      }
      const text = readingOrder(lines),
        fields = parsePassportText(text);
      // Only whitelisted, editable passport fields leave the worker. No raw OCR
      // text, image, or identity data is logged or sent to any server.
      self.postMessage({
        type: "result",
        fields,
        detected: boxes.length,
        recognized: lines.length,
      });
    } catch {
      self.postMessage({
        type: "error",
        message:
          "Не удалось запустить распознавание на этом устройстве. Попробуйте другое фото или заполните поля вручную.",
      });
    } finally {
      await Promise.allSettled([det?.release(), rec?.release()]);
      image.data.fill(0);
    }
  },
);
