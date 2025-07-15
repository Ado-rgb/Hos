#!/usr/bin/env node

const { createContainer } = require('@soymaycol/maycontainers');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

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

// Función para instalar ngrok si no está instalado
async function installNgrok() {
  try {
    await exec('which ngrok');
    console.log('[MayHost] ngrok already installed');
  } catch (error) {
    console.log('[MayHost] Installing ngrok...');
    try {
      // Instalar ngrok usando npm
      await exec('npm install -g ngrok');
      console.log('[MayHost] ngrok installed successfully');
    } catch (installError) {
      console.log('[MayHost] Error installing ngrok:', installError.message);
      console.log('[MayHost] Please install ngrok manually: https://ngrok.com/download');
      process.exit(1);
    }
  }
}

// Función para configurar SFTP en el contenedor
async function setupSFTP(container) {
  const rootfs = container.rootfsPath;
  const proot = container.prootPath;
  
  console.log('[MayHost] Setting up SFTP server...');
  
  // Crear directorio para SFTP si no existe
  const sftpDir = path.join(rootfs, 'etc', 'ssh');
  if (!fs.existsSync(sftpDir)) {
    fs.mkdirSync(sftpDir, { recursive: true });
  }
  
  // Configuración de SSH/SFTP
  const sshdConfig = `
Port 2222
PermitRootLogin yes
PasswordAuthentication yes
PubkeyAuthentication yes
Subsystem sftp /usr/lib/openssh/sftp-server
AllowUsers root
`;
  
  fs.writeFileSync(path.join(sftpDir, 'sshd_config'), sshdConfig);
  
  // Instalar openssh en el contenedor
  const installCmd = [
    '-r', rootfs,
    '-w', '/root',
    '-b', '/proc',
    '-b', '/sys',
    '-b', '/dev',
    '/bin/sh', '-c',
    'apk update && apk add openssh openssh-sftp-server && ssh-keygen -A'
  ];
  
  return new Promise((resolve, reject) => {
    const installProc = spawn(proot, installCmd, {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    installProc.on('exit', (code) => {
      if (code === 0) {
        console.log('[MayHost] SFTP server configured successfully');
        resolve();
      } else {
        reject(new Error(`SFTP setup failed with code ${code}`));
      }
    });
  });
}

// Función para iniciar el servidor SFTP
function startSFTPServer(container) {
  const rootfs = container.rootfsPath;
  const proot = container.prootPath;
  
  const sftpArgs = [
    '-r', rootfs,
    '-w', '/root',
    '-b', '/proc',
    '-b', '/sys',
    '-b', '/dev',
    '-b', '/tmp',
    '/usr/sbin/sshd', '-D', '-p', '2222', '-f', '/etc/ssh/sshd_config'
  ];
  
  const sftpProc = spawn(proot, sftpArgs, {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  console.log('[MayHost] SFTP server started on port 2222');
  return sftpProc;
}

// Función para iniciar ngrok
async function startNgrok() {
  console.log('[MayHost] Starting ngrok tunnel...');
  
  return new Promise((resolve, reject) => {
    const ngrokProc = spawn('ngrok', ['tcp', '2222'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let output = '';
    
    ngrokProc.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    ngrokProc.stderr.on('data', (data) => {
      output += data.toString();
    });
    
    // Esperar un poco para que ngrok se inicie
    setTimeout(async () => {
      try {
        // Obtener la URL del túnel desde la API de ngrok
        const response = await exec('curl -s http://127.0.0.1:4040/api/tunnels');
        const tunnels = JSON.parse(response.stdout);
        
        if (tunnels.tunnels && tunnels.tunnels.length > 0) {
          const publicUrl = tunnels.tunnels[0].public_url;
          console.log('[MayHost] ✅ SFTP server accessible at:', publicUrl);
          console.log('[MayHost] Use this URL to connect with your SFTP client');
          console.log('[MayHost] Username: root');
          console.log('[MayHost] Password: (set one using passwd command)');
          resolve(ngrokProc);
        } else {
          reject(new Error('No tunnels found'));
        }
      } catch (error) {
        reject(error);
      }
    }, 3000);
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
  console.log(`[MayHost] Server Installed`);
  
  try {
    // Instalar ngrok
    await installNgrok();
    
    // Configurar SFTP
    await setupSFTP(container);
    
    // Iniciar servidor SFTP
    const sftpProc = startSFTPServer(container);
    
    // Esperar un poco para que el servidor SFTP se inicie
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Iniciar ngrok
    const ngrokProc = await startNgrok();
    
    console.log(`[MayHost] You can now use your server`);
    console.log(`[MayHost] SFTP server is running and accessible publicly`);
    
    // Manejar el proceso principal del contenedor
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
      // Limpiar procesos al salir
      if (sftpProc) sftpProc.kill();
      if (ngrokProc) ngrokProc.kill();
      process.exit(code);
    });
    
    // Manejar señales de terminación
    process.on('SIGINT', () => {
      console.log('[MayHost] Shutting down...');
      if (sftpProc) sftpProc.kill();
      if (ngrokProc) ngrokProc.kill();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('[MayHost] Error:', error.message);
    process.exit(1);
  }

})();
