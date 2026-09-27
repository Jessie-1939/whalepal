/**
 * 感知哈希（纯函数，可单元测试）：
 * 将 BGRA 位图降为 8x8 灰度网格，按行做相邻比较得到 64 位指纹。
 * 指纹间汉明距离越小，画面越相似。
 * 借鉴 MineContext 的去重思路（Apache-2.0）：对「最近多张」指纹窗口比对，而不是只比上一张，
 * 这样屏幕在 A/B 两个画面之间来回切换时不会反复分析同一张画面。
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
          // BGRA -> 灰度
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

/**
 * 在哈希窗口里找与目标相似的指纹（LRU 语义：命中时把该指纹移到末尾）。
 * @returns {number} 命中项索引；未命中返回 -1
 */
function findSimilarHash(hash, windowHashes, threshold = 4) {
  for (let i = windowHashes.length - 1; i >= 0; i--) {
    if (hammingDistance(hash, windowHashes[i]) <= threshold) {
      const [hit] = windowHashes.splice(i, 1);
      windowHashes.push(hit);
      return windowHashes.length - 1;
    }
  }
  return -1;
}

module.exports = { dHashFromBitmap, hammingDistance, findSimilarHash };
