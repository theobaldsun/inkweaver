const { getDefaultConfig } = require('@expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

const packages = [
  'shared',
  'api',
  'sync-engine',
  'adapters',
  'services',
  'ui',
  'platform',
  'editor-core',
  'editor-mobile',
];

const extraNodeModules = {};
packages.forEach(pkg => {
  extraNodeModules[`@inkweaver/${pkg}`] = path.resolve(__dirname, `../../packages/${pkg}`);
});

config.resolver.extraNodeModules = extraNodeModules;

config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(__dirname, '../../node_modules'),
];

config.watchFolders = [
  ...config.watchFolders,
  path.resolve(__dirname, '../../packages'),
];

config.resolver.sourceExts = [...config.resolver.sourceExts, 'cjs', 'mjs', 'ts', 'tsx'];

config.resolver.enableSymlinks = true;

config.resolver.unstable_enablePackageExports = true;

config.resolver.unstable_conditionNames = [
  'browser',
  'react-native',
  'import',
];

const originalResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'lib0/webcrypto') {
    return {
      type: 'sourceFile',
      filePath: path.resolve(
        __dirname,
        '../../node_modules/.pnpm/lib0@0.2.117/node_modules/lib0/webcrypto.js'
      ),
    };
  }
  
  if (platform === 'web' && moduleName.includes('isomorphic-webcrypto')) {
    return {
      type: 'empty',
    };
  }
  
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
