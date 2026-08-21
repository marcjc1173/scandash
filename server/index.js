import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

import {
  initStorage,
  getThumbnailsDir,
  getBackgroundsDir,
  getServices,
  getServiceById,
  upsertService,
  updateService,
  toggleFavorite,
  importServices,
  deleteService,
  clearAllServices,
  addScanHistory,
  getScanHistory
} from './storage.js';

import { parseTargets, parsePorts, runScan, COMMON_PORTS } from './scanner.js';
import { inspectService } from './inspector.js';
import { queueThumbnail, clearThumbnailQueue, captureThumbnail, closeBrowser } from './screenshot.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const DEFAULT_CONCURRENCY = parseInt(process.env.SCAN_CONCURRENCY || '750', 10);
const DEFAULT_SOCKET_TIMEOUT = parseInt(process.env.SOCKET_TIMEOUT || '350', 10);
const DEFAULT_HTTP_TIMEOUT = parseInt(process.env.HTTP_TIMEOUT || '4000', 10);

// Initialize storage folders
initStorage();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../public')));

// Serve thumbnails
app.use('/api/thumbnails', express.static(getThumbnailsDir()));

// Serve custom backgrounds
app.use('/api/backgrounds', express.static(getBackgroundsDir()));

// Active SSE Connections
let sseClients = [];

function broadcastSSE(type, data) {
  const message = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => {
    try {
      res.write(message);
    } catch {}
  });
}

// SSE Progress Endpoint
app.get('/api/scan/progress', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send initial ping
  res.write(`event: connected\ndata: ${JSON.stringify({ status: 'connected' })}\n\n`);

  sseClients.push(res);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c !== res);
  });
});

// Active Scan State
let currentScanState = {
  active: false,
  cancelRequested: false,
  startTime: null,
  totalHosts: 0,
  totalPorts: 0,
  completedPorts: 0,
  openCount: 0,
  discovered: []
};

// API: Get Local Network Interfaces / Info
app.get('/api/network-info', (req, res) => {
  const interfaces = os.networkInterfaces();
  const localIps = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4') {
        localIps.push({
          name,
          address: iface.address,
          netmask: iface.netmask,
          internal: iface.internal
        });
      }
    }
  }

  res.json({
    localIps,
    defaultPort: PORT,
    scanConcurrency: DEFAULT_CONCURRENCY,
    socketTimeout: DEFAULT_SOCKET_TIMEOUT
  });
});

// API: Start Scan
app.post('/api/scan', async (req, res) => {
  const { targets, portOption = 'all', customPorts = '', concurrency, timeout } = req.body;

  if (!targets || !targets.trim()) {
    return res.status(400).json({ error: 'Target IP address or range is required.' });
  }

  const hosts = parseTargets(targets);
  if (hosts.length === 0) {
    return res.status(400).json({ error: 'No valid target IP addresses found.' });
  }

  const ports = parsePorts(portOption, customPorts);
  if (ports.length === 0) {
    return res.status(400).json({ error: 'No valid ports selected for scanning.' });
  }

  if (currentScanState.active) {
    return res.status(409).json({ error: 'A scan is already in progress. Please stop it first or wait for it to complete.' });
  }

  const scanConcurrency = parseInt(concurrency || DEFAULT_CONCURRENCY, 10);
  const socketTimeout = parseInt(timeout || DEFAULT_SOCKET_TIMEOUT, 10);

  currentScanState = {
    active: true,
    cancelRequested: false,
    startTime: Date.now(),
    totalHosts: hosts.length,
    totalPorts: hosts.length * ports.length,
    completedPorts: 0,
    openCount: 0,
    discovered: []
  };

  res.json({
    message: 'Scan started',
    hostsCount: hosts.length,
    portsCount: ports.length,
    totalProbes: hosts.length * ports.length
  });

  broadcastSSE('scan_started', {
    hosts,
    portsCount: ports.length,
    totalProbes: currentScanState.totalPorts,
    startTime: currentScanState.startTime
  });

  // Execute scan asynchronously
  (async () => {
    try {
      const scanResult = await runScan({
        hosts,
        ports,
        concurrency: scanConcurrency,
        timeout: socketTimeout,
        isCancelled: () => currentScanState.cancelRequested,
        onProgress: progress => {
          currentScanState.completedPorts = progress.completed;
          currentScanState.openCount = progress.openCount;
          broadcastSSE('scan_progress', progress);
        },
        onOpenPort: async ({ host, port }) => {
          // Instantly notify about newly found raw port
          broadcastSSE('port_found', { host, port });

          // Inspect the port for HTTP / HTTPS and metadata
          try {
            const inspected = await inspectService(host, port, DEFAULT_HTTP_TIMEOUT);
            const saved = upsertService(inspected);
            currentScanState.discovered.push(saved);

            broadcastSSE('service_found', saved);

            // If it's a web service, queue managed screenshot thumbnail capture
            if (inspected.isWeb && inspected.url) {
              queueThumbnail(saved.id, inspected.url, updated => {
                broadcastSSE('service_updated', updated);
              });
            }
          } catch (inspectErr) {
            console.error(`Inspection failed for ${host}:${port}:`, inspectErr);
          }
        }
      });

      // Add to scan history
      addScanHistory({
        targets: hosts.join(', '),
        portRange: portOption === 'all' ? '1-65535' : (portOption === 'common' ? 'Common' : customPorts),
        openCount: currentScanState.discovered.length,
        durationSec: scanResult.durationSec
      });

      broadcastSSE('scan_completed', {
        ...scanResult,
        openDiscovered: currentScanState.discovered.length
      });
    } catch (err) {
      console.error('Scan error:', err);
      broadcastSSE('scan_error', { error: err.message });
    } finally {
      currentScanState.active = false;
      currentScanState.cancelRequested = false;
    }
  })();
});

