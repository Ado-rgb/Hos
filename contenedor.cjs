#!/usr/bin/env node

const { createContainer } = require('@soymaycol/maycontainers');
const { spawn } = require('child_process');
const path = require('path');

// Función para mutear console.log temporalmente
function muteConsoleLogs(fn) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};

  return fn().finally(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  });
}

(async () => {
  const username = process.argv[2] || 'default';

  // Mensaje personalizado de instalación
  console.log(`[MayHost] Installing server...`);

  const container = createContainer({
    name: username,
    distro: 'alpine',
    enableRoot: true,
    shell: '/bin/sh',
  });

  // Ejecutamos el init con logs silenciados
  await muteConsoleLogs(() => container.init());

  // Mensaje final de confirmación
  console.log(`[MayHost] Server Installed!`);

  const proot = container.prootPath;
  const rootfs = container.rootfsPath;

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

  proc.on('exit', code => {
    process.exit(code);
  });

})();
