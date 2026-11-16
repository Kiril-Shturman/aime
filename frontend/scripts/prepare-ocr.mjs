import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
const require = createRequire(import.meta.url);
const target = resolve(import.meta.dirname, "../public/ocr/v7");
mkdirSync(target, { recursive: true });
const core = dirname(require.resolve("tesseract.js-core/package.json"));
const worker = dirname(require.resolve("tesseract.js/package.json"));
for (const name of [
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-relaxedsimd-lstm.wasm.js",
])
  copyFileSync(resolve(core, name), resolve(target, name));
copyFileSync(
  resolve(worker, "dist/worker.min.js"),
  resolve(target, "worker.min.js"),
);
copyFileSync(
  require.resolve("@tesseract.js-data/rus/4.0.0_best_int/rus.traineddata.gz"),
  resolve(target, "rus.traineddata.gz"),
);
copyFileSync(
  resolve(worker, "LICENSE.md"),
  resolve(target, "TESSERACT-LICENSE.txt"),
);
copyFileSync(resolve(core, "LICENSE"), resolve(target, "CORE-LICENSE.txt"));
