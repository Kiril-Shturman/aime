export type PixelImage = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};
export type TextBox = {
  cx: number;
  cy: number;
  width: number;
  height: number;
  angle: number;
  score: number;
};
const mean = [0.485, 0.456, 0.406],
  std = [0.229, 0.224, 0.225];
function pixel(image: PixelImage, x: number, y: number, c: number): number {
  if (x < 0 || y < 0 || x > image.width - 1 || y > image.height - 1) return 255;
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    x1 = Math.min(image.width - 1, x0 + 1),
    y1 = Math.min(image.height - 1, y0 + 1),
    dx = x - x0,
    dy = y - y0;
  const p = (px: number, py: number) =>
    image.data[(py * image.width + px) * 4 + c];
  return (
    p(x0, y0) * (1 - dx) * (1 - dy) +
    p(x1, y0) * dx * (1 - dy) +
    p(x0, y1) * (1 - dx) * dy +
    p(x1, y1) * dx * dy
  );
}
export function detectionInput(image: PixelImage, side = 960) {
  const scale = Math.min(1, side / Math.max(image.width, image.height));
  const width = Math.max(32, Math.round((image.width * scale) / 32) * 32),
    height = Math.max(32, Math.round((image.height * scale) / 32) * 32),
    plane = width * height;
  const data = new Float32Array(plane * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let c = 0; c < 3; c++)
        data[c * plane + y * width + x] =
          (pixel(
            image,
            ((x + 0.5) * image.width) / width - 0.5,
            ((y + 0.5) * image.height) / height - 0.5,
            2 - c,
          ) /
            255 -
            mean[c]) /
          std[c];
  return { data, width, height };
}
export function detectionBoxes(
  map: Float32Array,
  width: number,
  height: number,
  sourceWidth: number,
  sourceHeight: number,
): TextBox[] {
  const seen = new Uint8Array(width * height),
    queue = new Int32Array(width * height),
    boxes: TextBox[] = [];
  for (let seed = 0; seed < map.length; seed++) {
    if (seen[seed] || map[seed] < 0.3) continue;
    let head = 0,
      tail = 1,
      sx = 0,
      sy = 0,
      sxx = 0,
      syy = 0,
      sxy = 0,
      score = 0;
    queue[0] = seed;
    seen[seed] = 1;
    while (head < tail) {
      const at = queue[head++],
        x = at % width,
        y = Math.floor(at / width);
      sx += x;
      sy += y;
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
      score += map[at];
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = ny * width + nx;
        if (!seen[n] && map[n] >= 0.3) {
          seen[n] = 1;
          queue[tail++] = n;
        }
      }
    }
    if (tail < 12 || score / tail < 0.55) continue;
    const cx = sx / tail,
      cy = sy / tail,
      angle =
        0.5 *
        Math.atan2(
          2 * (sxy / tail - cx * cy),
          sxx / tail - cx * cx - (syy / tail - cy * cy),
        );
    const cos = Math.cos(angle),
      sin = Math.sin(angle);
    let minU = Infinity,
      maxU = -Infinity,
      minV = Infinity,
      maxV = -Infinity;
    for (let i = 0; i < tail; i++) {
      const x = (queue[i] % width) - cx,
        y = Math.floor(queue[i] / width) - cy,
        u = x * cos + y * sin,
        v = -x * sin + y * cos;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const w = maxU - minU + 1,
      h = maxV - minV + 1;
    if (w < 4 || h < 2) continue;
    const unclip = (w * h * 1.5) / (2 * (w + h)),
      u = (minU + maxU) / 2,
      v = (minV + maxV) / 2;
    boxes.push({
      cx: ((cx + u * cos - v * sin) * sourceWidth) / width,
      cy: ((cy + u * sin + v * cos) * sourceHeight) / height,
      width: ((w + 2 * unclip) * sourceWidth) / width,
      height: ((h + 2 * unclip) * sourceHeight) / height,
      angle,
      score: score / tail,
    });
  }
  return boxes
    .sort((a, b) => b.score - a.score)
    .slice(0, 90)
    .sort((a, b) => a.cy - b.cy);
}
export function recognitionInput(
  image: PixelImage,
  box: TextBox,
  flip = false,
) {
  const height = 48,
    resizedWidth = Math.max(
      8,
      Math.min(1280, Math.ceil((height * box.width) / box.height)),
    ),
    width = Math.max(320, Math.ceil(resizedWidth / 32) * 32),
    plane = width * height;
  const data = new Float32Array(plane * 3),
    angle = box.angle + (flip ? Math.PI : 0),
    cos = Math.cos(angle),
    sin = Math.sin(angle);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < resizedWidth; x++) {
      const u = ((x + 0.5) / resizedWidth - 0.5) * box.width,
        v = ((y + 0.5) / height - 0.5) * box.height;
      for (let c = 0; c < 3; c++)
        data[c * plane + y * width + x] =
          pixel(
            image,
            box.cx + u * cos - v * sin,
            box.cy + u * sin + v * cos,
            2 - c,
          ) /
            127.5 -
          1;
    }
  return { data, width, height };
}
export function decodeCTC(
  data: Float32Array,
  steps: number,
  classes: number,
  dictionary: string[],
) {
  if (classes !== dictionary.length) throw Error("OCR dictionary mismatch");
  let text = "",
    sum = 0,
    count = 0,
    previous = -1;
  for (let t = 0; t < steps; t++) {
    let index = 0,
      best = -Infinity;
    for (let c = 0; c < classes; c++) {
      const value = data[t * classes + c];
      if (value > best) {
        best = value;
        index = c;
      }
    }
    if (index !== 0 && index !== previous) {
      text += dictionary[index];
      sum += best;
      count++;
    }
    previous = index;
  }
  return { text: text.trim(), confidence: count ? sum / count : 0 };
}
export function readingOrder(lines: { text: string; box: TextBox }[]): string {
  const horizontal = lines.filter(
    (line) => Math.abs(Math.cos(line.box.angle)) > 0.5,
  );
  const vertical = lines.filter(
    (line) => Math.abs(Math.cos(line.box.angle)) <= 0.5,
  );
  const angle = horizontal.length
    ? horizontal.reduce((sum, line) => sum + line.box.angle, 0) /
      horizontal.length
    : 0;
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  const ordered = horizontal.map((line) => ({
    ...line,
    box: {
      ...line.box,
      cx: line.box.cx * cos + line.box.cy * sin,
      cy: -line.box.cx * sin + line.box.cy * cos,
    },
  }));
  const rows: { cy: number; height: number; items: typeof lines }[] = [];
  for (const line of ordered.sort((a, b) => a.box.cy - b.box.cy)) {
    const row = rows.find(
      (row) =>
        Math.abs(row.cy - line.box.cy) <
        Math.min(row.height, line.box.height) * 0.55,
    );
    if (row) row.items.push(line);
    else rows.push({ cy: line.box.cy, height: line.box.height, items: [line] });
  }
  return rows
    .map((row) =>
      row.items
        .sort((a, b) => a.box.cx - b.box.cx)
        .map((line) => line.text)
        .join(" "),
    )
    .concat(vertical.map((line) => line.text))
    .join("\n");
}
