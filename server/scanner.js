import net from 'net';
import ipaddr from 'ipaddr.js';

// Top common web and network service ports
export const COMMON_PORTS = [
  80, 443, 8080, 8443, 3000, 3001, 5000, 5173, 8000, 8008, 8888, 9000, 9090, 9443,
  21, 22, 23, 25, 53, 110, 143, 445, 993, 995, 1433, 1521, 2049, 3306, 3389,
  5432, 5900, 6379, 7000, 7001, 7474, 8081, 8082, 8088, 8123, 8181, 8200, 8300,
  8500, 9001, 9200, 9300, 9999, 10000, 27017, 28017, 50000, 50070
];

/**
 * Parse input string into a list of valid IP addresses / hosts
 */
export function parseTargets(targetInput) {
  if (!targetInput) return [];
  const entries = targetInput
    .split(/[\n,;]+/)
    .map(s => s.trim())
    .filter(Boolean);

  const ipList = new Set();

  for (const entry of entries) {
    // Check if CIDR (e.g., 192.168.1.0/24)
    if (entry.includes('/')) {
      try {
        const parsedCidr = ipaddr.parseCIDR(entry);
        const [networkAddr, prefixLen] = parsedCidr;
        
        if (networkAddr.kind() === 'ipv4' && prefixLen >= 16 && prefixLen <= 32) {
          const numHosts = Math.pow(2, 32 - prefixLen);
          if (numHosts <= 256) {
            const range = ipaddr.IPv4.networkAddressFromCIDR(entry);
            const startInt = ipToLong(range.toString());
            for (let i = 0; i < numHosts; i++) {
              ipList.add(longToIp(startInt + i));
            }
            continue;
          }
        }
      } catch (err) {
        console.warn(`Could not parse CIDR ${entry}:`, err.message);
      }
    }

    // Check if Range (e.g., 192.168.1.1-192.168.1.10)
    if (entry.includes('-') && !entry.startsWith('-')) {
      const parts = entry.split('-').map(p => p.trim());
      if (parts.length === 2) {
        try {
          const startIp = parts[0];
          let endIp = parts[1];
          // If end is just the last octet (e.g., 192.168.1.1-10)
          if (!endIp.includes('.') && startIp.includes('.')) {
            const octets = startIp.split('.');
            octets[3] = endIp;
            endIp = octets.join('.');
          }
          const startInt = ipToLong(startIp);
          const endInt = ipToLong(endIp);
          if (startInt && endInt && endInt >= startInt && endInt - startInt <= 256) {
            for (let i = startInt; i <= endInt; i++) {
              ipList.add(longToIp(i));
            }
            continue;
          }
        } catch (err) {
          console.warn(`Could not parse IP range ${entry}:`, err.message);
        }
      }
    }

    // Default single IP or hostname (e.g. 127.0.0.1, localhost, 192.168.1.1)
    ipList.add(entry);
  }

  return Array.from(ipList);
}

function ipToLong(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return 0;
  return ((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + (parts[3] >>> 0);
}

function longToIp(long) {
  return [
    (long >>> 24) & 255,
    (long >>> 16) & 255,
    (long >>> 8) & 255,
    long & 255
  ].join('.');
}

/**
 * Parse port selection (all 1-65535, top common, or custom ranges)
 */
export function parsePorts(portOption, customPorts) {
  if (portOption === 'all') {
    const ports = new Array(65535);
    for (let i = 1; i <= 65535; i++) {
      ports[i - 1] = i;
    }
    return ports;
  }

  if (portOption === 'common') {
    return [...COMMON_PORTS];
  }

  if (portOption === 'custom' && customPorts) {
    const portSet = new Set();
    const parts = customPorts.split(/[\n,;]+/).map(p => p.trim());
    for (const part of parts) {
      if (part.includes('-')) {
        const [start, end] = part.split('-').map(Number);
        if (start && end && start <= end) {
          for (let p = Math.max(1, start); p <= Math.min(65535, end); p++) {
            portSet.add(p);
          }
        }
      } else {
        const p = Number(part);
        if (p >= 1 && p <= 65535) {
          portSet.add(p);
        }
      }
    }
    return Array.from(portSet).sort((a, b) => a - b);
  }

  // Default to common + extended standard web ports
  return [...COMMON_PORTS];
}

/**
 * Fast single port TCP probe
 */
function probePort(host, port, timeoutMs = 350) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let isResolved = false;

    const cleanup = () => {
      if (!isResolved) {
        isResolved = true;
        socket.destroy();
      }
    };

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      cleanup();
      resolve(true);
    });

    socket.on('timeout', () => {
      cleanup();
      resolve(false);
    });

    socket.on('error', () => {
      cleanup();
      resolve(false);
    });

    socket.on('close', () => {
      if (!isResolved) {
        isResolved = true;
        resolve(false);
      }
    });

    try {
      socket.connect(port, host);
    } catch {
      cleanup();
      resolve(false);
    }
  });
}

/**
 * High-speed parallel Port Scanner for target hosts and port lists
 */
export async function runScan({
  hosts,
  ports,
  concurrency = 750,
  timeout = 350,
  onProgress,
  onOpenPort,
  isCancelled
}) {
  const totalTasks = hosts.length * ports.length;
  let completed = 0;
  const startTime = Date.now();
  const openResults = [];

  // Build task queue
  const tasks = [];
  for (const host of hosts) {
    for (const port of ports) {
      tasks.push({ host, port });
    }
  }

  let taskIndex = 0;
  let lastProgressEmit = Date.now();

  const worker = async () => {
    while (taskIndex < tasks.length) {
      if (isCancelled && isCancelled()) {
        break;
      }

      const currentIdx = taskIndex++;
      if (currentIdx >= tasks.length) break;

      const { host, port } = tasks[currentIdx];
      const isOpen = await probePort(host, port, timeout);

      completed++;

      if (isOpen) {
        const item = { host, port, timestamp: Date.now() };
        openResults.push(item);
        if (onOpenPort) {
          onOpenPort(item);
        }
      }

      // Emit progress periodically
      const now = Date.now();
      if (now - lastProgressEmit > 100 || completed === totalTasks) {
        lastProgressEmit = now;
        const elapsedSec = (now - startTime) / 1000 || 0.001;
        const portsPerSec = Math.round(completed / elapsedSec);
        const percent = Math.min(100, Math.round((completed / totalTasks) * 100));

        if (onProgress) {
          onProgress({
            completed,
            total: totalTasks,
            percent,
            portsPerSec,
            openCount: openResults.length,
            currentHost: host,
            currentPort: port,
            elapsedSec: Math.round(elapsedSec)
          });
        }
      }
    }
  };

  // Launch worker pool
  const workerCount = Math.min(concurrency, tasks.length);
  const workers = Array.from({ length: workerCount }, () => worker());

  await Promise.all(workers);

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  return {
    totalScanned: completed,
    totalPorts: totalTasks,
    openPorts: openResults,
    durationSec
  };
}
