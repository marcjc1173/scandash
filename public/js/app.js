/**
 * ScanDash — Frontend Client Application
 */

// Application State
const state = {
  services: [],
  activeFilter: 'all',
  searchQuery: '',
  sortBy: 'recent',
  isScanning: false,
  networkInfo: null,
  config: null,
  lastScanResult: null,
  scanHistory: []
};

// DOM Elements
const elements = {
  servicesGrid: document.getElementById('servicesGrid'),
  emptyState: document.getElementById('emptyState'),
  totalCount: document.getElementById('totalCount'),
  webCount: document.getElementById('webCount'),
  sslCount: document.getElementById('sslCount'),
  envPortLabel: document.getElementById('envPortLabel'),
  searchInput: document.getElementById('searchInput'),
  clearSearchBtn: document.getElementById('clearSearchBtn'),
  sortSelect: document.getElementById('sortSelect'),
  filterChips: document.querySelectorAll('.filter-chips .chip'),
  
  // Header Scan Status
  headerScanStatusBadge: document.getElementById('headerScanStatusBadge'),
  headerScanStatusText: document.getElementById('headerScanStatusText'),

  // Modals & Panels
  scanModal: document.getElementById('scanModal'),
  openScanModalBtn: document.getElementById('openScanModalBtn'),
  emptyScanBtn: document.getElementById('emptyScanBtn'),
  closeScanModalBtn: document.getElementById('closeScanModalBtn'),
  cancelScanModalBtn: document.getElementById('cancelScanModalBtn'),
  scanForm: document.getElementById('scanForm'),
  targetIpsInput: document.getElementById('targetIpsInput'),
  quickIpPills: document.getElementById('quickIpPills'),
  customPortsInputWrap: document.getElementById('customPortsInputWrap'),
  customPortsInput: document.getElementById('customPortsInput'),
  concurrencyInput: document.getElementById('concurrencyInput'),
  timeoutInput: document.getElementById('timeoutInput'),

  scanProgressPanel: document.getElementById('scanProgressPanel'),
  scanTargetLabel: document.getElementById('scanTargetLabel'),
  scanMetaLabel: document.getElementById('scanMetaLabel'),
  scanProgressFill: document.getElementById('scanProgressFill'),
  scanPercentText: document.getElementById('scanPercentText'),
  stopScanBtn: document.getElementById('stopScanBtn'),

  // History Modal
  openHistoryModalBtn: document.getElementById('openHistoryModalBtn'),
  historyModal: document.getElementById('historyModal'),
  closeHistoryModalBtn: document.getElementById('closeHistoryModalBtn'),
  closeHistoryModalBtn2: document.getElementById('closeHistoryModalBtn2'),
  historyListContainer: document.getElementById('historyListContainer'),
  historyEmpty: document.getElementById('historyEmpty'),
  historyActiveScanCard: document.getElementById('historyActiveScanCard'),
  historyActiveScanDetails: document.getElementById('historyActiveScanDetails'),

  refreshAllBtn: document.getElementById('refreshAllBtn'),
  clearAllServicesBtn: document.getElementById('clearAllServicesBtn'),

  editModal: document.getElementById('editModal'),
  editForm: document.getElementById('editForm'),
  editServiceId: document.getElementById('editServiceId'),
  editTitleInput: document.getElementById('editTitleInput'),
  editUrlInput: document.getElementById('editUrlInput'),
  editTagsInput: document.getElementById('editTagsInput'),
  editNotesInput: document.getElementById('editNotesInput'),
  closeEditModalBtn: document.getElementById('closeEditModalBtn'),
  cancelEditModalBtn: document.getElementById('cancelEditModalBtn'),
  deleteFromEditModalBtn: document.getElementById('deleteFromEditModalBtn'),
  editModalSub: document.getElementById('editModalSub'),

  // Theme Toggle
  themeToggleBtn: document.getElementById('themeToggleBtn'),
  themeIconMoon: document.querySelector('.theme-icon-moon'),
  themeIconSun: document.querySelector('.theme-icon-sun'),

  toastContainer: document.getElementById('toastContainer')
};

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initEventListeners();
  loadConfigAndNetwork();
  loadServices();
  loadInitialScanStatus();
  initSSE();
});

