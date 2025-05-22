module.exports = {
  apps: [
    {
      name: 'tradewatch',
      script: './src/index.js',
      watch: false,
      max_memory_restart: '200M',
      restart_delay: 5000,
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};