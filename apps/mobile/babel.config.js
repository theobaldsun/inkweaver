module.exports = function(api) {
  api.cache(true);
  
  return {
    presets: ['babel-preset-expo'],
    
    plugins: [
      // 支持装饰器
      ['@babel/plugin-proposal-decorators', { legacy: true }],
      
      // 模块解析别名
      [
        'module-resolver',
        {
          root: ['./src'],
          extensions: [
            '.ios.js',
            '.android.js',
            '.js',
            '.jsx',
            '.ts',
            '.tsx',
            '.json',
          ],
          alias: {
            // 本地路径别名
            '@': './src',
            
            // workspace 包别名
            '@inkweaver/editor-mobile': '../../packages/editor-mobile',
            '@inkweaver/shared': '../../packages/shared',
            '@inkweaver/ui': '../../packages/ui',
            '@inkweaver/sync-engine': '../../packages/sync-engine',
            '@inkweaver/api': '../../packages/api',
            '@inkweaver/services': '../../packages/services',
            '@inkweaver/adapters': '../../packages/adapters',
          },
        },
      ],
    ],
    
    // 环境特定配置
  env: {
    production: {
      plugins: [
        // 生产环境优化
        // 'transform-remove-console',
      ],
    },
  },
  };
};