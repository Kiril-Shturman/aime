import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  existsSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { parse } from "yaml";
const require = createRequire(import.meta.url);
const target = resolve(import.meta.dirname, "../public/ocr/paddle-v1");
mkdirSync(target, { recursive: true });
const assets = JSON.parse(
  readFileSync(new URL("./paddle-models.json", import.meta.url), "utf8"),
);
for (const { name, url, sha256 } of assets) {
  const path = resolve(target, name);
  if (
    existsSync(path) &&
    createHash("sha256").update(readFileSync(path)).digest("hex") === sha256
  )
    continue;
  const response = await fetch(url);
  if (!response.ok) throw Error(`OCR asset download failed: ${name}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(data).digest("hex") !== sha256)
    throw Error(`OCR asset checksum mismatch: ${name}`);
  writeFileSync(path, data);
}
const cfg = parse(readFileSync(resolve(target, "rec.yml"), "utf8"));
writeFileSync(
  resolve(target, "dictionary.json"),
  JSON.stringify(["", ...cfg.PostProcess.character_dict, " "]),
);
const ort = resolve(dirname(require.resolve("onnxruntime-web")), "..");
for (const file of [
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
])
  copyFileSync(resolve(ort, "dist", file), resolve(target, file));
copyFileSync(resolve(ort, "dist", "ort.min.js"), resolve(target, "ort.min.js"));
copyFileSync(
  resolve(ort, "dist", "ort.wasm.min.js"),
  resolve(target, "ort.wasm.min.js"),
);
copyFileSync(
  new URL("./licenses/onnxruntime.txt", import.meta.url),
  resolve(target, "ONNX-LICENSE.txt"),
);
copyFileSync(
  new URL("./licenses/paddleocr.txt", import.meta.url),
  resolve(target, "PADDLE-LICENSE.txt"),
);
writeFileSync(
  resolve(target, "MODELS.txt"),
  "PaddlePaddle PP-OCRv5 mobile detector and Cyrillic recognizer. Apache-2.0.\nSources and checksums: frontend/scripts/paddle-models.json\n",
);
