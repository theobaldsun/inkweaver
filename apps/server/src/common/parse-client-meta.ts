/**
 * 从请求头解析客户端设备信息（用于会话展示）。
 */

export interface ClientMeta {
  deviceType?: string;
  deviceName?: string;
  browser?: string;
  os?: string;
  ipAddress?: string;
}

/**
 * @param userAgent User-Agent 请求头
 * @param ip 客户端 IP
 */
export function parseClientMeta(userAgent?: string, ip?: string): ClientMeta {
  const ua = userAgent ?? '';
  let browser = '未知浏览器';
  if (ua.includes('Edg/')) {
    browser = 'Microsoft Edge';
  } else if (ua.includes('Chrome/')) {
    browser = 'Chrome';
  } else if (ua.includes('Firefox/')) {
    browser = 'Firefox';
  } else if (ua.includes('Safari/')) {
    browser = 'Safari';
  }

  let os = '未知系统';
  if (ua.includes('Windows')) {
    os = 'Windows';
  } else if (ua.includes('Mac OS')) {
    os = 'macOS';
  } else if (ua.includes('Android')) {
    os = 'Android';
  } else if (ua.includes('iPhone') || ua.includes('iPad')) {
    os = 'iOS';
  } else if (ua.includes('Linux')) {
    os = 'Linux';
  }

  return {
    deviceType: 'web',
    deviceName: `${browser} · ${os}`,
    browser,
    os,
    ipAddress: ip,
  };
}
