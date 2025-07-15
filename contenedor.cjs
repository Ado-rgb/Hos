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

// Función para instalar openssh-server en el contenedor
async function setupSSH(container) {
  console.log('[MayHost] Setting up SSH/SFTP server...');
  
  const proot = container.prootPath;
  const rootfs = container.rootfsPath;
  
  // Comandos para instalar y configurar SSH
  const commands = [
    'apk update',
    'apk add openssh-server',
    'ssh-keygen -A',
    'echo "root:mayhost123" | chpasswd',
    'sed -i "s/#PermitRootLogin.*/PermitRootLogin yes/" /etc/ssh/sshd_config',
    'sed -i "s/#PasswordAuthentication.*/PasswordAuthentication yes/" /etc/ssh/sshd_config',
    'sed -i "s/#Port 22/Port 2222/" /etc/ssh/sshd_config',
    'mkdir -p /var/run/sshd',
    'mkdir -p /root/web',
    'echo "Welcome to MayHost SFTP Server" > /root/web/index.html'
  ];

  for (const cmd of commands) {
    const args = [
      '-r', rootfs,
      '-w', '/root',
      '-b', '/proc',
      '-b', '/sys',
      '-b', '/dev',
      '/bin/sh', '-c', cmd
    ];
    
    try {
      await new Promise((resolve, reject) => {
        const proc = spawn(proot, args, { stdio: 'pipe' });
        proc.on('exit', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Command failed: ${cmd}`));
        });
      });
    } catch (error) {
      console.warn(`[MayHost] Warning: ${error.message}`);
    }
  }
}

// Función para iniciar el servidor SSH
function startSSHServer(container) {
  console.log('[MayHost] Starting SSH/SFTP server on port 2222...');
  
  const proot = container.prootPath;
  const rootfs = container.rootfsPath;
  
  const args = [
    '-r', rootfs,
    '-w', '/root',
    '-b', '/proc',
    '-b', '/sys',
    '-b', '/dev',
    '/usr/sbin/sshd', '-D', '-p', '2222'
  ];

  const sshProc = spawn(proot, args, {
    stdio: 'pipe',
    detached: true
  });

  sshProc.unref();
  
  return sshProc;
}

// Función para configurar ngrok
async function setupNgrok() {
  console.log('[MayHost] Setting up ngrok tunnel...');
  
  try {
    // Verificar si ngrok está instalado
    await exec('which ngrok');
  } catch (error) {
    console.log('[MayHost] ngrok not found. Please install it first:');
    console.log('[MayHost] curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null');
    console.log('[MayHost] echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list');
    console.log('[MayHost] sudo apt update && sudo apt install ngrok');
    console.log('[MayHost] Then run: ngrok config add-authtoken YOUR_TOKEN');
    return null;
  }

  // Iniciar túnel ngrok para SSH
  const ngrokProc = spawn('ngrok', ['tcp', '2222'], {
    stdio: 'pipe',
    detached: true
  });

  ngrokProc.unref();

  // Esperar un poco para que ngrok se inicie
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Obtener la URL pública
  try {
    const { stdout } = await exec('curl -s http://localhost:4040/api/tunnels');
    const tunnels = JSON.parse(stdout);
    if (tunnels.tunnels && tunnels.tunnels.length > 0) {
      const publicUrl = tunnels.tunnels[0].public_url;
      return publicUrl;
    }
  } catch (error) {
    console.warn('[MayHost] Could not retrieve ngrok URL');
  }

  return null;
}

// Función para mostrar información de conexión
function showConnectionInfo(publicUrl, username) {
  console.log('\n' + '='.repeat(50));
  console.log('🚀 MayHost Server Ready!');
  console.log('='.repeat(50));
  console.log(`👤 Username: ${username}`);
  console.log(`📁 Web Directory: /root/web`);
  console.log(`🔐 SSH Password: mayhost123`);
  console.log('='.repeat(50));
  
  console.log('\n📡 Connection Methods:');
  console.log('Local SFTP: sftp -P 2222 root@localhost');
  console.log('Local SSH: ssh -p 2222 root@localhost');
  
  if (publicUrl) {
    const [protocol, , host] = publicUrl.split(/[:\/]/);
    const port = host.split(':')[1] || '22';
    console.log(`\n🌐 Public Access:`);
    console.log(`Public SFTP: sftp -P ${port} root@${host.split(':')[0]}`);
    console.log(`Public SSH: ssh -p ${port} root@${host.split(':')[0]}`);
    console.log(`\n📍 Public URL: ${publicUrl}`);
  }
  
  console.log('\n💡 Tips:');
  console.log('• Upload files to /root/web/ directory');
  console.log('• Use any SFTP client (FileZilla, WinSCP, etc.)');
  console.log('• Files in /root/web/ can be served via HTTP');
  console.log('='.repeat(50));
}

(async () => {
  const username = process.argv[2] || 'default';
  const useNgrok = process.argv.includes('--ngrok') || process.argv.includes('-n');

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

  // Configurar SSH/SFTP
  await setupSSH(container);

  // Iniciar servidor SSH
  const sshProc = startSSHServer(container);

  // Configurar ngrok si se solicita
  let publicUrl = null;
  if (useNgrok) {
    publicUrl = await setupNgrok();
  }

  // Mostrar información de conexión
  showConnectionInfo(publicUrl, username);

  console.log(`\n[MayHost] You can now use your server`);
  console.log(`[MayHost] Press Ctrl+C to stop all services`);

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

  // Limpiar procesos al salir
  process.on('SIGINT', () => {
    console.log('\n[MayHost] Shutting down services...');
    if (sshProc) sshProc.kill();
    proc.kill();
    process.exit(0);
  });

  proc.on('exit', code => {
    if (sshProc) sshProc.kill();
    process.exit(code);
  });

})();
