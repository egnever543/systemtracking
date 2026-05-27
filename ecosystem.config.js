module.exports = {
  apps: [
    {
      name: 'wacapi',
      script: 'src/index.js',
      interpreter: 'node',
      interpreter_args: '--experimental-vm-modules',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        PUBLIC_BASE_URL: 'http://track.convertedigitais.com.br',
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
