/**
 * 由桌宠窗口的连续帧生成 README 动图（透明背景合成到冷灰渐变上）。
 *
 * 用法：
 *   1) 采集帧：WHALEPAL_DEBUG_FRAMES=16 启动应用（帧存到 data/gif-frames/）
 *   2) 生成 GIF：npm run gif   （等价于 node scripts/make-readme-gif.mjs [帧目录] [输出] [帧间隔ms]）
 */
import fs from 'node:fs';
import path from 'node:path';
import pngjs from 'pngjs';
import gifenc from 'gifenc';

const { PNG } = pngjs;
const { GIFEncoder, quantize, applyPalette } = gifenc;

const DIR = process.argv[2] || path.join('data', 'gif-frames');
const OUT = process.argv[3] || path.join('docs', 'images', 'demo.gif');
const DELAY_MS = Number(process.argv[4]) || 350;
const TARGET_WIDTH = Number(process.argv[5]) || 320;

const files = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.png'))
  .sort();
if (!files.length) {
  console.error(`没有找到帧文件: ${DIR}`);
  process.exit(1);
}

// 冷灰渐变背景（与 Apple 风格地面一致，避免透明 GIF 在深色主题下发虚）
function makeBackground(width, height) {
  const buf = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const t = y / Math.max(1, height - 1);
    const r = Math.round(245 - 12 * t);
    const g = Math.round(247 - 10 * t);
    const b = Math.round(250 - 8 * t);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = 255;
    }
  }
  return buf;
}

const gif = GIFEncoder();
let palette = null;
let width = 0;
let height = 0;

/** 盒式降采样：把合成后的整帧缩到目标宽度，控制 GIF 体积。 */
function downscale(src, srcW, srcH, dstW, dstH) {
  const dst = Buffer.alloc(dstW * dstH * 4);
  const sx = srcW / dstW;
  const sy = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.min(srcH, Math.max(y0 + 1, Math.ceil((y + 1) * sy)));
    for (let x = 0; x < dstW; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.min(srcW, Math.max(x0 + 1, Math.ceil((x + 1) * sx)));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * srcW + xx) * 4;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          n++;
        }
      }
      const o = (y * dstW + x) * 4;
      dst[o] = Math.round(r / n);
      dst[o + 1] = Math.round(g / n);
      dst[o + 2] = Math.round(b / n);
      dst[o + 3] = 255;
    }
  }
  return dst;
}

for (const file of files) {
  const png = PNG.sync.read(fs.readFileSync(path.join(DIR, file)));
  width = png.width;
  height = png.height;
  const canvas = makeBackground(width, height);
  const src = png.data;
  for (let i = 0; i < width * height; i++) {
    const a = src[i * 4 + 3] / 255;
    if (a <= 0) continue;
    canvas[i * 4] = Math.round(src[i * 4] * a + canvas[i * 4] * (1 - a));
    canvas[i * 4 + 1] = Math.round(src[i * 4 + 1] * a + canvas[i * 4 + 1] * (1 - a));
    canvas[i * 4 + 2] = Math.round(src[i * 4 + 2] * a + canvas[i * 4 + 2] * (1 - a));
  }
  if (!palette) palette = quantize(canvas, 256, { format: 'rgb565' });
  const scale = Math.min(1, TARGET_WIDTH / width);
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));
  const scaled = scale < 1 ? downscale(canvas, width, height, outW, outH) : canvas;
  const index = applyPalette(scaled, palette, 'rgb565');
  gif.writeFrame(index, outW, outH, { palette, delay: DELAY_MS });
}

gif.finish();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, gif.bytes());
console.log(
  `GIF 已生成: ${OUT}（${files.length} 帧 · ${width}×${height} · ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB）`
);
