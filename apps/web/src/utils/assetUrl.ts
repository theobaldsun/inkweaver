/**
 * 将服务端相对资源路径转为可访问 URL。
 * @param path 如 /uploads/avatars/xxx.png
 */
export function getAssetUrl(path: string | null | undefined): string {
  if (!path) {
    return '';
  }
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  if (path.startsWith('/')) {
    return path;
  }
  return `/${path}`;
}
