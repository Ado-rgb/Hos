#!/usr/bin/env node

const { createContainer } = require('@soymaycol/maycontainers');

(async () => {
  const username = process.argv[2] || 'default';

  const container = createContainer({
    name: username,
    distro: 'alpine',
    shell: '/bin/sh', // o /bin/bash si prefieres
    enableRoot: true // opcional
  });

  // Inicializa el contenedor (esto descarga y prepara todo)
  await container.init();

  // Ejecuta shell directamente con control de stdin/out
  await container.exec('/bin/sh', {
    stdio: 'inherit'
  });
})();