// API: Stop Active Scan
app.post('/api/scan/stop', (req, res) => {
  if (!currentScanState.active) {
    return res.json({ message: 'No active scan to stop.' });
  }
  currentScanState.cancelRequested = true;
  broadcastSSE('scan_stopped', { message: 'Scan cancelled by user.' });
  res.json({ message: 'Scan stop requested.' });
});

// API: Get Active Scan Status
app.get('/api/scan/status', (req, res) => {
  res.json(currentScanState);
});

// API: Get All Saved Services
app.get('/api/services', (req, res) => {
  const { search, tag, protocol } = req.query;
  let services = getServices();

  if (search) {
    const s = search.toLowerCase();
    services = services.filter(item =>
      (item.title && item.title.toLowerCase().includes(s)) ||
      (item.customTitle && item.customTitle.toLowerCase().includes(s)) ||
      (item.ip && item.ip.toLowerCase().includes(s)) ||
      (item.port && item.port.toString().includes(s)) ||
      (item.notes && item.notes.toLowerCase().includes(s))
    );
  }

  if (tag) {
    services = services.filter(item => item.tags && item.tags.includes(tag));
  }

  if (protocol) {
    services = services.filter(item => item.protocol === protocol);
  }

  res.json(services);
});

// API: Get Service by ID
app.get('/api/services/:id', (req, res) => {
  const service = getServiceById(req.params.id);
  if (!service) {
    return res.status(404).json({ error: 'Service not found' });
  }
  res.json(service);
});

// API: Update Service (Rename, change tags, notes, url)
app.put('/api/services/:id', (req, res) => {
  const { customTitle, customUrl, customIcon, tags, notes, thumbnail } = req.body;
  const updated = updateService(req.params.id, {
    customTitle: customTitle !== undefined ? customTitle : undefined,
    title: customTitle || undefined,
    customUrl: customUrl !== undefined ? customUrl : undefined,
    customIcon: customIcon !== undefined ? customIcon : undefined,
    tags: Array.isArray(tags) ? tags : undefined,
    notes: notes !== undefined ? notes : undefined,
    thumbnail: thumbnail !== undefined ? thumbnail : undefined
  });

  if (!updated) {
    return res.status(404).json({ error: 'Service not found' });
  }

  broadcastSSE('service_updated', updated);
  res.json(updated);
});

// API: Toggle Favorite Status
app.post('/api/services/:id/favorite', (req, res) => {
  const updated = toggleFavorite(req.params.id);
  if (!updated) {
    return res.status(404).json({ error: 'Service not found' });
  }
  broadcastSSE('service_updated', updated);
  res.json(updated);
});

