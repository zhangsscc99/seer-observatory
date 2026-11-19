module.exports = {
  apps: [{
    name: 'seer-observatory',
    script: 'server/index.js',
    cwd: '/root/work/seer-observatory',
    node_args: [],
    instances: 1,
    autorestart: true,
    max_restarts: 100,
    min_uptime: '10s',
    restart_delay: 2000,
    max_memory_restart: '1G',
    env: { NODE_ENV: 'production', PORT: '3029' },
    out_file: '/root/work/seer-observatory/data/out.log',
    error_file: '/root/work/seer-observatory/data/err.log',
    merge_logs: true,
    time: true
  }]
};
