#!/usr/bin/env node

const { createContainer } = require('@soymaycol/maycontainers');

(async () => {
  const username = process.argv[2] || 'default';

  const container = createContainer({
    name: username,
    distro: 'alpine',
    enableRoot: true,
    shell: '/bin/sh',
  });

  // Prepara el contenedor
  await container.init();

  // Ejecuta el shell manualmente sin usar shell()
  await container.exec('/bin/sh', {
    stdio: 'inherit'
  });
})();
