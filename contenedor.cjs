#!/usr/bin/env node

const { createContainer } = require('@soymaycol/maycontainers');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
  const username = process.argv[2] || 'default';

  // Creamos el contenedor (solo inicializa config)
  const container = createContainer({
    name: username,
    distro: 'alpine',
    enableRoot: true,
    shell: '/bin/sh',
  });

  // Preparamos el contenedor (descarga + setup)
  await container.init();

  // Obtenemos path correcto de proot y rootfs
  const proot = container.prootPath;
  const rootfs = container.rootfsPath;

  // Ejecutamos directamente sin -E para evitar crash
  const args = [
    '-r', rootfs,
    '-w', '/root',
    '-b', '/proc',
    '-b', '/sys',
    '-b', '/dev',
    '--kill-on-exit',
    '/bin/sh'
  ];

  const proc = spawn(proot, args, {
    stdio: 'inherit'
  });

  proc.on('exit', (code) => {
    process.exit(code);
  });

})();
