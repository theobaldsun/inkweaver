export const isWeb = typeof window !== 'undefined' && typeof document !== 'undefined';

export const isMobile = typeof navigator !== 'undefined' && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

export const isDesktop = !isWeb && !isMobile;

export const getPlatform = (): 'web' | 'mobile' | 'desktop' => {
  if (isMobile) return 'mobile';
  if (isWeb) return 'web';
  return 'desktop';
};

export const isWebIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);

export const isWebAndroid = typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent);