// Theme Management
function initTheme() {
  const savedTheme = localStorage.getItem('scandash_theme') || 'dark';
  applyTheme(savedTheme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('scandash_theme', theme);
  if (theme === 'light') {
    if (elements.themeIconMoon) elements.themeIconMoon.style.display = 'none';
    if (elements.themeIconSun) elements.themeIconSun.style.display = 'block';
  } else {
    if (elements.themeIconMoon) elements.themeIconMoon.style.display = 'block';
    if (elements.themeIconSun) elements.themeIconSun.style.display = 'none';
  }
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  applyTheme(newTheme);
  showToast(`Switched to ${newTheme.charAt(0).toUpperCase() + newTheme.slice(1)} Mode`, 'info');
}

// Toast notification helper
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let iconSvg = '';
  if (type === 'success') {
    iconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
  } else if (type === 'danger') {
    iconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
  } else {
    iconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00f2fe" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
  }

  toast.innerHTML = `${iconSvg}<span>${escapeHtml(message)}</span>`;
  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(50px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Update Header Scan Status Indicator
function updateScanStatusBadge(type, text) {
  elements.headerScanStatusBadge.classList.remove('scanning', 'complete', 'stopped');
  if (type === 'scanning') {
    elements.headerScanStatusBadge.classList.add('scanning');
  } else if (type === 'complete') {
    elements.headerScanStatusBadge.classList.add('complete');
  } else if (type === 'stopped') {
    elements.headerScanStatusBadge.classList.add('stopped');
  }
  elements.headerScanStatusText.textContent = text;
}

// Fetch Server Config and Network Details
async function loadConfigAndNetwork() {
  try {
    const [configRes, netRes] = await Promise.all([
      fetch('/api/config').then(r => r.json()),
      fetch('/api/network-info').then(r => r.json())
    ]);

    state.config = configRes;
    state.networkInfo = netRes;

    if (configRes.port) {
      elements.envPortLabel.textContent = `PORT :${configRes.port}`;
    }

    if (configRes.scanConcurrency) {
      elements.concurrencyInput.value = configRes.scanConcurrency;
    }
    if (configRes.socketTimeout) {
      elements.timeoutInput.value = configRes.socketTimeout;
    }

    // Populate quick IP pills
    if (netRes.localIps && netRes.localIps.length > 0) {
      elements.quickIpPills.innerHTML = '<span class="pill-label">Quick select:</span>';
      
      // Always include 127.0.0.1
      const localhostBtn = document.createElement('button');
      localhostBtn.type = 'button';
      localhostBtn.className = 'ip-pill';
      localhostBtn.textContent = '127.0.0.1 (Localhost)';
      localhostBtn.addEventListener('click', () => {
        elements.targetIpsInput.value = '127.0.0.1';
      });
      elements.quickIpPills.appendChild(localhostBtn);

      netRes.localIps.forEach(iface => {
        if (iface.address !== '127.0.0.1') {
          const pill = document.createElement('button');
          pill.type = 'button';
          pill.className = 'ip-pill';
          pill.textContent = `${iface.address} (${iface.name})`;
          pill.addEventListener('click', () => {
            elements.targetIpsInput.value = iface.address;
          });
          elements.quickIpPills.appendChild(pill);
        }
      });
    }
  } catch (err) {
    console.error('Failed to load network info:', err);
  }
}

// Load Initial Scan Status & Recent History on Page Load
async function loadInitialScanStatus() {
  try {
    const [statusRes, historyRes] = await Promise.all([
      fetch('/api/scan/status').then(r => r.json()),
      fetch('/api/history').then(r => r.json())
    ]);

    state.scanHistory = historyRes || [];

    if (statusRes && statusRes.active) {
      state.isScanning = true;
      const pct = Math.round((statusRes.completedPorts / (statusRes.totalPorts || 1)) * 100);
      updateScanStatusBadge('scanning', `Scanning (${pct}%)`);
      elements.scanProgressPanel.style.display = 'block';
      elements.scanTargetLabel.textContent = `Scanning ${statusRes.totalHosts} host(s) across ${statusRes.totalPorts?.toLocaleString()} ports...`;
      elements.scanProgressFill.style.width = `${pct}%`;
      elements.scanPercentText.textContent = `${pct}%`;
    } else if (state.scanHistory.length > 0) {
      const last = state.scanHistory[0];
      const timeStr = formatRelativeTime(new Date(last.timestamp));
      updateScanStatusBadge('complete', `Last Scan: ${last.openCount} found (${timeStr})`);
    } else {
      updateScanStatusBadge('idle', 'Ready to Scan');
    }
  } catch (err) {
    console.warn('Could not fetch initial scan status:', err);
  }
}

// Load Services from API
async function loadServices() {
  try {
    const res = await fetch('/api/services');
    state.services = await res.json();
    renderServices();
  } catch (err) {
    console.error('Failed to load services:', err);
    showToast('Could not load services from server', 'danger');
  }
}

// Server-Sent Events (SSE) for Real-Time Updates
function initSSE() {
  const evtSource = new EventSource('/api/scan/progress');

  evtSource.addEventListener('scan_started', e => {
    state.isScanning = true;
    const data = JSON.parse(e.data);
    updateScanStatusBadge('scanning', `Scanning (${data.hosts.join(', ')})...`);
    elements.scanProgressPanel.style.display = 'block';
    elements.scanTargetLabel.textContent = `Scanning ${data.hosts.join(', ')} across ${data.portsCount.toLocaleString()} ports...`;
    elements.scanMetaLabel.textContent = `0 / ${data.totalProbes.toLocaleString()} ports • 0 ports/sec`;
    elements.scanProgressFill.style.width = '0%';
    elements.scanPercentText.textContent = '0%';
  });

  evtSource.addEventListener('scan_progress', e => {
    const p = JSON.parse(e.data);
    state.isScanning = true;
    updateScanStatusBadge('scanning', `Scanning ${p.percent}% • ${p.portsPerSec.toLocaleString()}/s`);
    elements.scanProgressPanel.style.display = 'block';
    elements.scanProgressFill.style.width = `${p.percent}%`;
    elements.scanPercentText.textContent = `${p.percent}%`;
    elements.scanMetaLabel.textContent = `${p.completed.toLocaleString()} / ${p.total.toLocaleString()} ports • ${p.portsPerSec.toLocaleString()} ports/sec • ${p.openCount} open found`;
  });

  evtSource.addEventListener('port_found', e => {
    const p = JSON.parse(e.data);
    showToast(`Discovered open port ${p.host}:${p.port}`, 'info');
  });

  evtSource.addEventListener('service_found', e => {
    const service = JSON.parse(e.data);
    const existingIndex = state.services.findIndex(s => s.id === service.id);
    if (existingIndex >= 0) {
      state.services[existingIndex] = service;
    } else {
      state.services.unshift(service);
    }
    renderServices();
  });

  evtSource.addEventListener('service_updated', e => {
    const service = JSON.parse(e.data);
    const existingIndex = state.services.findIndex(s => s.id === service.id);
    if (existingIndex >= 0) {
      state.services[existingIndex] = service;
      renderServices();
    }
  });

  evtSource.addEventListener('service_deleted', e => {
    const { id } = JSON.parse(e.data);
    state.services = state.services.filter(s => s.id !== id);
    renderServices();
  });

  evtSource.addEventListener('services_cleared', () => {
    state.services = [];
    renderServices();
  });

  evtSource.addEventListener('scan_completed', e => {
    state.isScanning = false;
    const data = JSON.parse(e.data);
    state.lastScanResult = data;
    updateScanStatusBadge('complete', `Scan Complete • ${data.openDiscovered || 0} found in ${data.durationSec}s`);
    showToast(`Scan complete: ${data.openDiscovered || 0} open services discovered in ${data.durationSec}s`, 'success');
    
    // Update progress HUD to completed view
    elements.scanTargetLabel.textContent = `✅ Scan Completed across ${data.totalScanned?.toLocaleString()} ports in ${data.durationSec}s`;
    elements.scanMetaLabel.textContent = `Found ${data.openDiscovered || 0} open services • 100% complete`;
    elements.scanProgressFill.style.width = '100%';
    elements.scanPercentText.textContent = '100%';

    // Refresh history
    fetch('/api/history').then(r => r.json()).then(h => { state.scanHistory = h; });

    setTimeout(() => {
      if (!state.isScanning) {
        elements.scanProgressPanel.style.display = 'none';
      }
    }, 6000);
  });

  evtSource.addEventListener('scan_stopped', () => {
    state.isScanning = false;
    updateScanStatusBadge('stopped', 'Scan Stopped');
    showToast('Scan stopped by user', 'warning');
    setTimeout(() => {
      elements.scanProgressPanel.style.display = 'none';
    }, 3000);
  });

  evtSource.addEventListener('scan_error', e => {
    state.isScanning = false;
    const { error } = JSON.parse(e.data);
    updateScanStatusBadge('stopped', 'Scan Error');
    showToast(`Scan error: ${error}`, 'danger');
  });

  evtSource.onerror = () => {
    console.warn('SSE connection interrupted, will automatically reconnect...');
  };
}

// Format Relative Time (e.g. "2m ago", "Just now")
function formatRelativeTime(date) {
  const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
  if (diffSec < 45) return 'Just now';
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  return date.toLocaleDateString();
}

// Render History Modal
async function openHistoryModal() {
  try {
    const history = await fetch('/api/history').then(r => r.json());
    state.scanHistory = history || [];

    // Check active scan
    if (state.isScanning) {
      elements.historyActiveScanCard.style.display = 'block';
      elements.historyActiveScanDetails.textContent = elements.scanMetaLabel.textContent || 'Scan in progress...';
    } else {
      elements.historyActiveScanCard.style.display = 'none';
    }

    if (!history || history.length === 0) {
      elements.historyListContainer.innerHTML = '<div class="history-empty">No previous scans recorded.</div>';
    } else {
      elements.historyListContainer.innerHTML = history.map(item => `
        <div class="history-item">
          <div>
            <div class="history-target">${escapeHtml(item.targets || 'Target')}</div>
            <div class="history-time">${new Date(item.timestamp).toLocaleString()} • Range: ${escapeHtml(item.portRange || 'Full')}</div>
          </div>
          <div class="history-meta">
            <span class="history-badge success">${item.openCount || 0} Open</span>
            <span class="history-badge">${item.durationSec ? `${item.durationSec}s` : 'Done'}</span>
          </div>
        </div>
      `).join('');
    }

    elements.historyModal.style.display = 'flex';
  } catch (err) {
    showToast('Could not load scan history', 'danger');
  }
}

function closeHistoryModal() {
  elements.historyModal.style.display = 'none';
}

// Filter and Sort Services
function getFilteredAndSortedServices() {
  let list = [...state.services];

  // 1. Search Query Filter
  if (state.searchQuery.trim()) {
    const q = state.searchQuery.toLowerCase().trim();
    list = list.filter(item => {
      const title = (item.customTitle || item.title || '').toLowerCase();
      const ip = (item.ip || '').toLowerCase();
      const port = (item.port || '').toString();
      const tags = (item.tags || []).join(' ').toLowerCase();
      const notes = (item.notes || '').toLowerCase();
      return title.includes(q) || ip.includes(q) || port.includes(q) || tags.includes(q) || notes.includes(q);
    });
  }

  // 2. Tag Filter
  if (state.activeFilter !== 'all') {
    if (state.activeFilter === 'web') {
      list = list.filter(item => item.isWeb || item.protocol === 'http' || item.protocol === 'https');
    } else if (state.activeFilter === 'ssl') {
      list = list.filter(item => item.protocol === 'https' || (item.tags && item.tags.includes('ssl')));
    } else if (state.activeFilter === 'ssh') {
      list = list.filter(item => item.protocol === 'ssh' || item.port === 22 || (item.tags && item.tags.includes('ssh')));
    } else if (state.activeFilter === 'database') {
      list = list.filter(item => item.tags && (item.tags.includes('database') || ['3306', '5432', '27017', '6379', '1433'].includes(item.port.toString())));
    } else {
      list = list.filter(item => item.tags && item.tags.includes(state.activeFilter));
    }
  }

  // 3. Sorting
  if (state.sortBy === 'port') {
    list.sort((a, b) => a.port - b.port);
  } else if (state.sortBy === 'ip') {
    list.sort((a, b) => (a.ip || '').localeCompare(b.ip || ''));
  } else if (state.sortBy === 'name') {
    list.sort((a, b) => {
      const nameA = (a.customTitle || a.title || '').toLowerCase();
      const nameB = (b.customTitle || b.title || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });
  } else {
    // Recent / default
    list.sort((a, b) => new Date(b.lastSeen || 0) - new Date(a.lastSeen || 0));
  }

  return list;
}

// Render Dashboard Service Cards
function renderServices() {
  const filtered = getFilteredAndSortedServices();

  // Update counts
  elements.totalCount.textContent = state.services.length;
  elements.webCount.textContent = state.services.filter(s => s.isWeb || s.protocol === 'http' || s.protocol === 'https').length;
  elements.sslCount.textContent = state.services.filter(s => s.protocol === 'https' || (s.tags && s.tags.includes('ssl'))).length;

  if (filtered.length === 0) {
    elements.servicesGrid.innerHTML = '';
    elements.emptyState.style.display = 'block';
    return;
  }

  elements.emptyState.style.display = 'none';
  elements.servicesGrid.innerHTML = filtered.map(service => createServiceCardHtml(service)).join('');

  // Attach card event listeners
  attachCardEvents();
}

// Generate Service Card HTML
function createServiceCardHtml(service) {
  const displayName = service.customTitle || service.title || `${service.ip}:${service.port}`;
  const targetUrl = service.customUrl || service.url || (service.isWeb ? `${service.protocol}://${service.ip}:${service.port}` : null);
  const isOnline = service.online !== false;
  const protocol = (service.protocol || 'tcp').toUpperCase();
  const isHttps = service.protocol === 'https';
  const isHttp = service.protocol === 'http';
  
  // Thumbnail or Placeholder
  let thumbnailHtml = '';
  if (service.thumbnail) {
    thumbnailHtml = `
      <img src="${escapeHtml(service.thumbnail)}" alt="${escapeHtml(displayName)} preview" class="card-thumbnail-img" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
      <div class="card-thumbnail-placeholder" style="display: none;">
        <div class="placeholder-proto-badge">${escapeHtml(protocol)}</div>
        <div class="placeholder-meta">${escapeHtml(service.ip)}:${service.port}</div>
      </div>
    `;
  } else if (service.isWeb) {
    thumbnailHtml = `
      <div class="card-thumbnail-placeholder capturing">
        <div class="progress-spinner" style="width: 28px; height: 28px; margin-bottom: 4px;"></div>
        <div class="placeholder-proto-badge" style="font-size: 0.8rem;">Capturing preview...</div>
        <div class="placeholder-meta">${escapeHtml(service.ip)}:${service.port}</div>
      </div>
    `;
  } else {
    thumbnailHtml = `
      <div class="card-thumbnail-placeholder">
        <div class="placeholder-proto-badge">${escapeHtml(protocol)}</div>
        <div class="placeholder-meta">${escapeHtml(service.ip)}:${service.port}</div>
      </div>
    `;
  }

  // Tags
  const tagsHtml = (service.tags || []).map(t => `<span class="tag-badge">#${escapeHtml(t)}</span>`).join('');

  return `
    <div class="service-card" data-id="${escapeHtml(service.id)}">
      <div class="card-thumbnail-wrap">
        ${thumbnailHtml}
        <div class="card-overlay-top">
          <span class="status-pill ${isOnline ? 'online' : 'offline'}">
            <span class="status-dot"></span>
            ${isOnline ? (service.statusCode ? `${service.statusCode} OK` : 'Online') : 'Offline'}
          </span>
          <span class="proto-pill ${isHttps ? 'https' : (isHttp ? 'http' : '')}">${escapeHtml(protocol)}</span>
        </div>
      </div>

      <div class="card-body">
        <div class="card-title-row">
          <h4 class="card-title" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</h4>
        </div>
        
        <div class="card-target-address">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <polygon points="12 6 12 12 16 14"/>
          </svg>
          <span>${escapeHtml(service.ip)}:${service.port}</span>
        </div>

        ${service.notes ? `<p class="card-notes" title="${escapeHtml(service.notes)}">${escapeHtml(service.notes)}</p>` : ''}

        ${tagsHtml ? `<div class="card-tags">${tagsHtml}</div>` : ''}
      </div>

      <div class="card-footer">
        <div class="card-actions-left">
          <button class="action-icon-btn edit-card-btn" data-id="${escapeHtml(service.id)}" title="Edit card details">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          
          <button class="action-icon-btn reprobe-card-btn" data-id="${escapeHtml(service.id)}" title="Re-probe service & update thumbnail">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
            </svg>
          </button>

          <button class="action-icon-btn delete-btn delete-card-btn" data-id="${escapeHtml(service.id)}" title="Delete card">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>

        ${targetUrl ? `
          <a href="${escapeHtml(targetUrl)}" target="_blank" rel="noopener noreferrer" class="open-link-btn">
            <span>Open</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a>
        ` : `
          <span class="tag-badge" style="font-family: var(--font-mono)">:${service.port}</span>
        `}
      </div>
    </div>
  `;
}

// Attach Event Listeners to rendered cards
function attachCardEvents() {
  // Edit card buttons
  document.querySelectorAll('.edit-card-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      openEditModal(id);
    });
  });

  // Re-probe buttons
  document.querySelectorAll('.reprobe-card-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      btn.style.animation = 'spin 1s linear infinite';
      showToast(`Re-probing ${id}...`, 'info');
      try {
        const res = await fetch(`/api/services/${encodeURIComponent(id)}/refresh`, { method: 'POST' });
        const updated = await res.json();
        const idx = state.services.findIndex(s => s.id === id);
        if (idx >= 0) {
          state.services[idx] = updated;
          renderServices();
        }
        showToast(`Updated ${id}`, 'success');
      } catch (err) {
        showToast(`Failed to refresh ${id}`, 'danger');
      }
    });
  });

  // Delete card buttons
  document.querySelectorAll('.delete-card-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      if (confirm(`Remove "${id}" from dashboard?`)) {
        try {
          await fetch(`/api/services/${encodeURIComponent(id)}`, { method: 'DELETE' });
          state.services = state.services.filter(s => s.id !== id);
          renderServices();
          showToast(`Removed ${id}`, 'success');
        } catch (err) {
          showToast(`Could not delete ${id}`, 'danger');
        }
      }
    });
  });
}

