module.exports = {
  apps: [
    {
      name: 'tradewatch',
      script: './src/index.js',
      watch: false,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