// API: Export Backup Configuration (JSON)
app.get('/api/backup/export', (req, res) => {
  const services = getServices();
  const history = getScanHistory();
  const backupData = {
    version: '1.0.0',
    exportDate: new Date().toISOString(),
    port: PORT,
    totalServices: services.length,
    services,
    scanHistory: history
  };

  const filename = `scandash-backup-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.json(backupData);
});

// API: Import Backup Configuration (JSON)
app.post('/api/backup/import', (req, res) => {
  const { services, mode = 'merge' } = req.body;
  if (!services || !Array.isArray(services)) {
    return res.status(400).json({ error: 'Invalid backup file format: missing services array.' });
  }

  const result = importServices(services, mode);
  broadcastSSE('services_reloaded', { count: result.total });
  res.json({ message: 'Backup imported successfully', ...result });
});

// API: Delete Service Card
app.delete('/api/services/:id', (req, res) => {
  const success = deleteService(req.params.id);
  if (!success) {
    return res.status(404).json({ error: 'Service not found' });
  }

  broadcastSSE('service_deleted', { id: req.params.id });
  res.json({ message: 'Service removed successfully', id: req.params.id });
});

// API: Clear All Services
app.delete('/api/services', (req, res) => {
  clearThumbnailQueue();
  clearAllServices();
  broadcastSSE('services_cleared', {});
  res.json({ message: 'All services cleared' });
});

// API: Re-probe / Refresh Single Service
app.post('/api/services/:id/refresh', async (req, res) => {
  const service = getServiceById(req.params.id);
  if (!service) {
    return res.status(404).json({ error: 'Service not found' });
  }

  try {
    const inspected = await inspectService(service.ip, service.port, DEFAULT_HTTP_TIMEOUT);
    let thumbUrl = service.thumbnail;

    if (inspected.isWeb && inspected.url) {
      const newThumb = await captureThumbnail(service.id, inspected.url);
      if (newThumb) thumbUrl = newThumb;
    }

    const updated = updateService(service.id, {
      ...inspected,
      title: service.customTitle || inspected.title,
      thumbnail: thumbUrl,
      lastSeen: new Date().toISOString(),
      online: true
    });

    broadcastSSE('service_updated', updated);
    res.json(updated);
  } catch (err) {
    const updated = updateService(service.id, { online: false });
    broadcastSSE('service_updated', updated);
    res.json({ ...updated, online: false, error: err.message });
  }
});

// API: Scan History
app.get('/api/history', (req, res) => {
  res.json(getScanHistory());
});

// API: Configuration & Environment Info
app.get('/api/config', (req, res) => {
  res.json({
    port: PORT,
    scanConcurrency: DEFAULT_CONCURRENCY,
    socketTimeout: DEFAULT_SOCKET_TIMEOUT,
    httpTimeout: DEFAULT_HTTP_TIMEOUT
  });
});

// API: Upload custom background image (base64)
app.post('/api/background/upload', (req, res) => {
  try {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ error: 'No image data provided.' });
    }

    // Verify format matches base64 data URL
    const match = image.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid image format. Expected a base64 Data URL.' });
    }

    const imgType = match[1];
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, 'base64');

    // Limit to 8MB
    if (buffer.length > 8 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image size exceeds maximum limit of 8MB.' });
    }

    const bgDir = getBackgroundsDir();
    
    // Clean up any existing custom uploaded backgrounds first to conserve space
    const files = fs.readdirSync(bgDir);
    for (const file of files) {
      if (file.startsWith('custom_bg_')) {
        try {
          fs.unlinkSync(path.join(bgDir, file));
        } catch (_) {}
      }
    }

    // Save the new background image
    const filename = `custom_bg_${Date.now()}.${imgType}`;
    const filePath = path.join(bgDir, filename);
    fs.writeFileSync(filePath, buffer);

    res.json({
      success: true,
      url: `/api/backgrounds/${filename}`
    });
  } catch (err) {
    console.error('Failed to upload background:', err);
    res.status(500).json({ error: 'Internal server error during upload.' });
  }
});

// Graceful cleanup on shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down ScanDash...');
  await closeBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeBrowser();
  process.exit(0);
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`  🚀 ScanDash is running on http://localhost:${PORT}`);
  console.log(`  ⚙️  Configured via .env (PORT=${PORT}, CONCURRENCY=${DEFAULT_CONCURRENCY})`);
  console.log(`======================================================\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Error: Port ${PORT} is already in use by another process.`);
    console.error(`👉 Change PORT in .env to another available port (e.g. 3500, 3847, 8888).\n`);
  } else {
    console.error(`\n❌ Server error:`, err);
  }
  process.exit(1);
});
