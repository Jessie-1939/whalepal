/**
 * 感知哈希（纯函数，可单元测试）：
 * 将 BGRA 位图降为 8x8 灰度网格，按行做相邻比较得到 64 位指纹。
 * 指纹间汉明距离越小，画面越相似。
 */

function dHashFromBitmap(buf, width, height) {
  const grid = new Array(64);
  const bw = width / 8;
  const bh = height / 8;
  for (let by = 0; by < 8; by++) {
    for (let bx = 0; bx < 8; bx++) {
      const x0 = Math.floor(bx * bw);
      const y0 = Math.floor(by * bh);
      const x1 = Math.max(x0 + 1, Math.floor((bx + 1) * bw));
      const y1 = Math.max(y0 + 1, Math.floor((by + 1) * bh));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1 && y < height; y++) {
        for (let x = x0; x < x1 && x < width; x++) {
          const i = (y * width + x) * 4;
          // BGRA -> 灰度（权重按 RGB 顺序取对应字节）
          sum += 0.114 * buf[i] + 0.587 * buf[i + 1] + 0.299 * buf[i + 2];
          n++;
        }
      }
      grid[by * 8 + bx] = n ? sum / n : 0;
    }
  }
  let bits = 0n;
  for (let i = 0; i < 64; i++) {
    const j = i % 8 === 7 ? i : i + 1;
    if (grid[i] > grid[j]) bits |= 1n << BigInt(i);
  }
  return bits;
}

function hammingDistance(a, b) {
  let x = a ^ b;
  let count = 0;
  while (x) {
    count++;
    x &= x - 1n;
  }
  return count;
}

module.exports = { dHashFromBitmap, hammingDistance };
