#!/usr/bin/env node

const { createContainer } = require('@soymaycol/maycontainers');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
  const username = process.argv[2] || 'default';

  const container = createContainer({
    name: username,
    distro: 'alpine',
    enableRoot: true,
    shell: '/bin/sh',
  });

  await container.init(); // prepara el rootfs

  const prootBin = require.resolve('@soymaycol/maycontainers/../bin/proot');
  const rootfsPath = container.rootfsPath;

  // Ejecutamos PRoot directamente, sin usar exec()
  const pty = spawn(prootBin, [
    '-r', rootfsPath,
    '-w', '/root',
    '-b', '/proc',
    '-b', '/sys',
    '-b', '/dev',
    '/bin/sh' // ← comando dentro del contenedor
  ], {
    stdio: 'inherit'
  });

  pty.on('exit', code => {
    process.exit(code);
  });
})();
