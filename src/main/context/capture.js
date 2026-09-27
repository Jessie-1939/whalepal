const { desktopCapturer, screen } = require('electron');

/**
 * 截取主显示器缩略图。缩略图尺寸上限 1280x720，降低云端模型 token 消耗。
 * 返回 { image: NativeImage, displayId, name } 或 null。
 */
async function capturePrimaryScreen({ width = 1280, height = 720 } = {}) {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
    fetchWindowIcons: false
  });
  if (!sources.length) return null;
  const primaryId = String(screen.getPrimaryDisplay().id);
  const src = sources.find((s) => s.display_id === primaryId) || sources[0];
  const image = src.thumbnail;
  if (!image || image.isEmpty()) return null;
  return { image, displayId: src.display_id, name: src.name };
}

module.exports = { capturePrimaryScreen };
