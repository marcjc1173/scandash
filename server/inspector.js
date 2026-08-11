import http from 'http';
import https from 'https';
import net from 'net';

const COMMON_SERVICE_NAMES = {
  21: 'FTP',
  22: 'SSH',
  23: 'Telnet',
  25: 'SMTP',
  53: 'DNS',
  80: 'HTTP Web Server',
  110: 'POP3',
  143: 'IMAP',
  443: 'HTTPS Secure Web Server',
  445: 'SMB / Windows File Sharing',
  993: 'IMAPS',
  995: 'POP3S',
  1433: 'MS SQL Server',
  1521: 'Oracle DB',
  2049: 'NFS',
  3000: 'Web Application (Dev/Node)',
  3001: 'Web Application (Dev/API)',
  3306: 'MySQL Database',
  3389: 'RDP Remote Desktop',
  5000: 'Web Service (Flask/Docker)',
  5173: 'Vite Dev Server',
  5432: 'PostgreSQL Database',
  5900: 'VNC Remote Desktop',
  6379: 'Redis Database',
  8000: 'Web Service (HTTP)',
  8080: 'HTTP Proxy / Web Admin',
  8443: 'HTTPS Admin / SSL Web',
  8888: 'Jupyter / Web App',
  9000: 'Portainer / PHP-FPM / MinIO',
  9090: 'Prometheus / Web Console',
  9200: 'Elasticsearch',
  27017: 'MongoDB Database'
};

/**
 * Fetch HTTP or HTTPS URL with timeout & redirect following
 */
function fetchUrl(url, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    try {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const client = isHttps ? https : http;

      const req = client.get(
        url,
        {
          timeout: timeoutMs,
          rejectUnauthorized: false, // Accept self-signed SSL certs on local devices
          headers: {
            'User-Agent': 'ScanDash/1.0 (Network Service Discovery)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          }
        },
        res => {
          let rawData = '';
          res.setEncoding('utf8');

          res.on('data', chunk => {
            if (rawData.length < 50000) {
              rawData += chunk;
            }
          });

          res.on('end', () => {
            resolve({
              statusCode: res.statusCode || 200,
              headers: res.headers,
              body: rawData,
              finalUrl: url
            });
          });
        }
      );

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('HTTP request timed out'));
      });

      req.on('error', err => {
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Extract <title> from HTML string
 */
function extractTitle(html) {
  if (!html) return null;
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (match && match[1]) {
    return match[1].trim().replace(/\s+/g, ' ');
  }
  return null;
}

/**
 * Grab raw socket banner if non-HTTP
 */
function grabSocketBanner(host, port, timeoutMs = 2000) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let banner = '';
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(banner.trim());
      }
    };

    socket.setTimeout(timeoutMs);

    socket.on('data', data => {
      banner += data.toString('utf8');
      if (banner.length > 50) {
        cleanup();
      }
    });

    socket.on('timeout', cleanup);
    socket.on('error', cleanup);
    socket.on('close', cleanup);

    try {
      socket.connect(port, host, () => {
        // Send a newline to trigger prompt for some protocols
        socket.write('\r\n');
      });
    } catch {
      cleanup();
    }
  });
}

/**
 * Inspect an open port to determine if it is HTTP/HTTPS and extract metadata
 */
export async function inspectService(host, port, httpTimeout = 4000) {
  const result = {
    ip: host,
    port,
    isWeb: false,
    protocol: 'tcp',
    url: null,
    title: COMMON_SERVICE_NAMES[port] || `Port ${port}`,
    statusCode: null,
    serverBanner: '',
    tags: []
  };

  // 1. Try HTTPS first if common SSL port (443, 8443, 9443) or general probe
  const tryProtocols = (port === 443 || port === 8443 || port === 9443) 
    ? ['https', 'http'] 
    : ['http', 'https'];

  for (const proto of tryProtocols) {
    let targetUrl = `${proto}://${host}:${port}`;
    
    // Special handling for known services like Plex Media Server (port 32400 web UI is at /web/index.html)
    if (port === 32400) {
      targetUrl = `${proto}://${host}:${port}/web/index.html`;
    }

    try {
      let response = await fetchUrl(targetUrl, httpTimeout);

      // If root returned 401 on port 32400 or has Plex header, redirect to /web/index.html
      if (response.statusCode === 401 && (port === 32400 || response.headers['x-plex-protocol'])) {
        try {
          const plexWebUrl = `${proto}://${host}:${port}/web/index.html`;
          const plexRes = await fetchUrl(plexWebUrl, httpTimeout);
          if (plexRes.statusCode < 400 || plexRes.statusCode === 302) {
            targetUrl = plexWebUrl;
            response = plexRes;
          }
        } catch {}
      }

      result.isWeb = true;
      result.protocol = proto;
      result.url = targetUrl;
      result.statusCode = response.statusCode;
      result.serverBanner = response.headers['server'] || '';

      const extracted = extractTitle(response.body);
      if (extracted && extracted !== 'Unauthorized') {
        result.title = extracted;
      } else if (port === 32400 || response.headers['x-plex-protocol']) {
        result.title = 'Plex Media Server';
      } else {
        result.title = `${proto.toUpperCase()} on ${port} (${response.statusCode})`;
      }

      result.tags.push('web');
      if (port === 32400 || response.headers['x-plex-protocol']) {
        result.tags.push('plex', 'media');
      }
      if (proto === 'https') result.tags.push('ssl');
      if (result.serverBanner) {
        const s = result.serverBanner.toLowerCase();
        if (s.includes('nginx')) result.tags.push('nginx');
        if (s.includes('apache')) result.tags.push('apache');
        if (s.includes('cloudflare')) result.tags.push('cloudflare');
        if (s.includes('express') || s.includes('node')) result.tags.push('node');
      }

      return result;
    } catch {
      // Not responding to this HTTP protocol, continue
    }
  }

  // 2. Not standard HTTP/HTTPS - try banner grab
  try {
    const banner = await grabSocketBanner(host, port, 1500);
    if (banner) {
      result.serverBanner = banner.substring(0, 100);
      if (banner.toLowerCase().includes('ssh')) {
        result.protocol = 'ssh';
        result.title = `SSH Service (${banner.split(' ')[0] || 'SSH'})`;
        result.tags.push('ssh', 'remote');
      } else if (banner.toLowerCase().includes('ftp')) {
        result.protocol = 'ftp';
        result.title = `FTP Service (${banner.substring(0, 30)})`;
        result.tags.push('ftp', 'file-transfer');
      } else if (banner.toLowerCase().includes('smtp') || banner.includes('220')) {
        result.protocol = 'smtp';
        result.title = 'SMTP Mail Server';
        result.tags.push('mail');
      } else if (banner.toLowerCase().includes('mysql') || banner.toLowerCase().includes('mariadb')) {
        result.protocol = 'mysql';
        result.title = 'MySQL Database';
        result.tags.push('database');
      }
    }
  } catch {}

  // 3. Fallback standard tags based on port
  if (result.tags.length === 0) {
    if (port === 22) result.tags.push('ssh', 'remote');
    else if (port === 3306 || port === 5432 || port === 27017 || port === 6379) result.tags.push('database');
    else if (port === 3389 || port === 5900) result.tags.push('remote-desktop');
    else result.tags.push('tcp');
  }

  return result;
}
