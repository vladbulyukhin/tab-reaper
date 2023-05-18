module.exports = function (config) {
  config.set({
    frameworks: ['jasmine', 'karma-typescript'],
    plugins: [
      require('karma-jasmine'),
      require('karma-typescript'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
    ],
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    exclude: ['./src/background.ts', './src/options.ts', './src/api/*.ts'],
    preprocessors: {
      'src/**/*.ts': ['karma-typescript'],
      'tests/**/*.ts': ['karma-typescript'],
    },
    reporters: ['kjhtml', 'progress', 'karma-typescript'],
    port: 9876,
    colors: true,
    logLevel: config.LOG_INFO,
    autoWatch: true,
    browsers: ['Chrome'],
    singleRun: false,
    concurrency: Infinity,
    karmaTypescriptConfig: {
      compilerOptions: {
        target: 'es2015',
      },
    },
  });
};
