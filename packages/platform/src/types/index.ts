export type Platform = 'web' | 'mobile' | 'desktop';

export interface PlatformInfo {
  platform: Platform;
  os: string;
  browser?: string;
  version?: string;
}

export interface PlatformCapabilities {
  offline: boolean;
  pushNotifications: boolean;
  backgroundSync: boolean;
  fileSystem: boolean;
  camera: boolean;
  microphone: boolean;
}
