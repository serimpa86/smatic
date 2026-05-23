module.exports = {
  apps: [{
    name: 'smatic',
    script: 'server/index.js',
    cwd: '/home/smatic',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    max_memory_restart: '500M',
    error_file: '/home/smatic/.pm2/logs/smatic-error.log',
    out_file: '/home/smatic/.pm2/logs/smatic-out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  }]
};
