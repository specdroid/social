const path = require('path')

module.exports = {
  apps: [{
    name: 'social-automation',
    cwd: path.resolve(__dirname, 'server'),
    script: 'dist/index.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '4G',
    watch: false,
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
    },
    error_file: path.resolve(__dirname, 'logs', 'err.log'),
    out_file: path.resolve(__dirname, 'logs', 'out.log'),
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    max_restarts: 10,
    restart_delay: 5000,
    min_uptime: 10000,
  }],
}
