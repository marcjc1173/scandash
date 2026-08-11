import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = process.env.DATA_DIR ? path.resolve(process.cwd(), process.env.DATA_DIR) : path.resolve(__dirname, '../data');
const thumbnailsDir = path.join(dataDir, 'thumbnails');
const servicesFilePath = path.join(dataDir, 'services.json');
const historyFilePath = path.join(dataDir, 'scan_history.json');

// Ensure directories exist
export function initStorage() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(thumbnailsDir)) {
    fs.mkdirSync(thumbnailsDir, { recursive: true });
  }
  if (!fs.existsSync(servicesFilePath)) {
    fs.writeFileSync(servicesFilePath, JSON.stringify([], null, 2), 'utf-8');
  }
  if (!fs.existsSync(historyFilePath)) {
    fs.writeFileSync(historyFilePath, JSON.stringify([], null, 2), 'utf-8');
  }
}

export function getThumbnailsDir() {
  return thumbnailsDir;
}

export function getServices() {
  initStorage();
  try {
    const data = fs.readFileSync(servicesFilePath, 'utf-8');
    return JSON.parse(data || '[]');
  } catch (err) {
    console.error('Error reading services.json:', err);
    return [];
  }
}

export function saveServices(services) {
  initStorage();
  try {
    fs.writeFileSync(servicesFilePath, JSON.stringify(services, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error saving services.json:', err);
    return false;
  }
}

export function getServiceById(id) {
  const services = getServices();
  return services.find(s => s.id === id);
}

export function upsertService(serviceData) {
  const services = getServices();
  const id = serviceData.id || `${serviceData.ip}:${serviceData.port}`;
  const existingIndex = services.findIndex(s => s.id === id);

  const now = new Date().toISOString();
  if (existingIndex >= 0) {
    const existing = services[existingIndex];
    // Preserve custom titles, notes, tags if user modified them
    services[existingIndex] = {
      ...existing,
      ...serviceData,
      id,
      title: existing.customTitle || serviceData.title || existing.title || `Service on ${serviceData.port}`,
      customTitle: existing.customTitle,
      customUrl: existing.customUrl,
      customIcon: existing.customIcon,
      tags: existing.tags && existing.tags.length > 0 ? existing.tags : serviceData.tags || [],
      notes: existing.notes !== undefined ? existing.notes : serviceData.notes || '',
      thumbnail: serviceData.thumbnail || existing.thumbnail,
      lastSeen: now
    };
    saveServices(services);
    return services[existingIndex];
  } else {
    const newService = {
      id,
      ip: serviceData.ip,
      port: serviceData.port,
      protocol: serviceData.protocol || 'http',
      url: serviceData.url || `http://${serviceData.ip}:${serviceData.port}`,
      title: serviceData.title || `${serviceData.ip}:${serviceData.port}`,
      customTitle: null,
      customUrl: null,
      customIcon: null,
      statusCode: serviceData.statusCode || 200,
      serverBanner: serviceData.serverBanner || '',
      thumbnail: serviceData.thumbnail || null,
      tags: serviceData.tags || [],
      notes: serviceData.notes || '',
      firstSeen: now,
      lastSeen: now,
      online: true
    };
    services.unshift(newService);
    saveServices(services);
    return newService;
  }
}

export function updateService(id, updates) {
  const services = getServices();
  const index = services.findIndex(s => s.id === id);
  if (index === -1) return null;

  services[index] = {
    ...services[index],
    ...updates,
    id // preserve id
  };
  saveServices(services);
  return services[index];
}

export function deleteService(id) {
  const services = getServices();
  const filtered = services.filter(s => s.id !== id);
  if (filtered.length === services.length) return false;

  saveServices(filtered);

  // Clean up thumbnail if exists
  const thumbPath = path.join(thumbnailsDir, `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.webp`);
  if (fs.existsSync(thumbPath)) {
    try {
      fs.unlinkSync(thumbPath);
    } catch (_) {}
  }
  return true;
}

export function clearAllServices() {
  saveServices([]);
  return true;
}

export function getScanHistory() {
  initStorage();
  try {
    const data = fs.readFileSync(historyFilePath, 'utf-8');
    return JSON.parse(data || '[]');
  } catch {
    return [];
  }
}

export function addScanHistory(entry) {
  initStorage();
  try {
    const history = getScanHistory();
    history.unshift({
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      ...entry
    });
    // Keep max 50 history entries
    if (history.length > 50) history.pop();
    fs.writeFileSync(historyFilePath, JSON.stringify(history, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error adding scan history:', err);
  }
}
