export * from './types';
export * from './web';
export * from './mobile';

export const isIOS = ((): boolean => {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
})();

export const isAndroid = ((): boolean => {
  if (typeof navigator === 'undefined') return false;
  return /Android/.test(navigator.userAgent);
})();
