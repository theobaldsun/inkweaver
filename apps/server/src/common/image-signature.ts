/**
 * 图片文件签名（魔数）校验工具。
 *
 * 用途：防止攻击者将恶意文件（HTML/JS 等）伪装成图片上传。
 * 仅检查文件头字节序列，不依赖客户端声明的 mimetype。
 *
 * 支持的格式：JPEG、PNG、GIF、WebP
 */

/**
 * 检查 Buffer 是否匹配指定 mimetype 的图片文件签名。
 *
 * @param mimetype 图片 MIME 类型（image/jpeg | image/png | image/gif | image/webp）
 * @param buffer 文件缓冲
 * @returns 是否为真正的图片文件
 */
export function matchesImageSignature(mimetype: string, buffer: Buffer): boolean {
  if (mimetype === 'image/jpeg') {
    // JPEG: FF D8 FF
    return buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  }
  if (mimetype === 'image/png') {
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return buffer.length >= pngSignature.length && buffer.subarray(0, pngSignature.length).equals(pngSignature);
  }
  if (mimetype === 'image/gif') {
    // GIF: GIF87a or GIF89a
    if (buffer.length < 6) return false;
    const signature = buffer.subarray(0, 6).toString('ascii');
    return signature === 'GIF87a' || signature === 'GIF89a';
  }
  if (mimetype === 'image/webp') {
    // WebP: RIFF....WEBP
    return (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  return false;
}
