const { createContainer } = require('@soymaycol/maycontainers');

(async () => {
  const username = process.argv[2] || "defaultUser";

  const container = createContainer({
    name: username,
    distro: 'alpine'
  });

  await container.shell();
})();
