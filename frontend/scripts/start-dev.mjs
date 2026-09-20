import { execFileSync, spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const PORT = 3000;
const projectRoot = process.cwd();
const DEV_DIST_DIR = '.next-dev';

function normalize(value) {
  return String(value || '').replaceAll('\\', '/').toLowerCase();
}

function canListen() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (error) => resolve(error.code !== 'EADDRINUSE'));
    server.listen(PORT, '::', () => server.close(() => resolve(true)));
  });
}

function windowsPortOwner() {
  // `Get-NetTCPConnection`/CIM có thể bị chặn trong môi trường sandbox của
  // Codex, còn netstat vẫn đọc được PID đang listen mà không cần quyền admin.
  const netstat = execFileSync('netstat.exe', ['-ano', '-p', 'tcp'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const line = netstat.split(/\r?\n/).find((value) => {
    return value.includes(`:${PORT}`) && /\sLISTENING\s+\d+\s*$/i.test(value);
  });
  const match = line?.match(/\sLISTENING\s+(\d+)\s*$/i);
  if (!match) return null;
  return { ProcessId: Number(match[1]), CommandLine: '' };
}

function unixPortOwner() {
  const pid = execFileSync('lsof', ['-ti', `tcp:${PORT}`, '-sTCP:LISTEN'], {
    encoding: 'utf8',
  }).trim().split(/\s+/)[0];
  if (!pid) return null;
  const commandLine = execFileSync('ps', ['-p', pid, '-o', 'command='], {
    encoding: 'utf8',
  }).trim();
  return { ProcessId: Number(pid), CommandLine: commandLine };
}

function getPortOwner() {
  try {
    return process.platform === 'win32' ? windowsPortOwner() : unixPortOwner();
  } catch {
    return null;
  }
}

function isThisProjectNext(owner) {
  if (!owner) return false;
  const command = normalize(owner.CommandLine);
  return command.includes(normalize(projectRoot)) && command.includes('next');
}

async function hasProjectMarker() {
  try {
    // `/icons/*` được middleware loại khỏi auth nên probe hoạt động cả khi
    // chưa đăng nhập và trong phiên Codex không đọc được command line tiến trình.
    const response = await fetch(`http://127.0.0.1:${PORT}/icons/iuoss-dev-owner.json`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return false;
    const marker = await response.json();
    return marker?.project === 'iuoss-hub-frontend';
  } catch {
    return false;
  }
}

function stopProcessTree(pid) {
  if (process.platform === 'win32') {
    execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    process.kill(-pid, 'SIGTERM');
  }
}

async function waitUntilFree(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canListen()) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

if (!(await canListen())) {
  const owner = getPortOwner();
  if (!isThisProjectNext(owner) && !(await hasProjectMarker())) {
    const ownerText = owner?.ProcessId ? ` (PID ${owner.ProcessId})` : '';
    console.error(
      `Cổng ${PORT} đang được ứng dụng khác sử dụng${ownerText}. ` +
      'Frontend IUOSS sẽ không tự ý tắt tiến trình này.',
    );
    process.exit(1);
  }

  console.log(`Đang dừng IUOSS Hub cũ trên cổng ${PORT} (PID ${owner.ProcessId})...`);
  try {
    stopProcessTree(owner.ProcessId);
  } catch {
    // Codex sandbox không được taskkill tiến trình do phiên Windows của người
    // dùng tạo. Server đó vẫn là đúng IUOSS Hub và Next dev đang theo dõi file,
    // nên tái sử dụng là hành vi an toàn và đủ để tiếp tục làm việc.
    console.log(
      `IUOSS Hub đã chạy tại http://localhost:${PORT}. ` +
      'Không cần khởi động thêm server.',
    );
    process.exit(0);
  }
  if (!(await waitUntilFree())) {
    console.error(`Không thể giải phóng cổng ${PORT}.`);
    process.exit(1);
  }
}

// Cache dev là dữ liệu tạm. Làm sạch khi khởi động để không giữ manifest cũ
// trỏ tới các JS/CSS chunk đã bị thay sau khi cập nhật mã nguồn.
try {
  rmSync(path.join(projectRoot, DEV_DIST_DIR), {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
} catch (error) {
  console.error(`Không thể làm sạch ${DEV_DIST_DIR}:`, error.message);
  process.exit(1);
}

const nextBin = path.join(projectRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
const child = spawn(process.execPath, [nextBin, 'dev', '--port', String(PORT)], {
  cwd: projectRoot,
  env: {
    ...process.env,
    NEXT_DIST_DIR: DEV_DIST_DIR,
  },
  stdio: 'inherit',
  windowsHide: false,
  detached: process.platform !== 'win32',
});

child.once('error', (error) => {
  console.error('Không thể khởi động Next.js:', error.message);
  process.exitCode = 1;
});

child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
