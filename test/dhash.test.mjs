import test from 'node:test';
import assert from 'node:assert/strict';
import dh from '../src/main/context/dhash.js';

function makeBuf(width, height, fn) {
  const buf = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = fn(x, y) & 0xff;
      buf[i] = v;
      buf[i + 1] = v;
      buf[i + 2] = v;
      buf[i + 3] = 255;
    }
  }
  return buf;
}

function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test('相同画面距离为 0', () => {
  const b = makeBuf(64, 64, (x) => x * 4);
  assert.equal(dh.hammingDistance(dh.dHashFromBitmap(b, 64, 64), dh.dHashFromBitmap(b, 64, 64)), 0);
});

test('不同内容的画面距离显著', () => {
  const r1 = prng(1);
  const r2 = prng(99999);
  const a = makeBuf(64, 64, () => Math.floor(r1() * 256));
  const b = makeBuf(64, 64, () => Math.floor(r2() * 256));
  const d = dh.hammingDistance(dh.dHashFromBitmap(a, 64, 64), dh.dHashFromBitmap(b, 64, 64));
  assert.ok(d >= 12, `expected distance >= 12, got ${d}`);
});

test('左右分区与上下分区差异明显', () => {
  const leftRight = makeBuf(64, 64, (x) => (x < 32 ? 255 : 0));
  const topBottom = makeBuf(64, 64, (_x, y) => (y < 32 ? 255 : 0));
  const d = dh.hammingDistance(dh.dHashFromBitmap(leftRight, 64, 64), dh.dHashFromBitmap(topBottom, 64, 64));
  assert.ok(d >= 8, `expected distance >= 8, got ${d}`);
});
