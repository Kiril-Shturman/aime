import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeCTC,
  detectionBoxes,
  recognitionInput,
  readingOrder,
} from "../src/wallet/paddle-ocr-core.ts";
test("CTC collapses repeats but preserves characters separated by blank", () => {
  const dictionary = ["", "А", "Б", " "],
    indices = [1, 1, 0, 1, 3, 2];
  const data = new Float32Array(indices.length * 4);
  indices.forEach((v, i) => (data[i * 4 + v] = 0.95));
  assert.equal(decodeCTC(data, 6, 4, dictionary).text, "АА Б");
  assert.throws(() => decodeCTC(data, 6, 4, ["", "А"]), /dictionary/);
});
test("detector rejects noise and maps text regions back to source coordinates", () => {
  const map = new Float32Array(32 * 16);
  for (let y = 6; y < 10; y++)
    for (let x = 5; x < 25; x++) map[y * 32 + x] = 0.9;
  map[0] = 0.99;
  const boxes = detectionBoxes(map, 32, 16, 320, 160);
  assert.equal(boxes.length, 1);
  assert.ok(Math.abs(boxes[0].cx - 145) < 1);
  assert.ok(Math.abs(boxes[0].cy - 75) < 1);
  assert.ok(boxes[0].width > 200);
});
test("recognizer uses BGR normalization with neutral right padding", () => {
  const image = {
    width: 20,
    height: 10,
    data: new Uint8ClampedArray(20 * 10 * 4),
  };
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = 255;
    image.data[i + 3] = 255;
  }
  const input = recognitionInput(image, {
    cx: 9.5,
    cy: 4.5,
    width: 16,
    height: 8,
    angle: 0,
    score: 1,
  });
  assert.equal(input.width, 320);
  assert.equal(input.data[24 * 320 + 40], -1);
  assert.equal(input.data[2 * 320 * 48 + 24 * 320 + 40], 1);
  assert.equal(input.data[319], 0);
});
test("separate label and value boxes are joined in reading order", () => {
  const box = { cx: 0, cy: 50, width: 80, height: 20, angle: 0, score: 1 };
  assert.equal(
    readingOrder([
      { text: "ИВАНОВ", box: { ...box, cx: 200 } },
      { text: "Фамилия", box: { ...box, cx: 50 } },
      { text: "Имя ИВАН", box: { ...box, cy: 100 } },
    ]),
    "Фамилия ИВАНОВ\nИмя ИВАН",
  );
});

test("vertical passport number cannot contaminate a name row", () => {
  const base = { cx: 50, cy: 50, width: 80, height: 20, angle: 0, score: 1 };
  assert.equal(
    readingOrder([
      { text: "Фамилия", box: base },
      { text: "ИВАНОВ", box: { ...base, cx: 200 } },
      { text: "1234567890", box: { ...base, cx: 400, angle: Math.PI / 2 } },
    ]),
    "Фамилия ИВАНОВ\n1234567890",
  );
});
