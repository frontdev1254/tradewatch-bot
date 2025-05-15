module.exports = {
  apps: [
    {
      // Name of the PM2 app (for logs, monitoring, etc.)
      name: 'tradewatch',

      // Entry point of the application
      script: 'index.js',

      // Working directory inside the Docker container
      cwd: '/usr/src/app',

      // Disable file watching (recommended in production)
      watch: false,

      // Merge default environment variables for production
      env: {
        NODE_ENV: 'production'
      },

      // Optional: log file configuration (PM2 handles this by default)
      // output: './logs/out.log',
      // error: './logs/error.log',
      // log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }
  ]
};
