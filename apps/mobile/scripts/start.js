const { execSync } = require('child_process');
const os = require('os');

function isPortInUse(port) {
  try {
    if (os.platform() === 'win32') {
      const output = execSync(`netstat -ano | findstr :${port}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      return output.includes('LISTENING');
    } else {
      const output = execSync(`lsof -i :${port}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      return output.length > 0;
    }
  } catch (err) {
    return false;
  }
}

const defaultPort = 8081;
let port = defaultPort;

if (isPortInUse(port)) {
  console.log(`Port ${port} is in use, trying alternative ports...`);
  for (let i = 1; i <= 10; i++) {
    const altPort = defaultPort + i;
    if (!isPortInUse(altPort)) {
      port = altPort;
      console.log(`Using port ${port}`);
      break;
    }
  }
}

process.env.CI = '1';
const cmd = `npx expo start --port ${port} --lan`;
console.log(`Starting Expo with command: ${cmd}`);

const { spawn } = require('child_process');
const child = spawn(cmd, { shell: true, stdio: 'inherit', env: { ...process.env } });

child.on('exit', (code) => {
  process.exit(code);
});