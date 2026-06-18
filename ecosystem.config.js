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
        PORT: 9492,

        // Session signing key — REQUIRED in production. Generate with:
        //   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
        // SESSION_SECRET: 'paste-32-byte-hex-here',
        // SESSION_COOKIE_SECURE: '1',   // only when behind HTTPS
        // SESSION_TRUST_PROXY: '1',     // only when behind nginx / reverse proxy

        // OIDC (Authentik). Auth is disabled if any of these are missing.
        // OIDC_ISSUER_URL: 'http://192.168.1.38/application/o/wiz-home-controller/',
        // OIDC_CLIENT_ID: 'hPfG0tOXV8mEfTG29eetd05wK81u99EftIRfkQ8Y',
        // OIDC_CLIENT_SECRET: 'paste-secret-from-authentik',
        // OIDC_REDIRECT_URI: 'http://192.168.1.149:9492/api/auth/callback',
        // OIDC_POST_LOGOUT_REDIRECT_URI: 'http://192.168.1.149:9492/',
      },
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      time: true
    }
  ]
};