// Open Edit Modal
function openEditModal(serviceId) {
  const service = state.services.find(s => s.id === serviceId);
  if (!service) return;

  elements.editServiceId.value = service.id;
  elements.editTitleInput.value = service.customTitle || service.title || '';
  elements.editUrlInput.value = service.customUrl || service.url || '';
  elements.editTagsInput.value = (service.tags || []).join(', ');
  elements.editNotesInput.value = service.notes || '';
  elements.editModalSub.textContent = `Editing ${service.ip}:${service.port} (${service.protocol.toUpperCase()})`;

  elements.editModal.style.display = 'flex';
}

function closeEditModal() {
  elements.editModal.style.display = 'none';
}

// Setup Event Listeners
function initEventListeners() {
  // Search input
  elements.searchInput.addEventListener('input', e => {
    state.searchQuery = e.target.value;
    elements.clearSearchBtn.style.display = state.searchQuery ? 'block' : 'none';
    renderServices();
  });

  elements.clearSearchBtn.addEventListener('click', () => {
    elements.searchInput.value = '';
    state.searchQuery = '';
    elements.clearSearchBtn.style.display = 'none';
    renderServices();
  });

  // Sort select
  elements.sortSelect.addEventListener('change', e => {
    state.sortBy = e.target.value;
    renderServices();
  });

  // Filter chips
  elements.filterChips.forEach(chip => {
    chip.addEventListener('click', () => {
      elements.filterChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.activeFilter = chip.getAttribute('data-tag');
      renderServices();
    });
  });

  // Theme toggle button
  if (elements.themeToggleBtn) {
    elements.themeToggleBtn.addEventListener('click', toggleTheme);
  }

  // Header status badge click -> opens history / status modal
  elements.headerScanStatusBadge.addEventListener('click', openHistoryModal);
  elements.openHistoryModalBtn.addEventListener('click', openHistoryModal);
  elements.closeHistoryModalBtn.addEventListener('click', closeHistoryModal);
  elements.closeHistoryModalBtn2.addEventListener('click', closeHistoryModal);

  // Scan modal open / close
  const openModal = () => {
    elements.scanModal.style.display = 'flex';
    if (!elements.targetIpsInput.value) {
      elements.targetIpsInput.value = '127.0.0.1';
    }
  };
  elements.openScanModalBtn.addEventListener('click', openModal);
  elements.emptyScanBtn.addEventListener('click', openModal);
  elements.closeScanModalBtn.addEventListener('click', () => {
    elements.scanModal.style.display = 'none';
  });
  elements.cancelScanModalBtn.addEventListener('click', () => {
    elements.scanModal.style.display = 'none';
  });

  // Port radio selector toggle
  document.querySelectorAll('input[name="portOption"]').forEach(radio => {
    radio.addEventListener('change', e => {
      document.querySelectorAll('.radio-card').forEach(rc => rc.classList.remove('active'));
      e.target.closest('.radio-card').classList.add('active');
      if (e.target.value === 'custom') {
        elements.customPortsInputWrap.style.display = 'block';
        elements.customPortsInput.focus();
      } else {
        elements.customPortsInputWrap.style.display = 'none';
      }
    });
  });

  // Scan Form Submit
  elements.scanForm.addEventListener('submit', async e => {
    e.preventDefault();
    const targets = elements.targetIpsInput.value.trim();
    const portOption = document.querySelector('input[name="portOption"]:checked')?.value || 'all';
    const customPorts = elements.customPortsInput.value.trim();
    const concurrency = parseInt(elements.concurrencyInput.value || '750', 10);
    const timeout = parseInt(elements.timeoutInput.value || '350', 10);

    if (!targets) {
      showToast('Please specify target IP address or range', 'warning');
      return;
    }

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets, portOption, customPorts, concurrency, timeout })
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Failed to start scan', 'danger');
        return;
      }

      elements.scanModal.style.display = 'none';
      showToast(`Scan initiated for ${data.hostsCount} host(s) across ${data.portsCount.toLocaleString()} ports`, 'info');
    } catch (err) {
      showToast('Error starting scan request', 'danger');
    }
  });

  // Stop Scan button
  elements.stopScanBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/scan/stop', { method: 'POST' });
      showToast('Scan stop requested', 'warning');
    } catch (err) {
      showToast('Failed to stop scan', 'danger');
    }
  });

  // Refresh All Services
  elements.refreshAllBtn.addEventListener('click', async () => {
    elements.refreshAllBtn.classList.add('btn-loading');
    showToast('Refreshing all dashboard services...', 'info');
    await loadServices();
    elements.refreshAllBtn.classList.remove('btn-loading');
  });

  // Clear All Services
  elements.clearAllServicesBtn.addEventListener('click', async () => {
    if (state.services.length === 0) return;
    if (confirm('Are you sure you want to clear all discovered services from the dashboard?')) {
      try {
        await fetch('/api/services', { method: 'DELETE' });
        state.services = [];
        renderServices();
        showToast('All services cleared', 'success');
      } catch (err) {
        showToast('Failed to clear services', 'danger');
      }
    }
  });

  // Edit Modal form submit
  elements.editForm.addEventListener('submit', async e => {
    e.preventDefault();
    const id = elements.editServiceId.value;
    const customTitle = elements.editTitleInput.value.trim();
    const customUrl = elements.editUrlInput.value.trim();
    const tags = elements.editTagsInput.value
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(Boolean);
    const notes = elements.editNotesInput.value.trim();

    try {
      const res = await fetch(`/api/services/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customTitle, customUrl, tags, notes })
      });

      const updated = await res.json();
      const idx = state.services.findIndex(s => s.id === id);
      if (idx >= 0) {
        state.services[idx] = updated;
        renderServices();
      }

      closeEditModal();
      showToast('Service card updated', 'success');
    } catch (err) {
      showToast('Failed to save service updates', 'danger');
    }
  });

  // Delete from Edit Modal
  elements.deleteFromEditModalBtn.addEventListener('click', async () => {
    const id = elements.editServiceId.value;
    if (confirm(`Delete "${id}"?`)) {
      try {
        await fetch(`/api/services/${encodeURIComponent(id)}`, { method: 'DELETE' });
        state.services = state.services.filter(s => s.id !== id);
        renderServices();
        closeEditModal();
        showToast(`Deleted ${id}`, 'success');
      } catch (err) {
        showToast('Failed to delete service', 'danger');
      }
    }
  });

  elements.closeEditModalBtn.addEventListener('click', closeEditModal);
  elements.cancelEditModalBtn.addEventListener('click', closeEditModal);

  // Close modals on backdrop click
  window.addEventListener('click', e => {
    if (e.target === elements.scanModal) {
      elements.scanModal.style.display = 'none';
    }
    if (e.target === elements.editModal) {
      elements.editModal.style.display = 'none';
    }
    if (e.target === elements.historyModal) {
      elements.historyModal.style.display = 'none';
    }
  });
}

// Utility: HTML Escaper
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
