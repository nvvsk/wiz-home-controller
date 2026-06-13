module.exports = {
  apps: [
    {
      name: 'wiz-controller',
      script: './index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'INFO',
        PORT: 3000,
        // WIZ_PASSWORD: 'set-me-to-enable-login'   // uncomment + set to require login
      },
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      time: true
    }
  ]
};
