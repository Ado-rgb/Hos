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

// Función para verificar si un comando existe
async function commandExists(command) {
  try {
    await exec(`which ${command}`);
    return true;
  } catch {
    return false;
  }
}

// Función para instalar ngrok si no existe
async function installNgrok() {
  console.log('[MayHost] Checking ngrok installation...');
  
  if (await commandExists('ngrok')) {
    console.log('[MayHost] ngrok already installed');
    return;
  }

  console.log('[MayHost] Installing ngrok...');
  try {
    // Descargar e instalar ngrok
    await exec('curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null');
    await exec('echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list');
    await exec('sudo apt update && sudo apt install ngrok -y');
    console.log('[MayHost] ngrok installed successfully');
  } catch (error) {
    console.error('[MayHost] Error installing ngrok:', error.message);
    console.log('[MayHost] Trying alternative installation method...');
    
    try {
      await exec('wget -q -O /tmp/ngrok.zip https://bin.equinox.io/c/4VmDzA7iaHb/ngrok-stable-linux-amd64.zip');
      await exec('sudo unzip -o /tmp/ngrok.zip -d /usr/local/bin');
      await exec('sudo chmod +x /usr/local/bin/ngrok');
      console.log('[MayHost] ngrok installed via direct download');
    } catch (altError) {
      console.error('[MayHost] Failed to install ngrok:', altError.message);
      console.log('[MayHost] Please install ngrok manually');
    }
  }
}

// Función para configurar SFTP en el contenedor
async function setupSFTP(container) {
  console.log('[MayHost] Setting up SFTP server...');
  
  const setupCommands = [
    // Instalar openssh-server
    'apk update && apk add openssh-server openssh-sftp-server',
    
    // Generar claves SSH
    'ssh-keygen -A',
    
    // Crear directorio SSH para root
    'mkdir -p /root/.ssh',
    
    // Configurar sshd_config para SFTP
    `echo 'Port 22
PermitRootLogin yes
PasswordAuthentication yes
PubkeyAuthentication yes
Subsystem sftp /usr/lib/openssh/sftp-server
AllowUsers root
ChrootDirectory none' > /etc/ssh/sshd_config`,
    
    // Establecer contraseña para root
    'echo "root:mayhost123" | chpasswd',
    
    // Crear directorio de trabajo
    'mkdir -p /root/workspace',
    
    // Iniciar servicio SSH
    '/usr/sbin/sshd -D &'
  ];

  for (const cmd of setupCommands) {
    try {
      const result = await container.exec(cmd);
      if (result.exitCode !== 0 && !cmd.includes('sshd -D')) {
        console.log(`[MayHost] Warning: Command failed: ${cmd}`);
      }
    } catch (error) {
      console.log(`[MayHost] Error executing: ${cmd}`);
    }
  }
}

// Función para iniciar ngrok
async function startNgrok(port = 22) {
  console.log('[MayHost] Starting ngrok tunnel...');
  
  return new Promise((resolve, reject) => {
    const ngrokProcess = spawn('ngrok', ['tcp', port.toString()], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let output = '';
    
    ngrokProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    ngrokProcess.stderr.on('data', (data) => {
      output += data.toString();
    });

    // Esperar un poco para que ngrok se inicie
    setTimeout(async () => {
      try {
        // Obtener la URL pública de ngrok
        const response = await exec('curl -s localhost:4040/api/tunnels');
        const tunnels = JSON.parse(response.stdout);
        
        if (tunnels.tunnels && tunnels.tunnels.length > 0) {
          const publicUrl = tunnels.tunnels[0].public_url;
          console.log(`[MayHost] SFTP accessible at: ${publicUrl}`);
          console.log(`[MayHost] Username: root`);
          console.log(`[MayHost] Password: mayhost123`);
          resolve({ process: ngrokProcess, url: publicUrl });
        } else {
          reject(new Error('No tunnels found'));
        }
      } catch (error) {
        reject(error);
      }
    }, 3000);

    ngrokProcess.on('error', (error) => {
      reject(error);
    });
  });
}

// Función principal
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

  // Configurar SFTP
  await setupSFTP(container);

  // Instalar ngrok
  await installNgrok();

  // Iniciar ngrok
  let ngrokInfo;
  try {
    ngrokInfo = await startNgrok(22);
  } catch (error) {
    console.error('[MayHost] Error starting ngrok:', error.message);
    console.log('[MayHost] Server will run locally only');
  }

  // Mensaje final de confirmación
  console.log(`[MayHost] Server Installed`);
  console.log(`[MayHost] You can now use your server`);
  
  if (ngrokInfo) {
    console.log(`[MayHost] SFTP Server accessible publicly at: ${ngrokInfo.url}`);
    console.log(`[MayHost] Connect with any SFTP client using:`);
    console.log(`[MayHost] - Host: ${ngrokInfo.url.replace('tcp://', '')}`);
    console.log(`[MayHost] - Username: root`);
    console.log(`[MayHost] - Password: mayhost123`);
    console.log(`[MayHost] - Working directory: /root/workspace`);
  }

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

  // Manejar cierre del proceso
  proc.on('exit', code => {
    if (ngrokInfo) {
      console.log('[MayHost] Stopping ngrok...');
      ngrokInfo.process.kill();
    }
    process.exit(code);
  });

  // Manejar señales de terminación
  process.on('SIGINT', () => {
    console.log('\n[MayHost] Shutting down...');
    if (ngrokInfo) {
      ngrokInfo.process.kill();
    }
    proc.kill();
  });

  process.on('SIGTERM', () => {
    console.log('\n[MayHost] Shutting down...');
    if (ngrokInfo) {
      ngrokInfo.process.kill();
    }
    proc.kill();
  });

})();
