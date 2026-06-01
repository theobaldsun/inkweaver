/**
 * 从 JWT 载荷解析当前用户 ID。
 *
 * @param user JWT verify 后的 request.user
 * @returns 用户 UUID
 */
export function getUserId(user: { sub?: string; id?: string } | undefined): string {
  const id = user?.sub ?? user?.id;
  if (!id) {
    throw new Error('Missing user id in JWT payload');
  }
  return id;
}
