/**
 * 记忆体积统计（纯函数）：把「文本记忆 vs 图片记忆」的取舍变成可复算的数字。
 *
 * 实测基准（本机 1280×720 JPEG q72 截屏）：单张 ≈ 87.4 KB；单条事件 ≈ 323 B。
 * 结论：图片不是"更小的存储"，除非内容本身是感知性的（照片/视频）；
 * 屏幕上下文的信息主体是文本，文本记忆的"每字节可用信息量"高出一个数量级。
 */

function computeStorageStats({
  eventBytes = 0,
  eventCount = 0,
  imageBytes = 0,
  intervalSec = 60,
  activeDays = 1
} = {}) {
  const safeDays = Math.max(1, Number(activeDays) || 1);
  const avgEventBytes = eventCount > 0 ? Math.round(eventBytes / eventCount) : 0;
  const eventsPerDay = eventCount > 0 ? Math.round(eventCount / safeDays) : 0;
  const textPerDayBytes = avgEventBytes * eventsPerDay;
  const perDayImages = Math.round(86400 / Math.max(15, Number(intervalSec) || 60));
  const imagePerDayFull = perDayImages * imageBytes;
  const imagePerDayDedup = eventsPerDay * imageBytes;

  return {
    eventCount,
    eventBytes,
    avgEventBytes,
    imageBytes,
    eventsPerDay,
    textPerDayBytes: textPerDayBytes,
    textPerMonthBytes: textPerDayBytes * 30,
    imagePerDayFull,
    imagePerMonthFull: imagePerDayFull * 30,
    imagePerDayDedup,
    imagePerMonthDedup: imagePerDayDedup * 30,
    ratioPerEvent: avgEventBytes > 0 && imageBytes > 0 ? Math.round(imageBytes / avgEventBytes) : 0
  };
}

module.exports = { computeStorageStats };
