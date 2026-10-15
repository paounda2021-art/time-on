const { spawn } = require('child_process');
const path = require('path');

const cfBin = path.join(__dirname, 'cloudflared.exe');
const configFile = path.join(__dirname, '_cloudflare_tunnel', 'config.yml');

console.log('Starting Cloudflare Tunnel via HTTP/2 with config:', configFile);
const args = [
  'tunnel',
  '--config', configFile,
  '--protocol', 'http2',
  'run'
];

const tunnel = spawn(cfBin, args, {
  stdio: 'inherit'
});

tunnel.on('close', code => {
  console.log('Tunnel exited with code', code);
  process.exit(code || 0);
});
tunnel.on('error', err => {
  console.error('Tunnel error:', err);
});

process.on('SIGINT', () => tunnel.kill('SIGINT'));
process.on('SIGTERM', () => tunnel.kill('SIGTERM'));
