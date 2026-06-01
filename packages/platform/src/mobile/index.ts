export const isNative = typeof navigator !== 'undefined' && navigator.product === 'ReactNative';

export const isNativeIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);

export const isNativeAndroid = typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent);

export const getOS = (): string => {
  if (isNativeIOS) return 'ios';
  if (isNativeAndroid) return 'android';
  return 'unknown';
};
