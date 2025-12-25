// Configuration
const USE_SECURE = window.location.protocol === 'https:' ||
                   localStorage.getItem('forceSecure') === 'true';

const API_PROTOCOL = USE_SECURE ? 'https' : 'http';
const WS_PROTOCOL = USE_SECURE ? 'wss' : 'ws';
const API_HOST = window.location.hostname === 'localhost' ? 'localhost:8080' : window.location.host;

const API_URL = `${API_PROTOCOL}://${API_HOST}`;
const WS_URL = `${WS_PROTOCOL}://${API_HOST}`;

let USER_ID = null; // Will be set from session after login

console.log('🔒 Security Configuration:');
console.log(`  Protocol: ${USE_SECURE ? 'HTTPS/WSS (Secure)' : 'HTTP/WS (Development)'}`);
console.log(`  API URL: ${API_URL}`);
console.log(`  WebSocket URL: ${WS_URL}`);

// State
let ws = null;
let tasks = [];
let currentTask = null; // Currently viewing task
let loadTasksTimeout = null;

// Folder state
let folders = [];
let currentFolderId = 'all'; // 'all' or folder UUID
let isEditingFolder = false;
let editingFolderId = null;

// Google Docs Flow - Session Management
let currentSessionId = null;
let autoSaveTimer = null;
let lastSavedContent = '';
let isSaving = false;
let lastAutoSaveTime = null;

// HIPAA-Compliant In-Memory PDF Cache
// Caches PDFs in browser RAM only (never written to disk)
// Automatically cleared on logout, session end, or navigation away
const pdfCache = new Map(); // taskId -> { blobUrl: string, timestamp: number }

// ==========================================
// MASTER KVP DATA (23 Sector Templates)
// ==========================================
let masterKvpData = null;

async function loadMasterKvps() {
  try {
    const response = await fetch('/master_kvps.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    masterKvpData = await response.json();
    console.log(`✓ Loaded ${Object.keys(masterKvpData.sectors).length} sectors with ${masterKvpData.total_canonical_keys} KVP keys`);
  } catch (err) {
    console.error('Failed to load master KVPs:', err);
    masterKvpData = { sectors: {} };
  }
}

function getSectorList() {
  if (!masterKvpData || !masterKvpData.sectors) return [];
  return Object.entries(masterKvpData.sectors).map(([id, sector]) => ({
    id,
    name: sector.name,
    count: sector.kvps ? sector.kvps.length : 0
  })).sort((a, b) => a.name.localeCompare(b.name));
}

function getSectorKvps(sectorId) {
  if (!masterKvpData || !masterKvpData.sectors || !masterKvpData.sectors[sectorId]) return [];
  return masterKvpData.sectors[sectorId].kvps.map(kvp => kvp.key);
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Check if user is authenticated
  const isAuthenticated = await checkAuth();
  if (!isAuthenticated) {
    window.location.href = 'auth.html';
    return;
  }

  // Initialize inactivity tracking (15 minute timeout)
  initInactivityTracking();

  // Load master KVP data for sector templates (non-blocking)
  loadMasterKvps();

  initUpload();
  initFormatModal();
  initKvpConfigModal();
  initEmptyStateUpload();
  initWebSocket();

  // Debug mode toggle (press 'C' to show cell boundaries)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'c' || e.key === 'C') {
      // Don't toggle if user is typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      document.body.classList.toggle('debug-mode');
      console.log('Debug mode:', document.body.classList.contains('debug-mode') ? 'ON' : 'OFF');
    }
  });
  initFolders();
  await loadFolders();
  await loadTasks();

  // Check if a project was selected from the sidebar
  const selectedProject = localStorage.getItem('selectedProject');
  if (selectedProject) {
    // Clear the flag
    localStorage.removeItem('selectedProject');

    console.log('📁 Auto-selecting project from sidebar:', selectedProject);

    // Wait a bit for tasks to load, then show first document in viewer
    setTimeout(() => {
      // Check if this project/folder exists
      const folderExists = folders.some(f => f.id === selectedProject);

      let projectTasks;
      if (folderExists) {
        // Select the specific folder
        selectFolder(selectedProject);
        projectTasks = tasks.filter(t => t.folder_id === selectedProject);
      } else {
        // Folder doesn't exist, show all documents instead
        console.log('⚠️ Folder not found, showing all documents');
        selectFolder('all');
        projectTasks = tasks;
      }

      // Show first document in viewer if available
      if (projectTasks.length > 0) {
        console.log('📄 Auto-opening first document in viewer');
        showViewer(projectTasks[0]);
      } else {
        console.log('📭 No documents available in this project');
      }
    }, 500);
  }

  // Upload button - opens modal
  const uploadBtn = document.getElementById('uploadBtn');
  const uploadModal = document.getElementById('uploadModal');
  const closeUploadModal = document.getElementById('closeUploadModal');

  if (uploadBtn && uploadModal) {
    uploadBtn.addEventListener('click', () => {
      uploadModal.classList.add('active');
    });
  }

  if (closeUploadModal && uploadModal) {
    closeUploadModal.addEventListener('click', () => {
      uploadModal.classList.remove('active');
    });

    // Close modal when clicking outside
    uploadModal.addEventListener('click', (e) => {
      if (e.target === uploadModal) {
        uploadModal.classList.remove('active');
      }
    });
  }

  // Account button
  const accountBtn = document.getElementById('accountBtn');
  if (accountBtn) {
    accountBtn.addEventListener('click', () => {
      window.location.href = 'account.html';
    });
  }

  // Logout button
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', logout);
  }

  // Back button (viewer → dashboard)
  const backBtn = document.getElementById('backBtn');
  if (backBtn) {
    backBtn.addEventListener('click', showDashboard);
  }

  // Viewer action buttons
  document.getElementById('copyTextHeaderBtn')?.addEventListener('click', copyExtractedTextHeader);
  document.getElementById('downloadResultBtn')?.addEventListener('click', () => downloadResult(currentTask.id));
  document.getElementById('downloadOriginalBtn')?.addEventListener('click', () => downloadOriginal(currentTask.id));

  // Render files list
  renderFilesList();

  document.getElementById('deleteTaskBtn')?.addEventListener('click', () => deleteTaskFromViewer(currentTask.id));
  document.getElementById('retryBtn')?.addEventListener('click', retryTask);
  document.getElementById('backToListBtn')?.addEventListener('click', showDashboard);

  // Preview toggle buttons
  document.getElementById('toggleUntxt')?.addEventListener('click', () => switchPreview('untxt'));
  document.getElementById('toggleOriginal')?.addEventListener('click', () => switchPreview('original'));

  // View toggle buttons (Grid/List)
  const gridViewBtn = document.getElementById('gridViewBtn');
  const listViewBtn = document.getElementById('listViewBtn');
  const documentGrid = document.getElementById('documentGrid');

  if (gridViewBtn && listViewBtn && documentGrid) {
    gridViewBtn.addEventListener('click', () => {
      documentGrid.classList.remove('list-view');
      gridViewBtn.classList.add('active');
      listViewBtn.classList.remove('active');
      localStorage.setItem('viewMode', 'grid');
    });

    listViewBtn.addEventListener('click', () => {
      documentGrid.classList.add('list-view');
      listViewBtn.classList.add('active');
      gridViewBtn.classList.remove('active');
      localStorage.setItem('viewMode', 'list');
    });

    // Restore saved view mode
    const savedView = localStorage.getItem('viewMode');
    if (savedView === 'list') {
      documentGrid.classList.add('list-view');
      listViewBtn.classList.add('active');
      gridViewBtn.classList.remove('active');
    }
  }

  // Extracted text panel toggle
  document.getElementById('toggleExtractedText')?.addEventListener('click', () => {
    const panel = document.getElementById('extractedTextPanel');
    if (panel) {
      panel.classList.toggle('hidden');
    }
  });

  document.getElementById('closeExtractedText')?.addEventListener('click', () => {
    const panel = document.getElementById('extractedTextPanel');
    if (panel) {
      panel.classList.add('hidden');
    }
  });
});

// HIPAA Compliance: Clear PDF cache when user navigates away or closes tab
window.addEventListener('beforeunload', () => {
  clearPdfCache();
});

// HIPAA Compliance: Clear PDF cache when page visibility changes (tab switch, minimize)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // User switched away from this tab - could be security concern
    // We don't clear cache here to allow tab switching, but we log it
    console.log('⚠️ Page hidden - PDF cache remains in memory');
  }
});

// ==========================================
// PDF CACHE MANAGEMENT (HIPAA-Compliant)
// ==========================================

/**
 * Load PDF preview with in-memory caching
 * HIPAA-Compliant: Caches in RAM only, never persisted to disk
 * @param {string} taskId - The task ID
 * @returns {Promise<string>} Blob URL for the PDF
 */
async function loadPdfPreview(taskId) {
  console.log(`📄 Loading PDF for task ${taskId}`);

  // Check if already cached in memory
  if (pdfCache.has(taskId)) {
    const cached = pdfCache.get(taskId);
    console.log(`✓ Using cached PDF (cached ${Math.round((Date.now() - cached.timestamp) / 1000)}s ago)`);
    return cached.blobUrl;
  }

  try {
    // Fetch from backend (HIPAA-compliant proxied download)
    // Backend validates session and logs access in audit trail
    const response = await fetch(`${API_URL}/api/tasks/${taskId}/download`, {
      method: 'GET',
      credentials: 'include', // Include session cookie
      headers: {
        'x-user-id': USER_ID // Include user ID for authentication
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Session expired. Please log in again.');
      } else if (response.status === 403) {
        throw new Error('Access denied to this document.');
      } else if (response.status === 404) {
        throw new Error('Document not found.');
      }
      throw new Error(`Failed to load PDF: ${response.statusText}`);
    }

    // Convert response to Blob (binary data stored in RAM)
    const blob = await response.blob();

    // Create Blob URL (browser manages this in memory)
    const blobUrl = URL.createObjectURL(blob);

    // Cache in memory for this session
    pdfCache.set(taskId, {
      blobUrl,
      timestamp: Date.now()
    });

    console.log(`✓ PDF loaded and cached in memory (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);

    return blobUrl;
  } catch (error) {
    console.error('❌ Failed to load PDF:', error);
    throw error;
  }
}

/**
 * Clear all cached PDFs from memory
 * HIPAA-Compliant: Called on logout, session end, or navigation away
 * Ensures no PHI remains in browser memory
 */
function clearPdfCache() {
  if (pdfCache.size === 0) {
    console.log('📄 PDF cache already empty');
    return;
  }

  console.log(`📄 Clearing ${pdfCache.size} cached PDF(s) from memory`);

  // Revoke all blob URLs to free memory
  for (const [taskId, cached] of pdfCache.entries()) {
    URL.revokeObjectURL(cached.blobUrl);
    console.log(`  ✓ Cleared cache for task ${taskId}`);
  }

  // Clear the cache Map
  pdfCache.clear();

  console.log('✓ PDF cache cleared (HIPAA compliance)');
}

/**
 * Clear a specific PDF from cache
 * @param {string} taskId - The task ID to remove from cache
 */
function clearSinglePdfFromCache(taskId) {
  if (pdfCache.has(taskId)) {
    const cached = pdfCache.get(taskId);
    URL.revokeObjectURL(cached.blobUrl);
    pdfCache.delete(taskId);
    console.log(`✓ Cleared cache for task ${taskId}`);
  }
}

// ==========================================
// VIEW MANAGEMENT
// ==========================================

function showDashboard() {
  // End session before navigating
  endEditSession();

  document.getElementById('dashboardView').classList.add('active');
  document.getElementById('viewerView').classList.remove('active');
  currentTask = null;

  // Restore folders list view without resetting selection
  const headerTitle = document.getElementById('foldersHeaderTitle');
  const backBtn = document.getElementById('backToFoldersBtn');

  if (headerTitle) {
    headerTitle.textContent = 'Folders';
    headerTitle.style.textTransform = 'uppercase';
  }

  if (backBtn) {
    backBtn.style.display = 'none';
  }

  // Re-render folders list (preserves currentFolderId)
  renderFolders();
  updateFolderCounts();

  loadTasks(); // Refresh the list
}

async function showViewer(task) {
  currentTask = task;

  // Switch views
  document.getElementById('dashboardView').classList.remove('active');
  document.getElementById('viewerView').classList.add('active');

  // Update document info
  document.getElementById('docTitle').textContent = task.filename;
  document.getElementById('docSize').textContent = formatFileSize(task.file_size || 0);
  document.getElementById('docDate').textContent = formatDate(task.created_at);

  // Show appropriate status card
  if (task.status === 'completed') {
    showResultsCard(task);

    // Load UNTXT preview by default (processed HTML)
    // Original PDF will be loaded on-demand when user clicks "Original" button
    loadDocumentPreview(task.id);
  } else if (task.status === 'failed') {
    showErrorCard(task);
  } else {
    showProcessingCard(task);
  }

  // Update folders sidebar to show documents in same folder
  showFolderDocumentsListInViewer(task.folder_id);

  // Scroll to top
  window.scrollTo(0, 0);
}

function showProcessingCard(task) {
  document.getElementById('processingStatus').style.display = 'block';
  document.getElementById('resultsCard').style.display = 'none';
  document.getElementById('errorCard').style.display = 'none';

  // Update progress and status message
  updateProcessingStatus(task.status);
}

function showResultsCard(task) {
  document.getElementById('processingStatus').style.display = 'none';
  document.getElementById('resultsCard').style.display = 'block';
  document.getElementById('errorCard').style.display = 'none';

  // Update stats
  document.getElementById('charCount').textContent = formatNumber(task.character_count || 0);
  document.getElementById('wordCount').textContent = formatNumber(task.word_count || 0);
  document.getElementById('confidence').textContent = task.confidence_score
    ? `${(task.confidence_score * 100).toFixed(1)}%`
    : 'N/A';

  // Set toggle buttons to UNTXT view by default
  const toggleUntxt = document.getElementById('toggleUntxt');
  const toggleOriginal = document.getElementById('toggleOriginal');
  if (toggleUntxt && toggleOriginal) {
    toggleUntxt.classList.add('active');
    toggleOriginal.classList.remove('active');
  }

  // Load text preview
  loadTextPreview(task.id);

  // Load document preview (HTML) - UNTXT view by default
  loadDocumentPreview(task.id);
}

function showErrorCard(task) {
  document.getElementById('processingStatus').style.display = 'none';
  document.getElementById('resultsCard').style.display = 'none';
  document.getElementById('errorCard').style.display = 'block';

  const errorMessage = task.error_message || 'An unexpected error occurred during processing.';
  document.getElementById('errorMessage').textContent = errorMessage;
}

function updateProcessingStatus(status) {
  const statusMessage = document.getElementById('statusMessage');
  const progressFill = document.getElementById('progressFill');

  const statusMap = {
    'queued': { message: 'Waiting in queue...', progress: 10 },
    'pending': { message: 'Preparing document...', progress: 20 },
    'processing': { message: 'Extracting text from document...', progress: 60 }
  };

  const info = statusMap[status] || statusMap['queued'];
  statusMessage.textContent = info.message;
  progressFill.style.width = `${info.progress}%`;
}

// ==========================================
// FILES LIST RENDERING
// ==========================================

// Helper to render profile dropdown for file list cells
function renderProfileDropdown(fileName, type, profiles, selectedProfile) {
  const defaultLabel = type === 'kvp' ? 'Extract All' : 'Anonymize All';
  const displayName = selectedProfile || defaultLabel;
  const dropdownId = `profile-${type}-${fileName.replace(/[^a-z0-9]/gi, '-')}`;

  return `
    <div class="file-profile-cell">
      <button class="file-profile-dropdown" data-file="${fileName}" data-type="${type}" id="${dropdownId}">
        <span class="file-profile-text">${displayName}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>
      <div class="file-profile-menu" data-file="${fileName}" data-type="${type}">
        <button class="file-profile-option${!selectedProfile ? ' selected' : ''}" data-value="">${defaultLabel}</button>
        ${profiles.map(p => `
          <button class="file-profile-option${selectedProfile === p.name ? ' selected' : ''}" data-value="${p.name}">${p.name}</button>
        `).join('')}
      </div>
    </div>
  `;
}

// File data and sorting state
let filesData = [
  { name: 'Annual Report 2024.pdf', size: '2.4 MB', pages: 42, date: 'Jan 15, 2025', status: 'Completed' },
  { name: 'Invoice_March.pdf', size: '156 KB', pages: 1, date: 'Jan 14, 2025', status: 'Processing', progress: 67, eta: '30 sec' },
  { name: 'Meeting Notes.pdf', size: '890 KB', pages: 8, date: 'Jan 12, 2025', status: 'Completed' },
  { name: 'Contract_Final.pdf', size: '1.2 MB', pages: 15, date: 'Jan 10, 2025', status: 'Completed' },
  { name: 'Presentation Slides.pdf', size: '5.8 MB', pages: 67, date: 'Jan 8, 2025', status: 'Completed' }
];

let sortState = { column: null, direction: 'asc' };

function sortFiles(column) {
  // Toggle direction if same column
  if (sortState.column === column) {
    sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
  } else {
    sortState.column = column;
    sortState.direction = 'asc';
  }

  filesData.sort((a, b) => {
    let valA, valB;

    if (column === 'name') {
      valA = a.name.toLowerCase();
      valB = b.name.toLowerCase();
    } else if (column === 'date') {
      valA = new Date(a.date);
      valB = new Date(b.date);
    } else if (column === 'pages') {
      valA = a.pages;
      valB = b.pages;
    } else if (column === 'status') {
      valA = a.status.toLowerCase();
      valB = b.status.toLowerCase();
    }

    if (valA < valB) return sortState.direction === 'asc' ? -1 : 1;
    if (valA > valB) return sortState.direction === 'asc' ? 1 : -1;
    return 0;
  });

  renderFilesList();
}

function renderFilesList() {
  const grid = document.getElementById('documentGrid');

  // Use the sortable filesData
  const mockFiles = filesData;

  // Get available profiles
  const kvpProfiles = getPresets();
  const anonProfiles = getAnonProfiles();

  grid.innerHTML = `
    <div class="files-list-container">
      <table class="files-table">
        <thead>
          <tr>
            <th class="checkbox-col">
              <input type="checkbox" id="selectAllFiles" class="file-checkbox">
            </th>
            <th class="sortable col-name" data-sort="name">
              Name
              <svg class="sort-icon ${sortState.column === 'name' ? 'active' : ''}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                ${sortState.column === 'name' && sortState.direction === 'desc'
                  ? '<path d="M12 5v14M5 12l7 7 7-7"/>'
                  : '<path d="M12 19V5M5 12l7-7 7 7"/>'}
              </svg>
            </th>
            <th class="sortable col-date-uploaded" data-sort="date">
              Date Uploaded
              <svg class="sort-icon ${sortState.column === 'date' ? 'active' : ''}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                ${sortState.column === 'date' && sortState.direction === 'desc'
                  ? '<path d="M12 5v14M5 12l7 7 7-7"/>'
                  : '<path d="M12 19V5M5 12l7-7 7 7"/>'}
              </svg>
            </th>
            <th class="sortable col-pages" data-sort="pages"># Pages</th>
            <th class="sortable col-status" data-sort="status">Status</th>
            <th class="col-review">Review</th>
            <th class="col-menu"></th>
          </tr>
        </thead>
        <tbody>
          ${mockFiles.map(file => {
            const isCompleted = file.status === 'Completed';
            const isProcessing = file.status === 'Processing';

            // Render status cell differently for processing files
            let statusCell;
            if (isProcessing) {
              statusCell = `
                <div class="progress-info">
                  <div class="progress-percentage">${file.progress}%</div>
                  <div class="progress-bar">
                    <div class="progress-bar-fill" style="width: ${file.progress}%"></div>
                  </div>
                  <div class="progress-eta">${file.eta} remaining</div>
                </div>
              `;
            } else {
              statusCell = `<span class="status-badge status-${file.status.toLowerCase()}">${file.status}</span>`;
            }

            return `
              <tr class="file-row" data-file="${file.name}">
                <td class="checkbox-col">
                  <input type="checkbox" class="file-checkbox" data-file-name="${file.name}"${isProcessing ? ' disabled' : ''}>
                </td>
                <td class="file-name">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                  </svg>
                  ${file.name}
                </td>
                <td class="file-date-uploaded">${file.date}</td>
                <td class="file-pages">${file.pages}</td>
                <td class="file-status">
                  ${statusCell}
                </td>
                <td class="file-review">
                  <button class="review-btn" data-file="${file.name}"${isCompleted ? '' : ' disabled'}>Review</button>
                </td>
                <td class="file-menu-cell">
                  <button class="file-menu-btn" data-file="${file.name}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="12" cy="12" r="2"></circle>
                      <circle cx="5" cy="12" r="2"></circle>
                      <circle cx="19" cy="12" r="2"></circle>
                    </svg>
                  </button>
                  <div class="file-context-menu" data-file="${file.name}">
                    <button class="context-menu-item" data-action="rename">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                      </svg>
                      <span>Rename</span>
                    </button>
                    <button class="context-menu-item" data-action="download-original">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                      </svg>
                      <span>Download original</span>
                    </button>
                    <button class="context-menu-item context-menu-item-danger" data-action="delete">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                      </svg>
                      <span>Delete</span>
                    </button>
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>

    <!-- Bulk Action Bar -->
    <div class="bulk-action-bar" id="bulkActionBar">
      <div class="selection-info">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 11 12 14 22 4"></polyline>
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
        </svg>
        <span><span class="selection-count" id="bulkSelectionCount">0</span> files selected</span>
      </div>
      <div class="bar-actions">
        <div class="bar-toggles">
          <label class="bar-toggle">
            <input type="checkbox" id="downloadKvp" checked />
            <span class="bar-toggle-slider"></span>
            <span class="bar-toggle-label">Key-Value Pairs</span>
          </label>
          <label class="bar-toggle">
            <input type="checkbox" id="downloadAnon" />
            <span class="bar-toggle-slider"></span>
            <span class="bar-toggle-label">Anonymized Text</span>
          </label>
          <label class="bar-toggle">
            <input type="checkbox" id="downloadPlain" />
            <span class="bar-toggle-slider"></span>
            <span class="bar-toggle-label">Plain Text</span>
          </label>
        </div>
        <button class="bar-btn bar-download-btn" id="bulkDownloadBtn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span>Download</span>
        </button>
      </div>
    </div>
  `;

  // Helper to get selected file names
  function getSelectedFileNames() {
    const checkedBoxes = document.querySelectorAll('.file-checkbox:not(#selectAllFiles):not(:disabled):checked');
    return Array.from(checkedBoxes).map(cb => cb.dataset.fileName);
  }

  // Helper to update selection count display
  function updateSelectionCount() {
    const count = getSelectedFileNames().length;

    // Update bulk action bar count
    const bulkSelectionCount = document.getElementById('bulkSelectionCount');
    if (bulkSelectionCount) {
      bulkSelectionCount.textContent = count;
    }
  }

  // Setup sortable column headers
  const sortableHeaders = document.querySelectorAll('.sortable[data-sort]');
  sortableHeaders.forEach(header => {
    header.addEventListener('click', () => {
      const column = header.dataset.sort;
      sortFiles(column);
    });
  });

  // Setup "Select All" checkbox functionality
  const selectAllCheckbox = document.getElementById('selectAllFiles');
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', (e) => {
      const fileCheckboxes = document.querySelectorAll('.file-checkbox:not(#selectAllFiles):not(:disabled)');
      fileCheckboxes.forEach(checkbox => {
        checkbox.checked = e.target.checked;
      });
      updateSelectionCount();
    });
  }

  // Setup individual checkbox change handlers
  const fileCheckboxes = document.querySelectorAll('.file-checkbox:not(#selectAllFiles)');
  fileCheckboxes.forEach(checkbox => {
    checkbox.addEventListener('change', updateSelectionCount);
  });

  // Setup per-row profile dropdowns
  const profileDropdowns = document.querySelectorAll('.file-profile-dropdown');
  const profileMenus = document.querySelectorAll('.file-profile-menu');

  profileDropdowns.forEach(dropdown => {
    dropdown.addEventListener('click', (e) => {
      e.stopPropagation();
      const fileName = dropdown.dataset.file;
      const type = dropdown.dataset.type;
      const menu = document.querySelector(`.file-profile-menu[data-file="${fileName}"][data-type="${type}"]`);

      // Close all other menus
      closeAllDropdowns();
      menu.classList.toggle('show');
    });
  });

  // Handle per-row profile selection
  profileMenus.forEach(menu => {
    menu.addEventListener('click', (e) => {
      const option = e.target.closest('.file-profile-option');
      if (!option) return;

      e.stopPropagation();
      const fileName = menu.dataset.file;
      const type = menu.dataset.type;
      const value = option.dataset.value;

      // Save the assignment
      setFileProfileAssignment(fileName, type, value || null);

      // Update dropdown display
      const dropdown = document.querySelector(`.file-profile-dropdown[data-file="${fileName}"][data-type="${type}"]`);
      const textSpan = dropdown.querySelector('.file-profile-text');
      const defaultLabel = type === 'kvp' ? 'Extract All' : 'Anonymize All';
      textSpan.textContent = value || defaultLabel;

      // Update selected state
      menu.querySelectorAll('.file-profile-option').forEach(opt => opt.classList.remove('selected'));
      option.classList.add('selected');

      menu.classList.remove('show');
    });
  });

  // Setup header dropdown buttons (bulk actions)
  const headerKvpBtn = document.getElementById('headerKvpDropdown');
  const headerKvpMenu = document.getElementById('headerKvpMenu');
  const headerAnonBtn = document.getElementById('headerAnonDropdown');
  const headerAnonMenu = document.getElementById('headerAnonMenu');
  const headerDownloadBtn = document.getElementById('headerDownloadDropdown');
  const headerDownloadMenu = document.getElementById('headerDownloadMenu');

  // Close all dropdowns helper
  function closeAllDropdowns() {
    headerKvpMenu?.classList.remove('show');
    headerAnonMenu?.classList.remove('show');
    headerDownloadMenu?.classList.remove('show');
    profileMenus.forEach(m => m.classList.remove('show'));
    document.querySelectorAll('.download-dropdown-menu').forEach(m => m.classList.remove('show'));
    // Close bulk action bar dropdowns
    document.querySelectorAll('.bar-dropdown-menu').forEach(m => m.classList.remove('show'));
  }

  // Header KVP dropdown
  headerKvpBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = headerKvpMenu.classList.contains('show');
    closeAllDropdowns();
    if (!wasOpen) headerKvpMenu.classList.add('show');
  });

  // Header ANON dropdown
  headerAnonBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = headerAnonMenu.classList.contains('show');
    closeAllDropdowns();
    if (!wasOpen) headerAnonMenu.classList.add('show');
  });

  // Header Download dropdown
  headerDownloadBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = headerDownloadMenu.classList.contains('show');
    closeAllDropdowns();
    if (!wasOpen) headerDownloadMenu.classList.add('show');
  });

  // Handle header KVP profile apply
  headerKvpMenu?.addEventListener('click', (e) => {
    const item = e.target.closest('.header-dropdown-item');
    if (!item) return;

    const profileName = item.dataset.value || null;
    const selectedFiles = getSelectedFileNames();

    if (selectedFiles.length === 0) {
      alert('Please select files first');
      headerKvpMenu.classList.remove('show');
      return;
    }

    bulkSetFileProfileAssignment(selectedFiles, 'kvp', profileName);

    // Update UI for each selected file
    selectedFiles.forEach(fileName => {
      const textSpan = document.querySelector(`.file-profile-dropdown[data-file="${fileName}"][data-type="kvp"] .file-profile-text`);
      if (textSpan) {
        textSpan.textContent = profileName || 'Extract All';
      }
    });

    headerKvpMenu.classList.remove('show');
  });

  // Handle header ANON profile apply
  headerAnonMenu?.addEventListener('click', (e) => {
    const item = e.target.closest('.header-dropdown-item');
    if (!item) return;

    const profileName = item.dataset.value || null;
    const selectedFiles = getSelectedFileNames();

    if (selectedFiles.length === 0) {
      alert('Please select files first');
      headerAnonMenu.classList.remove('show');
      return;
    }

    bulkSetFileProfileAssignment(selectedFiles, 'anon', profileName);

    // Update UI for each selected file
    selectedFiles.forEach(fileName => {
      const textSpan = document.querySelector(`.file-profile-dropdown[data-file="${fileName}"][data-type="anon"] .file-profile-text`);
      if (textSpan) {
        textSpan.textContent = profileName || 'Anonymize All';
      }
    });

    headerAnonMenu.classList.remove('show');
  });

  // Handle header bulk download
  headerDownloadMenu?.addEventListener('click', (e) => {
    const item = e.target.closest('.header-dropdown-item');
    if (!item) return;

    const format = item.dataset.format;
    const selectedFiles = getSelectedFileNames();

    if (selectedFiles.length === 0) {
      alert('Please select files first');
      headerDownloadMenu.classList.remove('show');
      return;
    }

    downloadSelectedFiles(selectedFiles, format);
    headerDownloadMenu.classList.remove('show');
  });

  // Setup bulk download button
  const bulkDownloadBtn = document.getElementById('bulkDownloadBtn');

  bulkDownloadBtn?.addEventListener('click', () => {
    const selectedFiles = getSelectedFileNames();
    if (selectedFiles.length === 0) return;

    const downloadKvp = document.getElementById('downloadKvp')?.checked;
    const downloadAnon = document.getElementById('downloadAnon')?.checked;
    const downloadPlain = document.getElementById('downloadPlain')?.checked;

    // Build formats array based on toggles
    const formats = [];
    if (downloadKvp) formats.push('kvp');
    if (downloadAnon) formats.push('anon');
    if (downloadPlain) formats.push('txt');

    if (formats.length === 0) {
      alert('Please select at least one download format.');
      return;
    }

    // Download each format
    formats.forEach(format => {
      downloadSelectedFiles(selectedFiles, format);
    });
  });

  // Setup per-row download dropdown
  const downloadDropdownBtns = document.querySelectorAll('.btn-download-icon');
  downloadDropdownBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fileName = btn.dataset.file;
      const menu = document.querySelector(`.download-dropdown-menu[data-file="${fileName}"]`);

      closeAllDropdowns();
      menu?.classList.toggle('show');
    });
  });

  // Handle per-row download format selection
  const downloadMenus = document.querySelectorAll('.download-dropdown-menu');
  downloadMenus.forEach(menu => {
    menu.addEventListener('click', (e) => {
      const item = e.target.closest('.download-dropdown-item');
      if (!item) return;

      e.stopPropagation();
      const fileName = menu.dataset.file;
      const format = item.dataset.format;

      downloadFile(fileName, format);
      menu.classList.remove('show');
    });
  });

  // Close all dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.header-dropdown-wrapper') &&
        !e.target.closest('.file-profile-cell') &&
        !e.target.closest('.download-dropdown-wrapper') &&
        !e.target.closest('.bar-dropdown')) {
      closeAllDropdowns();
    }
  });

  // Setup file context menu functionality
  const menuButtons = document.querySelectorAll('.file-menu-btn');
  const contextMenus = document.querySelectorAll('.file-context-menu');

  menuButtons.forEach(button => {
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      const fileName = button.dataset.file;
      const menu = document.querySelector(`.file-context-menu[data-file="${fileName}"]`);

      // Close all other menus
      contextMenus.forEach(m => {
        if (m !== menu) m.classList.remove('show');
      });

      // Toggle this menu
      menu.classList.toggle('show');
    });
  });

  // Close menus when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.file-menu-cell')) {
      contextMenus.forEach(menu => menu.classList.remove('show'));
    }
  });

  // Handle context menu actions
  const menuItems = document.querySelectorAll('.context-menu-item');
  menuItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = item.dataset.action;
      const fileName = item.closest('.file-context-menu').dataset.file;

      // Close menu
      item.closest('.file-context-menu').classList.remove('show');

      // Handle action
      if (action === 'rename') {
        const newName = prompt('Enter new file name:', fileName);
        if (newName && newName !== fileName) {
          console.log(`Rename: ${fileName} → ${newName}`);
          // TODO: Implement rename API call
        }
      } else if (action === 'download-original') {
        console.log(`Download original: ${fileName}`);
        // TODO: Implement download original API call
      } else if (action === 'delete') {
        if (confirm(`Delete "${fileName}"?`)) {
          console.log(`Delete: ${fileName}`);
          clearFileProfileAssignment(fileName);
          // TODO: Implement delete API call
        }
      }
    });
  });

  // Setup Review button click handlers
  const reviewButtons = document.querySelectorAll('.review-btn');
  reviewButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fileName = btn.dataset.file;
      // Find the file's task ID from filesData (for now, use filename as ID)
      const fileData = filesData.find(f => f.name === fileName);
      const fileId = fileData?.id || fileName;
      showReviewModal(fileId, fileName);
    });
  });
}

// ==========================================
// JSON FIELD SELECTOR & PRESET MANAGEMENT
// ==========================================

function getPresets() {
  const presetsJson = localStorage.getItem('jsonPresets');
  return presetsJson ? JSON.parse(presetsJson) : [];
}

function savePreset(name, fields, sectorIds = [], customFields = []) {
  const presets = getPresets();
  const existingIndex = presets.findIndex(p => p.name === name);

  const presetData = { name, fields, sectorIds, customFields };

  if (existingIndex >= 0) {
    presets[existingIndex] = presetData;
  } else {
    presets.push(presetData);
  }

  localStorage.setItem('jsonPresets', JSON.stringify(presets));
}

function deletePreset(name) {
  const presets = getPresets();
  const filtered = presets.filter(p => p.name !== name);
  localStorage.setItem('jsonPresets', JSON.stringify(filtered));
}

function renamePreset(oldName, newName) {
  const presets = getPresets();
  const preset = presets.find(p => p.name === oldName);
  if (preset) {
    preset.name = newName;
    localStorage.setItem('jsonPresets', JSON.stringify(presets));
  }
}

// ==========================================
// ANON PRESET MANAGEMENT
// ==========================================

function getAnonPresets() {
  try {
    const presetsJson = localStorage.getItem('anonPresets');
    return presetsJson ? JSON.parse(presetsJson) : [];
  } catch (e) {
    console.error('Error loading anon presets:', e);
    return [];
  }
}

function saveAnonPreset(name, categories, entities, customEntities = []) {
  const presets = getAnonPresets();
  const existingIndex = presets.findIndex(p => p.name === name);

  const presetData = { name, categories, entities, customEntities };

  if (existingIndex >= 0) {
    presets[existingIndex] = presetData;
  } else {
    presets.push(presetData);
  }

  localStorage.setItem('anonPresets', JSON.stringify(presets));
}

function deleteAnonPreset(name) {
  const presets = getAnonPresets();
  const filtered = presets.filter(p => p.name !== name);
  localStorage.setItem('anonPresets', JSON.stringify(filtered));
}

function loadPresetsIntoMenu(menu) {
  const presets = getPresets();

  menu.innerHTML = '';

  // Add default "All Fields" option
  const allItem = document.createElement('div');
  allItem.className = 'json-preset-item';
  allItem.dataset.value = '__all__';
  allItem.textContent = 'All Fields';
  menu.appendChild(allItem);

  // Add separator if there are presets
  if (presets.length > 0) {
    const separator = document.createElement('div');
    separator.className = 'json-preset-separator';
    menu.appendChild(separator);
  }

  // Add saved presets with context menu
  presets.forEach(preset => {
    // Wrapper div
    const wrapper = document.createElement('div');
    wrapper.className = 'json-preset-item-wrapper';

    // Clickable preset name
    const item = document.createElement('div');
    item.className = 'json-preset-item';
    item.dataset.value = preset.name;
    item.textContent = preset.name;

    // Three-dots button (horizontal)
    const menuBtn = document.createElement('button');
    menuBtn.className = 'json-preset-menu-btn';
    menuBtn.type = 'button';
    menuBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="5" cy="12" r="2"></circle>
        <circle cx="12" cy="12" r="2"></circle>
        <circle cx="19" cy="12" r="2"></circle>
      </svg>
    `;

    // Context menu
    const contextMenu = document.createElement('div');
    contextMenu.className = 'json-preset-context-menu';
    contextMenu.dataset.preset = preset.name;
    contextMenu.innerHTML = `
      <button class="context-menu-item" data-action="rename" type="button">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
        <span>Rename</span>
      </button>
      <button class="context-menu-item context-menu-item-danger" data-action="delete" type="button">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
        <span>Delete</span>
      </button>
    `;

    // Three-dots button click handler
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Close all other preset context menus
      document.querySelectorAll('.json-preset-context-menu.show').forEach(m => {
        if (m !== contextMenu) m.classList.remove('show');
      });

      // Position context menu using fixed positioning
      if (!contextMenu.classList.contains('show')) {
        const btnRect = menuBtn.getBoundingClientRect();
        contextMenu.style.top = `${btnRect.bottom + 4}px`;
        contextMenu.style.left = `${btnRect.right - 140}px`; // Align right edge with button
      }
      contextMenu.classList.toggle('show');
    });

    // Context menu action handlers
    contextMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const actionBtn = e.target.closest('.context-menu-item');
      if (!actionBtn) return;

      const action = actionBtn.dataset.action;
      const presetName = contextMenu.dataset.preset;
      contextMenu.classList.remove('show');

      if (action === 'rename') {
        const newName = prompt('Enter new preset name:', presetName);
        if (newName && newName.trim() && newName !== presetName) {
          // Check for duplicate names
          const existingPresets = getPresets();
          if (existingPresets.some(p => p.name === newName.trim())) {
            alert('A preset with this name already exists.');
            return;
          }
          renamePreset(presetName, newName.trim());
          loadPresetsIntoMenu(menu);
          // Update dropdown text if this preset was selected
          const presetText = menu.closest('.json-selector-header').querySelector('.json-preset-text');
          if (presetText && presetText.textContent === presetName) {
            presetText.textContent = newName.trim();
          }
        }
      } else if (action === 'delete') {
        if (confirm(`Delete preset "${presetName}"?`)) {
          deletePreset(presetName);
          loadPresetsIntoMenu(menu);
          // Reset dropdown text if this preset was selected
          const presetText = menu.closest('.json-selector-header').querySelector('.json-preset-text');
          if (presetText && presetText.textContent === presetName) {
            presetText.textContent = 'Select Preset...';
          }
        }
      }
    });

    wrapper.appendChild(item);
    wrapper.appendChild(menuBtn);
    wrapper.appendChild(contextMenu);
    menu.appendChild(wrapper);
  });
}

// ANON Profile Functions
function getAnonProfiles() {
  const profilesJson = localStorage.getItem('anonProfiles');
  return profilesJson ? JSON.parse(profilesJson) : [];
}

function saveAnonProfile(name, selectedEntities) {
  const profiles = getAnonProfiles();
  const existingIndex = profiles.findIndex(p => p.name === name);

  // Convert Sets to Arrays for storage
  const profileData = {
    name,
    selectedEntities: {
      names: Array.from(selectedEntities.names),
      emails: Array.from(selectedEntities.emails),
      phones: Array.from(selectedEntities.phones),
      values: Array.from(selectedEntities.values),
      ssn: Array.from(selectedEntities.ssn),
      addresses: Array.from(selectedEntities.addresses)
    }
  };

  if (existingIndex >= 0) {
    profiles[existingIndex] = profileData;
  } else {
    profiles.push(profileData);
  }

  localStorage.setItem('anonProfiles', JSON.stringify(profiles));
}

function deleteAnonProfile(name) {
  const profiles = getAnonProfiles();
  const filtered = profiles.filter(p => p.name !== name);
  localStorage.setItem('anonProfiles', JSON.stringify(filtered));
}

function renameAnonProfile(oldName, newName) {
  const profiles = getAnonProfiles();
  const profile = profiles.find(p => p.name === oldName);
  if (profile) {
    profile.name = newName;
    localStorage.setItem('anonProfiles', JSON.stringify(profiles));
  }
}

// ============================================================
// FILE PROFILE ASSIGNMENTS
// Per-file KVP and ANON profile assignments stored in localStorage
// ============================================================

const FILE_PROFILE_ASSIGNMENTS_KEY = 'fileProfileAssignments';
const DEFAULT_PROFILES_KEY = 'defaultProfiles';

// Get all file profile assignments
function getFileProfileAssignments() {
  const data = localStorage.getItem(FILE_PROFILE_ASSIGNMENTS_KEY);
  return data ? JSON.parse(data) : {};
}

// Save all file profile assignments
function saveFileProfileAssignments(assignments) {
  localStorage.setItem(FILE_PROFILE_ASSIGNMENTS_KEY, JSON.stringify(assignments));
}

// Get profile assignment for a specific file
function getFileProfileAssignment(fileName, type = null) {
  const assignments = getFileProfileAssignments();
  const fileAssignment = assignments[fileName] || { kvpProfile: null, anonProfile: null };
  if (type === 'kvp') return fileAssignment.kvpProfile;
  if (type === 'anon') return fileAssignment.anonProfile;
  return fileAssignment;
}

// Set profile assignment for a specific file
function setFileProfileAssignment(fileName, type, profileName) {
  const assignments = getFileProfileAssignments();
  if (!assignments[fileName]) {
    assignments[fileName] = { kvpProfile: null, anonProfile: null };
  }
  if (type === 'kvp') {
    assignments[fileName].kvpProfile = profileName;
  } else if (type === 'anon') {
    assignments[fileName].anonProfile = profileName;
  }
  saveFileProfileAssignments(assignments);
}

// Clear profile assignments for a file (when file is deleted)
function clearFileProfileAssignment(fileName) {
  const assignments = getFileProfileAssignments();
  delete assignments[fileName];
  saveFileProfileAssignments(assignments);
}

// Bulk set profile for multiple files
function bulkSetFileProfileAssignment(fileNames, type, profileName) {
  const assignments = getFileProfileAssignments();
  fileNames.forEach(fileName => {
    if (!assignments[fileName]) {
      assignments[fileName] = { kvpProfile: null, anonProfile: null };
    }
    if (type === 'kvp') {
      assignments[fileName].kvpProfile = profileName;
    } else if (type === 'anon') {
      assignments[fileName].anonProfile = profileName;
    }
  });
  saveFileProfileAssignments(assignments);
}

// Get default profiles
function getDefaultProfiles() {
  const data = localStorage.getItem(DEFAULT_PROFILES_KEY);
  return data ? JSON.parse(data) : { kvpProfile: null, anonProfile: null };
}

// Get default KVP profile
function getDefaultKvpProfile() {
  return getDefaultProfiles().kvpProfile;
}

// Set default KVP profile
function setDefaultKvpProfile(profileName) {
  const defaults = getDefaultProfiles();
  defaults.kvpProfile = profileName;
  localStorage.setItem(DEFAULT_PROFILES_KEY, JSON.stringify(defaults));
}

// Get default ANON profile
function getDefaultAnonProfile() {
  return getDefaultProfiles().anonProfile;
}

// Set default ANON profile
function setDefaultAnonProfile(profileName) {
  const defaults = getDefaultProfiles();
  defaults.anonProfile = profileName;
  localStorage.setItem(DEFAULT_PROFILES_KEY, JSON.stringify(defaults));
}

// Get effective profile for a file (file-specific or default)
function getEffectiveProfile(fileName, type) {
  const fileProfile = getFileProfileAssignment(fileName, type);
  if (fileProfile) return fileProfile;

  if (type === 'kvp') return getDefaultKvpProfile();
  if (type === 'anon') return getDefaultAnonProfile();
  return null;
}

// Handle profile deletion - clear assignments that reference deleted profile
function handleProfileDeletion(profileName, type) {
  const assignments = getFileProfileAssignments();
  let changed = false;

  Object.keys(assignments).forEach(fileName => {
    if (type === 'kvp' && assignments[fileName].kvpProfile === profileName) {
      assignments[fileName].kvpProfile = null;
      changed = true;
    } else if (type === 'anon' && assignments[fileName].anonProfile === profileName) {
      assignments[fileName].anonProfile = null;
      changed = true;
    }
  });

  if (changed) {
    saveFileProfileAssignments(assignments);
  }

  // Also clear default if it was the deleted profile
  const defaults = getDefaultProfiles();
  if (type === 'kvp' && defaults.kvpProfile === profileName) {
    setDefaultKvpProfile(null);
  } else if (type === 'anon' && defaults.anonProfile === profileName) {
    setDefaultAnonProfile(null);
  }
}

// ============================================================
// DOWNLOAD FUNCTIONS
// Per-file and bulk download with profile-based output generation
// ============================================================

// Format labels for download
const FORMAT_LABELS = {
  kvp: 'KVP (JSON)',
  anon: 'ANON (TXT)',
  txt: 'Plain Text',
  all: 'All Formats'
};

// Download a single file with its assigned profiles applied
function downloadFile(fileName, format = 'all') {
  const assignments = getFileProfileAssignment(fileName);
  const kvpProfile = assignments.kvpProfile || getDefaultKvpProfile();
  const anonProfile = assignments.anonProfile || getDefaultAnonProfile();

  console.log(`Downloading ${fileName} [${format}] with profiles:`, { kvpProfile, anonProfile });

  // In a real implementation, this would:
  // 1. Apply KVP profile to generate structured JSON output
  // 2. Apply ANON profile to generate anonymized text
  // 3. Generate download based on requested format

  const formatLabel = FORMAT_LABELS[format] || format;
  const profileInfo = [];
  if (kvpProfile) profileInfo.push(`KVP: ${kvpProfile}`);
  if (anonProfile) profileInfo.push(`ANON: ${anonProfile}`);

  const profileStr = profileInfo.length > 0 ? profileInfo.join(', ') : 'Default settings';

  alert(`[Mock Download]\n\nFile: ${fileName}\nFormat: ${formatLabel}\nProfiles: ${profileStr}`);
}

// Download multiple selected files
function downloadSelectedFiles(fileNames, format = 'all') {
  if (fileNames.length === 0) return;

  console.log(`Bulk download: ${fileNames.length} files [${format}]`, fileNames);

  const formatLabel = FORMAT_LABELS[format] || format;

  // Show progress indicator or confirmation
  const confirmMessage = fileNames.length > 10
    ? `Download ${fileNames.length} files as ${formatLabel}? This may take a moment.`
    : `Download ${fileNames.length} files as ${formatLabel}?`;

  if (!confirm(confirmMessage)) return;

  // In a real implementation, this would:
  // 1. For each file, apply its assigned profiles
  // 2. Generate outputs for each file in requested format
  // 3. Package into a ZIP archive
  // 4. Trigger download

  const downloadList = fileNames.map(fileName => {
    const assignments = getFileProfileAssignment(fileName);
    const kvp = assignments.kvpProfile || getDefaultKvpProfile() || 'Extract All';
    const anon = assignments.anonProfile || getDefaultAnonProfile() || 'Anonymize All';
    return `  • ${fileName} (KVP: ${kvp}, ANON: ${anon})`;
  }).join('\n');

  alert(`[Mock Bulk Download]\n\nFormat: ${formatLabel}\nFiles:\n${downloadList}\n\nIn production, this would create a ZIP archive.`);
}

// ==========================================
// FORMAT SELECTION MODAL
// ==========================================

let pendingUploadFiles = null;
let isModalOpen = false;

function initFormatModal() {
  const modal = document.getElementById('formatModal');
  const confirmBtn = document.getElementById('formatModalConfirm');
  const cancelBtn = document.getElementById('formatModalCancel');
  const saveDefaultCheckbox = document.getElementById('saveAsDefault');
  const htmlCheckbox = document.getElementById('formatModalHtml');
  const txtCheckbox = document.getElementById('formatModalTxt');
  const jsonCheckbox = document.getElementById('formatModalJson');

  // Load saved preferences from localStorage
  const savedPrefs = localStorage.getItem('defaultFormats');
  if (savedPrefs) {
    try {
      const prefs = JSON.parse(savedPrefs);
      htmlCheckbox.checked = prefs.html !== false;
      txtCheckbox.checked = prefs.txt !== false;
      jsonCheckbox.checked = prefs.json !== false;
    } catch (e) {
      console.error('Error loading format preferences:', e);
    }
  }

  // Handle Cancel button
  cancelBtn.addEventListener('click', () => {
    hideFormatModal();
    pendingUploadFiles = null;
    // Clear file input after a delay to prevent re-triggering
    setTimeout(() => {
      const fileInput = document.getElementById('fileInput');
      if (fileInput) fileInput.value = '';
    }, 100);
  });

  // Handle Continue button
  confirmBtn.addEventListener('click', () => {
    const selectedFormats = {
      html: htmlCheckbox.checked,
      txt: txtCheckbox.checked,
      json: jsonCheckbox.checked
    };

    // Check if at least one format is selected
    if (!selectedFormats.html && !selectedFormats.txt && !selectedFormats.json) {
      alert('Please select at least one output format');
      return;
    }

    // Save as default if checkbox is checked
    if (saveDefaultCheckbox.checked) {
      localStorage.setItem('defaultFormats', JSON.stringify(selectedFormats));
    }

    // Hide modal
    hideFormatModal();

    // Process the upload with selected formats
    if (pendingUploadFiles) {
      processFileUpload(pendingUploadFiles, selectedFormats);
      pendingUploadFiles = null;
    }

    // Clear file input after a delay to prevent re-triggering
    setTimeout(() => {
      const fileInput = document.getElementById('fileInput');
      if (fileInput) fileInput.value = '';
    }, 100);
  });

  // Close modal when clicking outside
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      hideFormatModal();
      pendingUploadFiles = null;
      // Clear file input after a delay to prevent re-triggering
      setTimeout(() => {
        const fileInput = document.getElementById('fileInput');
        if (fileInput) fileInput.value = '';
      }, 100);
    }
  });
}

function showFormatModal(files) {
  // Prevent opening if already open
  if (isModalOpen) {
    return;
  }

  pendingUploadFiles = files;
  const modal = document.getElementById('formatModal');
  modal.classList.add('show');
  isModalOpen = true;
}

function hideFormatModal() {
  const modal = document.getElementById('formatModal');
  modal.classList.remove('show');
  isModalOpen = false;
}

function processFileUpload(files, formats) {
  console.log('Processing upload with formats:', formats);
  console.log('Files:', files);
  // TODO: Implement actual file upload with format selection
  // This will call the existing handleFileUpload or similar function
  // but now it knows which formats to generate
}

// ==========================================
// KVP CONFIGURATION MODAL
// ==========================================

let kvpModalState = {
  files: [],
  selectedFileIndices: new Set(), // Track which files are selected (by index)
  selectedSectors: [],
  selectedFields: new Set(),
  customFields: [],
  // Tab state
  activeTab: 'kvp',
  // Enabled processing steps
  enabledSteps: {
    kvp: true,
    anon: false,
    text: false
  },
  // ANON state
  anon: {
    selectedCategories: [],
    selectedEntities: new Set(),
    customEntities: []
  }
};

// Master ANON entities data
let masterAnonData = null;

function showKvpConfigModal(files) {
  // Prevent opening if already open
  if (document.getElementById('kvpConfigModal').classList.contains('show')) {
    return;
  }

  kvpModalState.files = Array.from(files);
  kvpModalState.selectedFileIndices = new Set(files.length > 0 ? [...Array(files.length).keys()] : []); // Select all by default
  kvpModalState.selectedSectors = [];
  kvpModalState.selectedFields = new Set();
  kvpModalState.customFields = [];
  kvpModalState.activeTab = 'kvp';

  // Reset ANON state
  kvpModalState.anon = {
    selectedCategories: [],
    selectedEntities: new Set(),
    customEntities: []
  };

  // Populate file list
  populateKvpFileList();

  // Initialize tabs
  initModalTabs();

  // Initialize KVP dropdowns and field list
  initKvpSectorDropdown();
  initKvpPresetDropdown();
  initKvpFieldList();
  initKvpCustomFields();

  // Initialize ANON components
  loadAnonEntities().then(() => {
    initAnonCategoryDropdown();
    initAnonPresetDropdown();
    initAnonEntityList();
    initAnonCustomEntities();
  });

  // Update file count in button
  updateKvpFileCount();

  // Update header filename display
  const filenameEl = document.getElementById('kvpFileName');
  const metaEl = document.getElementById('kvpFileMeta');
  if (filenameEl && metaEl) {
    if (kvpModalState.files.length === 1) {
      filenameEl.textContent = kvpModalState.files[0].name;
      metaEl.textContent = '';
    } else if (kvpModalState.files.length > 1) {
      filenameEl.textContent = `${kvpModalState.files.length} files selected`;
      metaEl.textContent = '';
    } else {
      filenameEl.textContent = 'No files selected';
      metaEl.textContent = '';
    }
  }

  // Show modal
  document.getElementById('kvpConfigModal').classList.add('show');
}

function hideKvpConfigModal() {
  document.getElementById('kvpConfigModal').classList.remove('show');
  // Clear file input
  setTimeout(() => {
    const fileInput = document.getElementById('fileInput');
    if (fileInput) fileInput.value = '';
  }, 100);
}

// Truncate filename in the middle, preserving start and extension
function truncateMiddle(filename, maxLength = 28) {
  if (filename.length <= maxLength) return filename;

  const extIndex = filename.lastIndexOf('.');
  const ext = extIndex > 0 ? filename.slice(extIndex) : '';
  const name = extIndex > 0 ? filename.slice(0, extIndex) : filename;

  // Reserve space for extension + ellipsis
  const availableLength = maxLength - ext.length - 3; // 3 for "..."
  if (availableLength < 4) return filename.slice(0, maxLength - 3) + '...';

  const startLength = Math.ceil(availableLength / 2);
  const endLength = Math.floor(availableLength / 2);

  return name.slice(0, startLength) + '...' + name.slice(-endLength) + ext;
}

function populateKvpFileList() {
  const container = document.querySelector('.kvp-file-list-items');
  if (!container) return;

  const fileItems = kvpModalState.files.map((file, index) => {
    const isChecked = kvpModalState.selectedFileIndices.has(index);
    const displayName = truncateMiddle(file.name, 32);
    const needsTooltip = file.name.length > 32;
    return `
    <label class="kvp-file-item">
      <input type="checkbox" data-file-index="${index}" ${isChecked ? 'checked' : ''} />
      <span class="kvp-file-name"${needsTooltip ? ` title="${file.name}"` : ''}>${displayName}</span>
    </label>
  `;
  }).join('');

  container.innerHTML = fileItems;

  // Bind checkbox change events
  container.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const index = parseInt(e.target.dataset.fileIndex);
      if (e.target.checked) {
        kvpModalState.selectedFileIndices.add(index);
      } else {
        kvpModalState.selectedFileIndices.delete(index);
      }
      updateKvpFileCount();
      updateKvpSelectAllState();
    });
  });

  // Bind select all checkbox
  const selectAllCheckbox = document.getElementById('kvpSelectAllFiles');
  if (selectAllCheckbox) {
    // Remove old listener by cloning
    const newCheckbox = selectAllCheckbox.cloneNode(true);
    selectAllCheckbox.parentNode.replaceChild(newCheckbox, selectAllCheckbox);

    newCheckbox.addEventListener('change', (e) => {
      const checkboxes = container.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach(cb => {
        cb.checked = e.target.checked;
        const index = parseInt(cb.dataset.fileIndex);
        if (e.target.checked) {
          kvpModalState.selectedFileIndices.add(index);
        } else {
          kvpModalState.selectedFileIndices.delete(index);
        }
      });
      updateKvpFileCount();
    });
    updateKvpSelectAllState();
  }
}

function updateKvpSelectAllState() {
  const selectAllCheckbox = document.getElementById('kvpSelectAllFiles');
  if (!selectAllCheckbox) return;

  const totalFiles = kvpModalState.files.length;
  const selectedFiles = kvpModalState.selectedFileIndices.size;

  selectAllCheckbox.checked = totalFiles > 0 && selectedFiles === totalFiles;
  selectAllCheckbox.indeterminate = selectedFiles > 0 && selectedFiles < totalFiles;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function updateKvpFileCount() {
  const selectedCount = kvpModalState.selectedFileIndices.size;

  // Update sidebar header count
  const countSpan = document.querySelector('.kvp-file-count');
  if (countSpan) {
    countSpan.textContent = selectedCount;
  }

  // Update button count
  const btnCountSpan = document.querySelector('.kvp-file-count-btn');
  if (btnCountSpan) {
    btnCountSpan.textContent = selectedCount;
  }
}

let kvpSectorDropdownInitialized = false;
function initKvpSectorDropdown() {
  const dropdown = document.querySelector('.kvp-sector-dropdown');
  const menu = document.querySelector('.kvp-sector-menu');
  const list = document.querySelector('.kvp-sector-list');
  const searchInput = document.querySelector('.kvp-sector-search');
  const selectedContainer = document.querySelector('.kvp-selected-sectors');

  if (!dropdown || !menu || !list) return;
  if (kvpSectorDropdownInitialized) return;
  kvpSectorDropdownInitialized = true;

  // Populate sector list
  const sectors = getSectorList();

  function renderSectorList(filter = '') {
    const filtered = filter
      ? sectors.filter(s => s.name.toLowerCase().includes(filter.toLowerCase()))
      : sectors;

    list.innerHTML = filtered.map(sector => `
      <div class="kvp-sector-item" data-sector-id="${sector.id}">
        <span class="kvp-sector-name">${sector.name}</span>
        <span class="kvp-sector-count">${sector.count} fields</span>
      </div>
    `).join('');

    // Add click handlers
    list.querySelectorAll('.kvp-sector-item').forEach(item => {
      item.addEventListener('click', () => {
        const sectorId = item.dataset.sectorId;
        const sectorName = item.querySelector('.kvp-sector-name').textContent;
        addSelectedSector(sectorId, sectorName);
        menu.style.display = 'none';
        searchInput.value = '';
        renderSectorList();
      });
    });
  }

  // Toggle dropdown
  dropdown.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = menu.style.display !== 'none';
    menu.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
      searchInput.focus();
      renderSectorList();
    }
  });

  // Search filter
  searchInput.addEventListener('input', (e) => {
    renderSectorList(e.target.value);
  });

  // Click outside to close
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.kvp-sector-dropdown-wrapper')) {
      menu.style.display = 'none';
    }
  });

  // Clear and render
  selectedContainer.innerHTML = '';
  renderSectorList();

  function addSelectedSector(sectorId, sectorName) {
    // Prevent duplicates
    if (kvpModalState.selectedSectors.includes(sectorId)) return;

    kvpModalState.selectedSectors.push(sectorId);

    // Add chip
    const chip = document.createElement('div');
    chip.className = 'kvp-sector-chip';
    chip.dataset.sectorId = sectorId;
    chip.innerHTML = `
      <span>${sectorName}</span>
      <button class="kvp-sector-remove" type="button">&times;</button>
    `;

    chip.querySelector('.kvp-sector-remove').addEventListener('click', () => {
      kvpModalState.selectedSectors = kvpModalState.selectedSectors.filter(id => id !== sectorId);
      chip.remove();
      updateKvpFieldsFromSectors();
      updateDropdownText();
    });

    selectedContainer.appendChild(chip);
    updateKvpFieldsFromSectors();
    updateDropdownText();
  }

  function updateDropdownText() {
    const text = dropdown.querySelector('.kvp-sector-text');
    if (kvpModalState.selectedSectors.length === 0) {
      text.textContent = 'Select sector...';
    } else {
      text.textContent = `${kvpModalState.selectedSectors.length} sector(s) selected`;
    }
  }
}

function updateKvpFieldsFromSectors() {
  const documentFieldsContainer = document.querySelector('.kvp-document-fields .kvp-section-content');
  const sectorContainer = document.querySelector('.kvp-sector-fields-container');
  const selectAllLabel = document.querySelector('.kvp-select-all');
  const fieldDivider = document.querySelector('.kvp-field-divider');

  if (!sectorContainer) return;

  // If no sectors selected, show empty state
  if (kvpModalState.selectedSectors.length === 0) {
    if (documentFieldsContainer) {
      documentFieldsContainer.innerHTML = '<div class="kvp-fields-placeholder">Select a sector or preset to see available fields</div>';
    }
    sectorContainer.innerHTML = '';
    if (selectAllLabel) selectAllLabel.style.display = 'none';
    if (fieldDivider) fieldDivider.style.display = 'none';
    return;
  }

  // Show Select All and divider
  if (selectAllLabel) selectAllLabel.style.display = '';
  if (fieldDivider) fieldDivider.style.display = '';

  // Reset select all to checked
  const selectAll = document.querySelector('.kvp-select-all-checkbox');
  if (selectAll) selectAll.checked = true;

  // Add document fields if not already there
  if (documentFieldsContainer && documentFieldsContainer.querySelector('.kvp-fields-placeholder')) {
    documentFieldsContainer.innerHTML = '';
    const documentFields = ['document_type', 'document_date', 'document_title', 'page_count', 'language'];
    documentFields.forEach(field => {
      const checkbox = createKvpFieldCheckbox(field, 'document');
      documentFieldsContainer.appendChild(checkbox);
    });
  }

  // Clear and rebuild sector fields
  sectorContainer.innerHTML = '';

  kvpModalState.selectedSectors.forEach(sectorId => {
    const sectorData = masterKvpData?.sectors?.[sectorId];
    if (!sectorData) return;

    const section = document.createElement('div');
    section.className = 'kvp-field-section';
    section.innerHTML = `
      <div class="kvp-section-header">
        <span class="kvp-section-title">${sectorData.name}</span>
        <span class="kvp-section-count">${sectorData.kvps?.length || 0}</span>
      </div>
      <div class="kvp-section-content"></div>
    `;

    const content = section.querySelector('.kvp-section-content');
    (sectorData.kvps || []).forEach(kvp => {
      const checkbox = createKvpFieldCheckbox(kvp.key, `sector-${sectorId}`);
      content.appendChild(checkbox);
    });

    sectorContainer.appendChild(section);
  });

  updateSelectAllState();
}

function createKvpFieldCheckbox(fieldName, category = 'document') {
  const label = document.createElement('label');
  label.className = 'kvp-field-checkbox';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = true; // Default to checked
  checkbox.dataset.field = fieldName;
  checkbox.dataset.category = category;

  // Track state
  if (checkbox.checked) {
    kvpModalState.selectedFields.add(fieldName);
  }

  checkbox.addEventListener('change', () => {
    if (checkbox.checked) {
      kvpModalState.selectedFields.add(fieldName);
    } else {
      kvpModalState.selectedFields.delete(fieldName);
    }
    updateSelectAllState();
  });

  const span = document.createElement('span');
  span.textContent = fieldName;

  label.appendChild(checkbox);
  label.appendChild(span);

  return label;
}

function updateSelectAllState() {
  const selectAll = document.querySelector('.kvp-select-all-checkbox');
  if (!selectAll) return;

  const allCheckboxes = document.querySelectorAll('.kvp-field-checkbox input[type="checkbox"]');
  const checkedCount = document.querySelectorAll('.kvp-field-checkbox input[type="checkbox"]:checked').length;

  selectAll.checked = checkedCount === allCheckboxes.length && allCheckboxes.length > 0;
  selectAll.indeterminate = checkedCount > 0 && checkedCount < allCheckboxes.length;
}

function initKvpFieldList() {
  // Start with empty state - fields appear after selecting sector/preset
  const documentFieldsContainer = document.querySelector('.kvp-document-fields .kvp-section-content');
  if (!documentFieldsContainer) return;

  // Clear everything and show placeholder
  documentFieldsContainer.innerHTML = '<div class="kvp-fields-placeholder">Select a sector or preset to see available fields</div>';
  kvpModalState.selectedFields.clear();

  // Clear sector fields
  const sectorContainer = document.querySelector('.kvp-sector-fields-container');
  if (sectorContainer) sectorContainer.innerHTML = '';

  // Hide Select All initially (no fields to select)
  const selectAllLabel = document.querySelector('.kvp-select-all');
  const fieldDivider = document.querySelector('.kvp-field-divider');
  if (selectAllLabel) selectAllLabel.style.display = 'none';
  if (fieldDivider) fieldDivider.style.display = 'none';

  // Set up Select All checkbox event
  const selectAll = document.querySelector('.kvp-select-all-checkbox');
  if (selectAll) {
    selectAll.addEventListener('change', () => {
      const allCheckboxes = document.querySelectorAll('.kvp-field-checkbox input[type="checkbox"]');
      allCheckboxes.forEach(cb => {
        cb.checked = selectAll.checked;
        if (selectAll.checked) {
          kvpModalState.selectedFields.add(cb.dataset.field);
        } else {
          kvpModalState.selectedFields.delete(cb.dataset.field);
        }
      });
    });
  }
}

let kvpPresetDropdownInitialized = false;
function initKvpPresetDropdown() {
  const dropdown = document.querySelector('.kvp-preset-dropdown');
  const menu = document.querySelector('.kvp-preset-menu');

  if (!dropdown || !menu) return;

  // Load presets into menu (always refresh)
  loadKvpPresetsIntoMenu(menu);

  // Only add event listeners once
  if (kvpPresetDropdownInitialized) return;
  kvpPresetDropdownInitialized = true;

  // Toggle dropdown
  dropdown.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = menu.style.display !== 'none';
    menu.style.display = isOpen ? 'none' : 'block';
  });

  // Click outside to close
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.kvp-preset-dropdown-wrapper')) {
      menu.style.display = 'none';
    }
  });
}

function loadKvpPresetsIntoMenu(menu) {
  const presets = getPresets();

  menu.innerHTML = '';

  // Add default "All Fields" option
  const allItem = document.createElement('div');
  allItem.className = 'kvp-preset-item';
  allItem.dataset.value = '__all__';
  allItem.textContent = 'All Fields';
  allItem.addEventListener('click', () => {
    applyKvpPreset(null); // null = all fields
    menu.style.display = 'none';
    document.querySelector('.kvp-preset-text').textContent = 'All Fields';
  });
  menu.appendChild(allItem);

  // Add separator if there are presets
  if (presets.length > 0) {
    const separator = document.createElement('div');
    separator.className = 'kvp-preset-separator';
    menu.appendChild(separator);
  }

  // Add saved presets with context menu
  presets.forEach(preset => {
    // Wrapper div
    const wrapper = document.createElement('div');
    wrapper.className = 'kvp-preset-item-wrapper';

    // Clickable preset name
    const item = document.createElement('div');
    item.className = 'kvp-preset-item';
    item.dataset.value = preset.name;
    item.textContent = preset.name;
    item.addEventListener('click', () => {
      applyKvpPreset(preset);
      menu.style.display = 'none';
      document.querySelector('.kvp-preset-text').textContent = preset.name;
    });

    // Three-dots button (horizontal)
    const menuBtn = document.createElement('button');
    menuBtn.className = 'kvp-preset-menu-btn';
    menuBtn.type = 'button';
    menuBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="5" cy="12" r="2"></circle>
        <circle cx="12" cy="12" r="2"></circle>
        <circle cx="19" cy="12" r="2"></circle>
      </svg>
    `;

    // Context menu
    const contextMenu = document.createElement('div');
    contextMenu.className = 'kvp-preset-context-menu';
    contextMenu.dataset.preset = preset.name;
    contextMenu.innerHTML = `
      <button class="kvp-context-menu-item" data-action="rename" type="button">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
        <span>Rename</span>
      </button>
      <button class="kvp-context-menu-item kvp-context-menu-item-danger" data-action="delete" type="button">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
        <span>Delete</span>
      </button>
    `;

    // Three-dots button click handler
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Close all other preset context menus
      document.querySelectorAll('.kvp-preset-context-menu.show').forEach(m => {
        if (m !== contextMenu) m.classList.remove('show');
      });

      // Position context menu using fixed positioning
      if (!contextMenu.classList.contains('show')) {
        const btnRect = menuBtn.getBoundingClientRect();
        contextMenu.style.position = 'fixed';
        contextMenu.style.top = `${btnRect.bottom + 4}px`;
        contextMenu.style.left = `${btnRect.right - 120}px`;
      }
      contextMenu.classList.toggle('show');
    });

    // Context menu action handlers
    contextMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const actionBtn = e.target.closest('.kvp-context-menu-item');
      if (!actionBtn) return;

      const action = actionBtn.dataset.action;
      const presetName = contextMenu.dataset.preset;
      contextMenu.classList.remove('show');

      if (action === 'rename') {
        const newName = prompt('Enter new preset name:', presetName);
        if (newName && newName.trim() && newName !== presetName) {
          // Check for duplicate names
          const existingPresets = getPresets();
          if (existingPresets.some(p => p.name === newName.trim())) {
            alert('A preset with this name already exists.');
            return;
          }
          renamePreset(presetName, newName.trim());
          loadKvpPresetsIntoMenu(menu);
          // Update dropdown text if this preset was selected
          const presetText = document.querySelector('.kvp-preset-text');
          if (presetText && presetText.textContent === presetName) {
            presetText.textContent = newName.trim();
          }
        }
      } else if (action === 'delete') {
        if (confirm(`Delete preset "${presetName}"?`)) {
          deletePreset(presetName);
          loadKvpPresetsIntoMenu(menu);
          // Reset dropdown text if this preset was selected
          const presetText = document.querySelector('.kvp-preset-text');
          if (presetText && presetText.textContent === presetName) {
            presetText.textContent = 'Select preset...';
          }
        }
      }
    });

    wrapper.appendChild(item);
    wrapper.appendChild(menuBtn);
    wrapper.appendChild(contextMenu);
    menu.appendChild(wrapper);
  });

  // Close context menus when clicking outside
  document.addEventListener('click', () => {
    document.querySelectorAll('.kvp-preset-context-menu.show').forEach(m => {
      m.classList.remove('show');
    });
  });
}

function applyKvpPreset(preset) {
  // Clear current selections
  kvpModalState.selectedSectors = [];
  kvpModalState.selectedFields.clear();

  // Clear sector chips
  document.querySelector('.kvp-selected-sectors').innerHTML = '';

  if (!preset) {
    // "All Fields" - select all checkboxes
    const allCheckboxes = document.querySelectorAll('.kvp-field-checkbox input[type="checkbox"]');
    allCheckboxes.forEach(cb => {
      cb.checked = true;
      kvpModalState.selectedFields.add(cb.dataset.field);
    });
    document.querySelector('.kvp-select-all-checkbox').checked = true;
    return;
  }

  // Apply preset sectors
  if (preset.sectorIds && preset.sectorIds.length > 0) {
    preset.sectorIds.forEach(sectorId => {
      const sector = getSectorList().find(s => s.id === sectorId);
      if (sector) {
        // Add to state and create chip
        kvpModalState.selectedSectors.push(sectorId);
        const chip = document.createElement('div');
        chip.className = 'kvp-sector-chip';
        chip.dataset.sectorId = sectorId;
        chip.innerHTML = `
          <span>${sector.name}</span>
          <button class="kvp-sector-remove" type="button">&times;</button>
        `;
        chip.querySelector('.kvp-sector-remove').addEventListener('click', () => {
          kvpModalState.selectedSectors = kvpModalState.selectedSectors.filter(id => id !== sectorId);
          chip.remove();
          updateKvpFieldsFromSectors();
        });
        document.querySelector('.kvp-selected-sectors').appendChild(chip);
      }
    });
    updateKvpFieldsFromSectors();
  }

  // Apply preset fields
  const allCheckboxes = document.querySelectorAll('.kvp-field-checkbox input[type="checkbox"]');
  allCheckboxes.forEach(cb => {
    const isSelected = preset.fields.includes(cb.dataset.field);
    cb.checked = isSelected;
    if (isSelected) {
      kvpModalState.selectedFields.add(cb.dataset.field);
    }
  });

  // Apply custom fields
  if (preset.customFields && preset.customFields.length > 0) {
    kvpModalState.customFields = [...preset.customFields];
    renderCustomFields();
  }

  updateSelectAllState();
}

function initKvpCustomFields() {
  const input = document.querySelector('.kvp-custom-field-input');
  const addBtn = document.querySelector('.kvp-custom-field-add');

  if (!input || !addBtn) return;

  function addCustomField() {
    const value = input.value.trim();
    if (!value) return;

    // Prevent duplicates
    if (kvpModalState.customFields.includes(value) ||
        kvpModalState.selectedFields.has(value)) {
      input.value = '';
      return;
    }

    kvpModalState.customFields.push(value);
    kvpModalState.selectedFields.add(value);
    input.value = '';
    renderCustomFields();
  }

  addBtn.addEventListener('click', addCustomField);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCustomField();
    }
  });
}

function renderCustomFields() {
  // Find or create custom fields section
  let customSection = document.querySelector('.kvp-custom-fields-section');
  if (!customSection && kvpModalState.customFields.length > 0) {
    const container = document.querySelector('.kvp-sector-fields-container');
    customSection = document.createElement('div');
    customSection.className = 'kvp-field-section kvp-custom-fields-section';
    customSection.innerHTML = `
      <div class="kvp-section-header">
        <span class="kvp-section-title">Custom Fields</span>
        <span class="kvp-section-count">${kvpModalState.customFields.length}</span>
      </div>
      <div class="kvp-section-content"></div>
    `;
    container.appendChild(customSection);
  }

  if (!customSection) return;

  const content = customSection.querySelector('.kvp-section-content');
  content.innerHTML = '';

  kvpModalState.customFields.forEach(field => {
    const label = document.createElement('label');
    label.className = 'kvp-field-checkbox kvp-custom-field';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.dataset.field = field;
    checkbox.dataset.category = 'custom';

    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        kvpModalState.selectedFields.add(field);
      } else {
        kvpModalState.selectedFields.delete(field);
      }
      updateSelectAllState();
    });

    const span = document.createElement('span');
    span.textContent = field;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'kvp-custom-remove';
    removeBtn.innerHTML = '&times;';
    removeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      kvpModalState.customFields = kvpModalState.customFields.filter(f => f !== field);
      kvpModalState.selectedFields.delete(field);
      renderCustomFields();
      updateSelectAllState();
    });

    label.appendChild(checkbox);
    label.appendChild(span);
    label.appendChild(removeBtn);
    content.appendChild(label);
  });

  // Update count
  const countSpan = customSection.querySelector('.kvp-section-count');
  if (countSpan) countSpan.textContent = kvpModalState.customFields.length;

  // Remove section if empty
  if (kvpModalState.customFields.length === 0 && customSection) {
    customSection.remove();
  }
}

function handleKvpProcess() {
  // Get only selected files
  const selectedFiles = kvpModalState.files.filter((_, index) =>
    kvpModalState.selectedFileIndices.has(index)
  );

  if (selectedFiles.length === 0) {
    alert('Please select at least one file to process.');
    return;
  }

  // Validate field/entity selection
  if (kvpModalState.enabledSteps.kvp && kvpModalState.selectedFields.size === 0) {
    alert('Please select at least one field to extract, or disable key-value extraction.');
    return;
  }

  if (kvpModalState.enabledSteps.anon && kvpModalState.anon.selectedEntities.size === 0) {
    alert('Please select at least one entity to detect, or disable anonymization.');
    return;
  }

  const config = {
    files: selectedFiles,
    // KVP extraction config
    kvp: {
      enabled: kvpModalState.enabledSteps.kvp,
      sectors: kvpModalState.selectedSectors,
      fields: Array.from(kvpModalState.selectedFields),
      customFields: kvpModalState.customFields
    },
    // Anonymization config
    anon: {
      enabled: kvpModalState.enabledSteps.anon,
      categories: kvpModalState.anon.selectedCategories,
      entities: Array.from(kvpModalState.anon.selectedEntities),
      customEntities: kvpModalState.anon.customEntities
    },
    // Text extraction
    extractText: {
      enabled: kvpModalState.enabledSteps.text
    }
  };

  console.log('Processing with config:', config);

  hideKvpConfigModal();

  // Process each file with the extraction config
  processFilesWithConfig(config);
}

function processFilesWithConfig(config) {
  // Upload files with extraction configuration
  config.files.forEach(file => {
    // Use existing handleFileUpload but extend it to include config
    handleFileUploadWithConfig(file, {
      kvp: config.kvp,
      anon: config.anon,
      extractText: config.extractText.enabled
    });
  });
}

async function handleFileUploadWithConfig(file, extractionConfig) {
  const circularDropzone = document.getElementById('circularDropzone');
  const btnUploadCircular = document.getElementById('btnUploadCircular');

  // Show uploading state if elements exist
  if (circularDropzone) circularDropzone.classList.add('uploading');
  if (btnUploadCircular) btnUploadCircular.style.display = 'none';

  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('userId', USER_ID);
    formData.append('extractionConfig', JSON.stringify(extractionConfig));

    const response = await fetch(`${API_URL}/api/tasks`, {
      method: 'POST',
      credentials: 'include',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.success) {
      const taskId = data.data.taskId;
      console.log(`✓ File uploaded: ${file.name} → Task ${taskId}`);

      // If a folder is selected, move task to that folder
      if (currentFolderId && currentFolderId !== 'all') {
        await fetch(`${API_URL}/api/folders/${currentFolderId}/tasks/${taskId}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Refresh task list
      loadTasks();
    }
  } catch (error) {
    console.error('Upload failed:', error);
    alert(`Failed to upload ${file.name}: ${error.message}`);
  } finally {
    // Reset uploading state
    if (circularDropzone) circularDropzone.classList.remove('uploading');
    selectedFileForUpload = null;

    // Reset empty state UI
    const uploadText = document.querySelector('.upload-text');
    const uploadSubtext = document.querySelector('.upload-subtext');
    const uploadHint = document.querySelector('.upload-hint');
    const selectedFileName = document.getElementById('selectedFileName');

    if (uploadText) uploadText.style.display = '';
    if (uploadSubtext) uploadSubtext.style.display = '';
    if (uploadHint) uploadHint.style.display = '';
    if (selectedFileName) selectedFileName.style.display = 'none';
  }
}

function showSaveKvpPresetDialog() {
  const input = document.getElementById('kvpPresetNameInput');
  const name = input?.value;

  if (!name || !name.trim()) {
    input?.focus();
    // Brief highlight to show the input needs a value
    input?.classList.add('error');
    setTimeout(() => input?.classList.remove('error'), 1500);
    return;
  }

  // Check for duplicate names
  const existingPresets = getPresets();
  if (existingPresets.some(p => p.name === name.trim())) {
    if (!confirm(`A preset named "${name.trim()}" already exists. Overwrite?`)) {
      return;
    }
  }

  savePreset(
    name.trim(),
    Array.from(kvpModalState.selectedFields),
    kvpModalState.selectedSectors,
    kvpModalState.customFields
  );

  // Clear the input
  if (input) input.value = '';

  // Refresh preset menu
  const menu = document.querySelector('.kvp-preset-menu');
  if (menu) loadKvpPresetsIntoMenu(menu);

  // Update dropdown text
  document.querySelector('.kvp-preset-text').textContent = name.trim();
}

function showSaveAnonPresetDialog() {
  const input = document.getElementById('anonPresetNameInput');
  const name = input?.value;

  if (!name || !name.trim()) {
    input?.focus();
    // Brief highlight to show the input needs a value
    input?.classList.add('error');
    setTimeout(() => input?.classList.remove('error'), 1500);
    return;
  }

  // Check for duplicate names
  const existingPresets = getAnonPresets();
  if (existingPresets.some(p => p.name === name.trim())) {
    if (!confirm(`A preset named "${name.trim()}" already exists. Overwrite?`)) {
      return;
    }
  }

  saveAnonPreset(
    name.trim(),
    kvpModalState.anon.selectedCategories,
    Array.from(kvpModalState.anon.selectedEntities),
    kvpModalState.anon.customEntities
  );

  // Clear the input
  if (input) input.value = '';

  // Refresh preset menu
  loadAnonPresetsIntoMenu();

  // Update dropdown text
  document.querySelector('.anon-preset-text').textContent = name.trim();
}

function initKvpConfigModal() {
  const modal = document.getElementById('kvpConfigModal');
  if (!modal) return;

  // Close button
  document.getElementById('closeKvpConfigModal')?.addEventListener('click', hideKvpConfigModal);

  // Cancel button
  document.getElementById('kvpCancel')?.addEventListener('click', hideKvpConfigModal);

  // Process button
  document.getElementById('kvpProcess')?.addEventListener('click', handleKvpProcess);

  // Save Preset button (KVP)
  document.getElementById('kvpSavePreset')?.addEventListener('click', showSaveKvpPresetDialog);

  // Save Preset button (ANON)
  document.getElementById('anonSavePreset')?.addEventListener('click', showSaveAnonPresetDialog);

  // ESC key to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('show')) {
      hideKvpConfigModal();
    }
  });

  // Initialize draggable divider
  initLayoutDivider();
}

// Initialize draggable divider for resizing sidebar
let layoutDividerInitialized = false;
function initLayoutDivider() {
  const divider = document.querySelector('.kvp-layout-divider');
  const sidebar = document.querySelector('.kvp-layout-sidebar');
  if (!divider || !sidebar) return;
  if (layoutDividerInitialized) return;
  layoutDividerInitialized = true;

  let isDragging = false;
  let startX = 0;
  let startWidth = 0;

  divider.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    divider.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const delta = e.clientX - startX;
    const newWidth = Math.min(Math.max(startWidth + delta, 200), 500);
    sidebar.style.width = newWidth + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      divider.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

// ==========================================
// MODAL TABS
// ==========================================

let modalTabsInitialized = false;
function initModalTabs() {
  // Reset to KVP tab and sync toggle states (always do this)
  syncPanelToggleStates();
  switchToTab('kvp');

  // Only add event listeners once
  if (modalTabsInitialized) return;
  modalTabsInitialized = true;

  const tabs = document.querySelectorAll('.modal-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      switchToTab(tab.dataset.tab);
    });
  });

  // Initialize panel enable toggles
  initPanelEnableToggles();
}

function syncPanelToggleStates() {
  const toggleMap = {
    kvp: document.getElementById('kvpEnabled'),
    anon: document.getElementById('anonEnabled'),
    text: document.getElementById('textEnabled')
  };

  Object.entries(toggleMap).forEach(([panelName, toggle]) => {
    if (!toggle) return;
    const panel = document.querySelector(`.tab-panel[data-panel="${panelName}"]`);
    const content = panel?.querySelector('.panel-content');
    toggle.checked = kvpModalState.enabledSteps[panelName];
    if (content) {
      content.classList.toggle('disabled', !toggle.checked);
    }
  });
}

let panelTogglesInitialized = false;
function initPanelEnableToggles() {
  if (panelTogglesInitialized) return;
  panelTogglesInitialized = true;

  const toggleMap = {
    kvp: document.getElementById('kvpEnabled'),
    anon: document.getElementById('anonEnabled'),
    text: document.getElementById('textEnabled')
  };

  Object.entries(toggleMap).forEach(([panelName, toggle]) => {
    if (!toggle) return;

    const panel = document.querySelector(`.tab-panel[data-panel="${panelName}"]`);
    const content = panel?.querySelector('.panel-content');

    // Handle changes
    toggle.addEventListener('change', () => {
      kvpModalState.enabledSteps[panelName] = toggle.checked;
      if (content) {
        content.classList.toggle('disabled', !toggle.checked);
      }
    });
  });
}

function switchToTab(tabName) {
  const tabs = document.querySelectorAll('.modal-tab');
  const panels = document.querySelectorAll('.tab-panel');

  // Update active tab
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));

  // Update active panel
  panels.forEach(p => p.classList.toggle('active', p.dataset.panel === tabName));

  // Update state
  kvpModalState.activeTab = tabName;
}

// ==========================================
// ANON TAB FUNCTIONALITY
// ==========================================

async function loadAnonEntities() {
  if (masterAnonData) return masterAnonData;

  try {
    const response = await fetch('master_anon_entities.json');
    masterAnonData = await response.json();
    return masterAnonData;
  } catch (error) {
    console.error('Failed to load ANON entities:', error);
    masterAnonData = { categories: {}, presets: {} };
    return masterAnonData;
  }
}

let anonCategoryDropdownInitialized = false;
function initAnonCategoryDropdown() {
  const dropdown = document.querySelector('.anon-category-dropdown');
  const menu = document.querySelector('.anon-category-menu');
  const list = document.querySelector('.anon-category-list');
  const chipsContainer = document.querySelector('.anon-selected-categories');

  if (!dropdown || !menu || !list || !masterAnonData) return;

  // Populate category list (always refresh)
  list.innerHTML = '';
  Object.entries(masterAnonData.categories).forEach(([categoryId, category]) => {
    const item = document.createElement('div');
    item.className = 'anon-category-item';
    item.dataset.categoryId = categoryId;
    item.textContent = category.name;
    item.addEventListener('click', () => selectAnonCategory(categoryId, category.name));
    list.appendChild(item);
  });

  // Only add event listeners once
  if (anonCategoryDropdownInitialized) return;
  anonCategoryDropdownInitialized = true;

  // Toggle dropdown
  dropdown.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = menu.style.display !== 'none';
    menu.style.display = isOpen ? 'none' : 'block';
    dropdown.classList.toggle('open', !isOpen);
  });

  // Close on outside click
  document.addEventListener('click', () => {
    menu.style.display = 'none';
    dropdown.classList.remove('open');
  });

  menu.addEventListener('click', (e) => e.stopPropagation());
}

function selectAnonCategory(categoryId, categoryName) {
  if (kvpModalState.anon.selectedCategories.includes(categoryId)) return;

  kvpModalState.anon.selectedCategories.push(categoryId);

  // Add chip
  const chipsContainer = document.querySelector('.anon-selected-categories');
  const chip = document.createElement('div');
  chip.className = 'anon-category-chip';
  chip.dataset.categoryId = categoryId;
  chip.innerHTML = `
    <span>${categoryName}</span>
    <button type="button">&times;</button>
  `;

  chip.querySelector('button').addEventListener('click', () => {
    kvpModalState.anon.selectedCategories = kvpModalState.anon.selectedCategories.filter(id => id !== categoryId);
    chip.remove();
    updateAnonEntitiesFromCategories();
    updateAnonCategoryDropdownText();
  });

  chipsContainer.appendChild(chip);
  updateAnonEntitiesFromCategories();
  updateAnonCategoryDropdownText();

  // Close menu
  document.querySelector('.anon-category-menu').style.display = 'none';
  document.querySelector('.anon-category-dropdown').classList.remove('open');
}

function updateAnonCategoryDropdownText() {
  const text = document.querySelector('.anon-category-text');
  if (!text) return;

  if (kvpModalState.anon.selectedCategories.length === 0) {
    text.textContent = 'Select category...';
  } else {
    text.textContent = `${kvpModalState.anon.selectedCategories.length} category(s) selected`;
  }
}

function updateAnonEntitiesFromCategories() {
  const container = document.querySelector('.anon-category-entities-container');
  const selectAllLabel = document.querySelector('.anon-select-all');
  const divider = document.querySelector('.anon-entity-divider');

  if (!container || !masterAnonData) return;

  // If no categories selected, show placeholder
  if (kvpModalState.anon.selectedCategories.length === 0) {
    container.innerHTML = '<div class="anon-entities-placeholder">Select a category to see available entities</div>';
    if (selectAllLabel) selectAllLabel.style.display = 'none';
    if (divider) divider.style.display = 'none';
    return;
  }

  if (selectAllLabel) selectAllLabel.style.display = 'flex';
  if (divider) divider.style.display = 'block';

  container.innerHTML = '';

  // Build entity sections for each selected category
  kvpModalState.anon.selectedCategories.forEach(categoryId => {
    const categoryData = masterAnonData.categories[categoryId];
    if (!categoryData) return;

    const section = document.createElement('div');
    section.className = 'anon-entity-section';
    section.innerHTML = `
      <div class="anon-entity-section-header">
        <span>${categoryData.name}</span>
        <span class="anon-entity-section-count">${categoryData.entities.length}</span>
      </div>
      <div class="anon-entity-section-content"></div>
    `;

    const content = section.querySelector('.anon-entity-section-content');

    categoryData.entities.forEach(entity => {
      const checkbox = createAnonEntityCheckbox(entity.key, categoryId);
      content.appendChild(checkbox);
    });

    container.appendChild(section);
  });

  updateAnonSelectAllState();
}

function createAnonEntityCheckbox(entityKey, categoryId) {
  const label = document.createElement('label');
  label.className = 'anon-entity-checkbox';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.dataset.entity = entityKey;
  checkbox.dataset.category = categoryId;

  // Check if already selected
  if (kvpModalState.anon.selectedEntities.has(entityKey)) {
    checkbox.checked = true;
  } else {
    // Auto-select by default
    checkbox.checked = true;
    kvpModalState.anon.selectedEntities.add(entityKey);
  }

  checkbox.addEventListener('change', () => {
    if (checkbox.checked) {
      kvpModalState.anon.selectedEntities.add(entityKey);
    } else {
      kvpModalState.anon.selectedEntities.delete(entityKey);
    }
    updateAnonSelectAllState();
  });

  const span = document.createElement('span');
  span.textContent = entityKey.replace(/_/g, ' ');

  label.appendChild(checkbox);
  label.appendChild(span);

  return label;
}

function updateAnonSelectAllState() {
  const selectAllCheckbox = document.querySelector('.anon-select-all-checkbox');
  if (!selectAllCheckbox) return;

  const allCheckboxes = document.querySelectorAll('.anon-entity-checkbox input');
  const checkedCount = document.querySelectorAll('.anon-entity-checkbox input:checked').length;

  selectAllCheckbox.checked = allCheckboxes.length > 0 && checkedCount === allCheckboxes.length;
  selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < allCheckboxes.length;
}

function initAnonEntityList() {
  const container = document.querySelector('.anon-category-entities-container');
  const selectAllCheckbox = document.querySelector('.anon-select-all-checkbox');

  if (container) {
    container.innerHTML = '<div class="anon-entities-placeholder">Select a category to see available entities</div>';
  }

  // Hide select all initially
  const selectAllLabel = document.querySelector('.anon-select-all');
  const divider = document.querySelector('.anon-entity-divider');
  if (selectAllLabel) selectAllLabel.style.display = 'none';
  if (divider) divider.style.display = 'none';

  // Select all toggle
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', () => {
      const allCheckboxes = document.querySelectorAll('.anon-entity-checkbox input');
      allCheckboxes.forEach(cb => {
        cb.checked = selectAllCheckbox.checked;
        if (selectAllCheckbox.checked) {
          kvpModalState.anon.selectedEntities.add(cb.dataset.entity);
        } else {
          kvpModalState.anon.selectedEntities.delete(cb.dataset.entity);
        }
      });
    });
  }
}

function loadAnonPresetsIntoMenu() {
  const menu = document.querySelector('.anon-preset-menu');
  if (!menu || !masterAnonData) return;

  menu.innerHTML = '';

  // Add presets from master data (built-in)
  Object.entries(masterAnonData.presets).forEach(([presetId, preset]) => {
    const item = document.createElement('div');
    item.className = 'anon-preset-item';
    item.dataset.presetId = presetId;
    item.textContent = preset.name;
    item.addEventListener('click', () => applyAnonPreset(preset));
    menu.appendChild(item);
  });

  // Add saved presets
  const savedPresets = getAnonPresets();
  if (savedPresets.length > 0) {
    // Add separator
    const separator = document.createElement('div');
    separator.className = 'anon-preset-separator';
    menu.appendChild(separator);

    savedPresets.forEach(preset => {
      const item = document.createElement('div');
      item.className = 'anon-preset-item saved-preset';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'preset-name';
      nameSpan.textContent = preset.name;

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'preset-delete';
      deleteBtn.title = 'Delete preset';
      deleteBtn.innerHTML = '&times;';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Delete preset "${preset.name}"?`)) {
          deleteAnonPreset(preset.name);
          loadAnonPresetsIntoMenu();
        }
      });

      // Click on item (but not delete button) applies preset
      item.addEventListener('click', (e) => {
        if (!e.target.closest('.preset-delete')) {
          applyAnonPreset(preset, true);
        }
      });

      item.appendChild(nameSpan);
      item.appendChild(deleteBtn);
      menu.appendChild(item);
    });
  }
}

let anonPresetDropdownInitialized = false;
function initAnonPresetDropdown() {
  const dropdown = document.querySelector('.anon-preset-dropdown');
  const menu = document.querySelector('.anon-preset-menu');

  if (!dropdown || !menu || !masterAnonData) return;

  // Populate preset menu (always refresh)
  loadAnonPresetsIntoMenu();

  // Only add event listeners once
  if (anonPresetDropdownInitialized) return;
  anonPresetDropdownInitialized = true;

  // Toggle dropdown
  dropdown.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = menu.style.display !== 'none';
    menu.style.display = isOpen ? 'none' : 'block';
    dropdown.classList.toggle('open', !isOpen);
  });

  // Close on outside click
  document.addEventListener('click', () => {
    menu.style.display = 'none';
    dropdown.classList.remove('open');
  });

  menu.addEventListener('click', (e) => e.stopPropagation());
}

function applyAnonPreset(preset, isSaved = false) {
  if (!preset) return;

  // Clear current selections
  kvpModalState.anon.selectedCategories = [];
  kvpModalState.anon.selectedEntities.clear();
  kvpModalState.anon.customEntities = [];

  // Clear category chips
  document.querySelector('.anon-selected-categories').innerHTML = '';

  // Apply preset categories
  preset.categories.forEach(categoryId => {
    const category = masterAnonData.categories[categoryId];
    if (category) {
      selectAnonCategory(categoryId, category.name);
    }
  });

  // For saved presets, also restore specific entity selections and custom entities
  if (isSaved && preset.entities) {
    // Clear auto-selected entities and apply saved ones
    kvpModalState.anon.selectedEntities.clear();
    preset.entities.forEach(entity => {
      kvpModalState.anon.selectedEntities.add(entity);
    });

    // Restore custom entities
    if (preset.customEntities) {
      kvpModalState.anon.customEntities = [...preset.customEntities];
    }

    // Update checkboxes to match saved state
    setTimeout(() => {
      document.querySelectorAll('.anon-entity-checkbox input').forEach(cb => {
        cb.checked = kvpModalState.anon.selectedEntities.has(cb.dataset.entity);
      });
      renderAnonCustomEntities();
      updateAnonSelectAllState();
    }, 0);
  }

  document.querySelector('.anon-preset-text').textContent = preset.name;

  // Close menu
  document.querySelector('.anon-preset-menu').style.display = 'none';
  document.querySelector('.anon-preset-dropdown').classList.remove('open');
}

function initAnonCustomEntities() {
  const input = document.querySelector('.anon-custom-entity-input');
  const addBtn = document.querySelector('.anon-custom-entity-add');

  if (!input || !addBtn) return;

  function addCustomEntity() {
    const value = input.value.trim().toUpperCase().replace(/\s+/g, '_');
    if (!value) return;

    // Check for duplicates
    if (kvpModalState.anon.customEntities.includes(value) ||
        kvpModalState.anon.selectedEntities.has(value)) {
      input.value = '';
      return;
    }

    kvpModalState.anon.customEntities.push(value);
    kvpModalState.anon.selectedEntities.add(value);
    input.value = '';
    renderAnonCustomEntities();
  }

  addBtn.addEventListener('click', addCustomEntity);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCustomEntity();
    }
  });
}

function renderAnonCustomEntities() {
  let customSection = document.querySelector('.anon-custom-entities-section');
  const container = document.querySelector('.anon-category-entities-container');

  if (!customSection && kvpModalState.anon.customEntities.length > 0) {
    customSection = document.createElement('div');
    customSection.className = 'anon-entity-section anon-custom-entities-section';
    customSection.innerHTML = `
      <div class="anon-entity-section-header">
        <span>Custom Entities</span>
        <span class="anon-entity-section-count">${kvpModalState.anon.customEntities.length}</span>
      </div>
      <div class="anon-entity-section-content"></div>
    `;
    container.appendChild(customSection);
  }

  if (!customSection) return;

  const content = customSection.querySelector('.anon-entity-section-content');
  content.innerHTML = '';

  kvpModalState.anon.customEntities.forEach(entity => {
    const label = document.createElement('label');
    label.className = 'anon-entity-checkbox custom-entity';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = kvpModalState.anon.selectedEntities.has(entity);
    checkbox.dataset.entity = entity;

    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        kvpModalState.anon.selectedEntities.add(entity);
      } else {
        kvpModalState.anon.selectedEntities.delete(entity);
      }
      updateAnonSelectAllState();
    });

    const span = document.createElement('span');
    span.textContent = entity.replace(/_/g, ' ');

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-entity';
    removeBtn.innerHTML = '&times;';
    removeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      kvpModalState.anon.customEntities = kvpModalState.anon.customEntities.filter(e => e !== entity);
      kvpModalState.anon.selectedEntities.delete(entity);
      renderAnonCustomEntities();
      updateAnonSelectAllState();
    });

    label.appendChild(checkbox);
    label.appendChild(span);
    label.appendChild(removeBtn);
    content.appendChild(label);
  });

  // Update count
  const countSpan = customSection.querySelector('.anon-entity-section-count');
  if (countSpan) countSpan.textContent = kvpModalState.anon.customEntities.length;

  // Remove section if empty
  if (kvpModalState.anon.customEntities.length === 0 && customSection) {
    customSection.remove();
  }
}

// ==========================================
// REVIEW MODAL (Post-Processing)
// ==========================================

let reviewModalState = {
  // File being reviewed
  fileId: null,
  fileName: null,

  // Page navigation
  currentPage: 1,
  totalPages: 0,

  // View mode
  activeTab: 'kvp',        // 'kvp' | 'anon' | 'text'
  viewMode: 'extracted',   // 'extracted' | 'original'
  kvpViewMode: 'aggregated', // 'aggregated' | 'perPage'
  aggregatedKvps: [],        // Cached aggregated KVP data
  aggregatedAnon: [],        // Cached aggregated ANON data

  // Processed data (loaded from backend)
  processedData: {
    kvp: [],               // Array of { page, key, value, confidence }
    anon: [],              // Array of { page, entity, original, redacted, visible }
    text: []               // Array of { page, content }
  },

  // Edits tracking (for save/undo)
  edits: {
    kvp: new Map(),        // key -> new value
    anon: new Map(),       // entity index -> visibility toggle
    text: new Map()        // page -> edited content
  },

  // UI state
  hasUnsavedChanges: false,
  errors: [],              // OCR confidence issues, etc.

  // Processing modes that were enabled
  enabledModes: {
    kvp: true,
    anon: false,
    text: false
  }
};

// Mock data for development (replace with API call later)
const mockReviewData = {
  fileName: 'sample-document.pdf',
  totalPages: 5,
  processedModes: ['kvp', 'anon', 'text'],
  pages: [
    {
      pageNumber: 1,
      imageUrl: 'assets/mock-original.png',
      kvp: [
        { key: 'document_type', value: 'Insurance Declaration', confidence: 95 },
        { key: 'policy_number', value: '4382-82-61-23', confidence: 98 },
        { key: 'coverage_period', value: '09-26-23 through 03-26-24', confidence: 92 },
        { key: 'named_insured', value: 'Julia Y Su and Arthur Frankstein', confidence: 89 },
        { key: 'total_premium', value: '$2,353.80', confidence: 97 }
      ],
      anon: [
        { entity: 'NAME', original: 'Julia Y Su', redacted: '[NAME_1]', confidence: 98 },
        { entity: 'NAME', original: 'Arthur Frankstein', redacted: '[NAME_2]', confidence: 95 },
        { entity: 'ADDRESS', original: '1234 Oak Street', redacted: '[ADDRESS]', confidence: 92 },
        { entity: 'CITY', original: 'San Francisco', redacted: '[CITY]', confidence: 99 },
        { entity: 'STATE', original: 'CA', redacted: '[STATE]', confidence: 99 },
        { entity: 'ZIP_CODE', original: '94102', redacted: '[ZIP]', confidence: 97 },
        { entity: 'PHONE_NUMBER', original: '(415) 555-1234', redacted: '[PHONE]', confidence: 94 },
        { entity: 'SSN', original: '123-45-6789', redacted: '[SSN]', confidence: 99 }
      ],
      text: 'PERSONAL AUTO POLICY DECLARATIONS\n\nPolicy Number: 4382-82-61-23\nPolicy Period: September 26, 2023 to March 26, 2024\n\nNamed Insured:\nJulia Y Su\nArthur Frankstein\n1234 Oak Street\nSan Francisco, CA 94102\n\nInsurance Company: Pacific Coast Insurance\nAgent: Bay Area Insurance Services\nPhone: (415) 555-1234'
    },
    {
      pageNumber: 2,
      kvp: [
        { key: 'line_item_1', value: 'Professional Services', confidence: 89 },
        { key: 'amount_1', value: '$800.00', confidence: 94 },
        { key: 'line_item_2', value: 'Consulting Fee', confidence: 85 },
        { key: 'amount_2', value: '$434.56', confidence: 92 }
      ],
      anon: [
        { entity: 'DOB', original: '03/15/1985', redacted: '[DOB]', confidence: 88 },
        { entity: 'HEALTHCARE_NUMBER', original: 'MRN-2024-78542', redacted: '[MRN]', confidence: 91 },
        { entity: 'CONDITION', original: 'Type 2 Diabetes', redacted: '[CONDITION]', confidence: 76 },
        { entity: 'DRUG', original: 'Metformin 500mg', redacted: '[DRUG]', confidence: 82 }
      ],
      text: 'COVERAGE SUMMARY\n\nVehicle 1: 2021 Toyota Camry LE\nVIN: 4T1BF1FK5MU123456\n\nLiability Coverage:\n  Bodily Injury: $100,000 / $300,000\n  Property Damage: $50,000\n\nCollision: $500 Deductible\nComprehensive: $250 Deductible\n\nUninsured Motorist: $100,000 / $300,000\nMedical Payments: $5,000'
    },
    {
      pageNumber: 3,
      kvp: [
        { key: 'payment_terms', value: 'Net 30', confidence: 67 },
        { key: 'due_date', value: '2025-02-14', confidence: 58 }
      ],
      anon: [
        { entity: 'NAME', original: 'Julia Y Su', redacted: '[NAME_1]', confidence: 97 },
        { entity: 'ORGANIZATION', original: 'Blue Shield of California', redacted: '[ORG]', confidence: 94 },
        { entity: 'ORGANIZATION_ID', original: 'TIN: 94-1234567', redacted: '[ORG_ID]', confidence: 89 },
        { entity: 'BANK_ACCOUNT', original: 'XXXX-XXXX-1234', redacted: '[BANK]', confidence: 96 },
        { entity: 'CREDIT_CARD', original: '4111-XXXX-XXXX-1234', redacted: '[CC]', confidence: 58 }
      ],
      text: 'PREMIUM BREAKDOWN\n\nLiability Premium: $456.00\nCollision Premium: $312.00\nComprehensive Premium: $198.00\nUninsured Motorist: $142.00\nMedical Payments: $48.00\n\nSubtotal: $1,156.00\nMulti-Policy Discount: -$115.60\nSafe Driver Discount: -$86.60\n\nTOTAL SEMI-ANNUAL PREMIUM: $953.80\n\nPayment Schedule:\n  Due 09/26/23: $476.90\n  Due 12/26/23: $476.90'
    },
    {
      pageNumber: 4,
      kvp: [
        { key: 'notes', value: 'Thank you for your business', confidence: 82 }
      ],
      anon: [
        { entity: 'EMAIL_ADDRESS', original: 'julia.su@email.com', redacted: '[EMAIL]', confidence: 99 },
        { entity: 'PHONE_NUMBER', original: '(415) 555-1234', redacted: '[PHONE]', confidence: 94 },
        { entity: 'IP_ADDRESS', original: '192.168.1.100', redacted: '[IP]', confidence: 91 }
      ],
      text: 'IMPORTANT NOTICES\n\nThis policy provides the coverage described herein subject to all terms, conditions, and exclusions. Please read your policy carefully.\n\nTo report a claim:\n  Phone: 1-800-555-CLAIM (2524)\n  Online: www.pacificcoastins.com/claims\n  Email: claims@pacificcoastins.com\n\nFor policy questions or changes:\n  Contact your agent: Bay Area Insurance Services\n  Phone: (415) 555-1234\n  Email: julia.su@email.com'
    },
    {
      pageNumber: 5,
      kvp: [],
      anon: [
        { entity: 'NAME', original: 'Dr. Sarah Chen', redacted: '[NAME_3]', confidence: 93 },
        { entity: 'LICENSE_PLATE', original: '7ABC123', redacted: '[PLATE]', confidence: 67 }
      ],
      text: 'POLICYHOLDER ACKNOWLEDGMENT\n\nI acknowledge receipt of this policy declarations page and understand that it summarizes my coverage. I have reviewed the named insured information, vehicle details, and coverage limits and confirm they are accurate.\n\n\nSignature: _______________________\n\nDate: _______________________\n\n\nThank you for choosing Pacific Coast Insurance.'
    }
  ],
  errors: [
    { page: 3, type: 'low_confidence', message: 'OCR confidence below 70%' }
  ]
};

let reviewModalInitialized = false;

function showReviewModal(fileId, fileName) {
  const modal = document.getElementById('reviewModal');
  if (!modal) return;

  // Reset state
  reviewModalState.fileId = fileId;
  reviewModalState.fileName = fileName || 'document.pdf';
  reviewModalState.currentPage = 1;
  reviewModalState.hasUnsavedChanges = false;
  reviewModalState.viewMode = 'extracted';
  reviewModalState.edits = { kvp: new Map(), anon: new Map(), text: new Map() };

  // Load mock data (later: fetch from API)
  loadReviewData(fileId);

  // Initialize modal if not done yet
  if (!reviewModalInitialized) {
    initReviewModal();
    reviewModalInitialized = true;
  }

  // Show modal
  modal.classList.add('show');
  document.body.style.overflow = 'hidden';

  // Hide tabs for modes that weren't processed
  updateReviewTabVisibility();

  // Render initial view
  renderReviewPageThumbnails();
  renderReviewPageContent();
  renderReviewMetadata();
  updateReviewSaveButton();
}

/**
 * Show/hide review modal tabs based on which modes were enabled during processing
 */
function updateReviewTabVisibility() {
  const kvpTab = document.querySelector('#reviewModal [data-tab="kvp"]');
  const anonTab = document.querySelector('#reviewModal [data-tab="anon"]');
  const textTab = document.querySelector('#reviewModal [data-tab="text"]');

  if (kvpTab) kvpTab.style.display = reviewModalState.enabledModes.kvp ? '' : 'none';
  if (anonTab) anonTab.style.display = reviewModalState.enabledModes.anon ? '' : 'none';
  if (textTab) textTab.style.display = reviewModalState.enabledModes.text ? '' : 'none';

  // Default to first enabled tab
  const firstEnabled = reviewModalState.enabledModes.kvp ? 'kvp'
    : reviewModalState.enabledModes.anon ? 'anon'
    : reviewModalState.enabledModes.text ? 'text'
    : 'kvp'; // fallback

  // Set initial tab
  reviewModalState.activeTab = firstEnabled;
  switchReviewTab(firstEnabled);
}

function hideReviewModal() {
  const modal = document.getElementById('reviewModal');
  if (!modal) return;

  // Check for unsaved changes
  if (reviewModalState.hasUnsavedChanges) {
    const confirmed = confirm('You have unsaved changes. Are you sure you want to close?');
    if (!confirmed) return;
  }

  modal.classList.remove('show');
  document.body.style.overflow = '';

  // Reset state
  reviewModalState.fileId = null;
  reviewModalState.fileName = null;
  reviewModalState.processedData = { pages: [], kvp: [], anon: [], text: [] };
  reviewModalState.errors = [];
}

function loadReviewData(fileId) {
  // TODO: Replace with actual API call
  // const response = await fetch(`/api/tasks/${fileId}/review`);
  // const data = await response.json();

  // Use mock data for now
  const data = mockReviewData;

  reviewModalState.totalPages = data.totalPages;
  reviewModalState.processedData = {
    pages: data.pages,
    kvp: data.pages.flatMap(p => p.kvp.map(k => ({ ...k, page: p.pageNumber }))),
    anon: data.pages.flatMap(p => p.anon.map(a => ({ ...a, page: p.pageNumber }))),
    text: data.pages.map(p => ({ page: p.pageNumber, content: p.text }))
  };
  reviewModalState.errors = data.errors || [];

  // Determine which modes were processed
  reviewModalState.enabledModes = {
    kvp: data.processedModes.includes('kvp'),
    anon: data.processedModes.includes('anon'),
    text: data.processedModes.includes('text')
  };

  // Update page count display
  const totalPagesEl = document.getElementById('totalPageNum');
  if (totalPagesEl) totalPagesEl.textContent = reviewModalState.totalPages;

  // Pre-compute aggregated KVPs and ANON data
  aggregateKvps();
  aggregateAnon();

  // Update toggle visibility
  updateKvpToggleVisibility();
}

/**
 * Aggregate KVPs across all pages, grouping by key
 */
function aggregateKvps() {
  const kvpMap = new Map();

  for (const kvp of reviewModalState.processedData.kvp) {
    const key = kvp.key;
    const existing = kvpMap.get(key);

    if (existing) {
      if (existing.value === kvp.value) {
        // Same value: merge, track pages, use max confidence
        existing.pages.push(kvp.page);
        existing.confidence = Math.max(existing.confidence, kvp.confidence);
      } else {
        // Different value: create variant
        const variantKey = `${key}_p${kvp.page}`;
        kvpMap.set(variantKey, {
          key: variantKey,
          displayKey: key,
          value: kvp.value,
          confidence: kvp.confidence,
          pages: [kvp.page],
          isVariant: true
        });
      }
    } else {
      kvpMap.set(key, {
        key,
        displayKey: key,
        value: kvp.value,
        confidence: kvp.confidence,
        pages: [kvp.page],
        isVariant: false
      });
    }
  }

  // Convert to sorted array
  reviewModalState.aggregatedKvps = Array.from(kvpMap.values())
    .sort((a, b) => {
      const pageCompare = Math.min(...a.pages) - Math.min(...b.pages);
      if (pageCompare !== 0) return pageCompare;
      return a.displayKey.localeCompare(b.displayKey);
    });
}

/**
 * Aggregate anonymization entities across all pages
 * Same entity+original: merge, track pages[], use max confidence
 * Same entity, different original: separate rows
 */
function aggregateAnon() {
  const anonMap = new Map();

  for (const item of reviewModalState.processedData.anon) {
    // Create unique key from entity type + original value
    const uniqueKey = `${item.entity}::${item.original}`;
    const existing = anonMap.get(uniqueKey);

    if (existing) {
      // Same entity + same original: merge, track pages, use max confidence
      existing.pages.push(item.page);
      existing.confidence = Math.max(existing.confidence || 0, item.confidence || 0);
    } else {
      anonMap.set(uniqueKey, {
        entity: item.entity,
        original: item.original,
        redacted: item.redacted,
        confidence: item.confidence || 0,
        pages: [item.page]
      });
    }
  }

  // Convert to sorted array (by entity type, then by first page appearance)
  reviewModalState.aggregatedAnon = Array.from(anonMap.values())
    .sort((a, b) => {
      const entityCompare = a.entity.localeCompare(b.entity);
      if (entityCompare !== 0) return entityCompare;
      return Math.min(...a.pages) - Math.min(...b.pages);
    });
}

/**
 * Switch between Aggregated and Per-Page view modes
 */
function switchKvpViewMode(mode) {
  if (mode === reviewModalState.kvpViewMode) return;

  reviewModalState.kvpViewMode = mode;

  // Update toggle button states
  document.querySelectorAll('.kvp-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  // Update page indicator visibility
  const pageIndicator = document.getElementById('reviewKvpPageIndicator');
  if (pageIndicator) {
    pageIndicator.classList.toggle('visible', mode === 'perPage');
    if (mode === 'perPage') {
      document.getElementById('kvpPageNumber').textContent = reviewModalState.currentPage;
    }
  }

  // Re-render content based on active tab
  const activeTab = reviewModalState.activeTab;
  if (activeTab === 'kvp') {
    renderReviewKvpContent(reviewModalState.currentPage);
  } else if (activeTab === 'anon') {
    renderReviewAnonContent(reviewModalState.currentPage);
  } else if (activeTab === 'text') {
    renderReviewTextContent(reviewModalState.currentPage);
  }
}

/**
 * Update toggle visibility based on context
 */
function updateKvpToggleVisibility() {
  const toggle = document.getElementById('reviewKvpModeToggle');
  if (!toggle) return;

  const isSinglePage = reviewModalState.totalPages <= 1;
  const activeTab = reviewModalState.activeTab;
  const isToggleableTab = activeTab === 'kvp' || activeTab === 'anon' || activeTab === 'text';

  // Hide for single-page PDFs
  toggle.classList.toggle('hidden', isSinglePage);

  // Show toggle for all three tabs now
  toggle.classList.toggle('disabled', !isToggleableTab);
}

/**
 * Get confidence class based on percentage
 */
function getConfidenceClass(confidence) {
  if (confidence >= 90) return 'high';
  if (confidence >= 70) return 'medium';
  return 'low';
}

/**
 * Handle KVP input change
 */
function handleKvpInputChange(e) {
  const input = e.target;
  const editKey = input.dataset.editKey;
  const originalValue = input.dataset.original;
  const newValue = input.value;

  if (newValue !== originalValue) {
    reviewModalState.edits.kvp.set(editKey, newValue);
    reviewModalState.hasUnsavedChanges = true;
    input.classList.add('modified');
  } else {
    reviewModalState.edits.kvp.delete(editKey);
    input.classList.remove('modified');
    reviewModalState.hasUnsavedChanges =
      reviewModalState.edits.kvp.size > 0 ||
      reviewModalState.edits.anon.size > 0 ||
      reviewModalState.edits.text.size > 0;
  }
}

/**
 * Trigger re-extraction for current page
 */
function reextractCurrentPage() {
  const page = reviewModalState.currentPage;
  console.log(`Re-extracting page ${page}...`);
  // Trigger existing reprocess flow
  document.getElementById('reviewReprocessBtn')?.click();
}

function initReviewModal() {
  const modal = document.getElementById('reviewModal');
  if (!modal) return;

  // Close button
  document.getElementById('closeReviewModal')?.addEventListener('click', hideReviewModal);

  // Save button
  document.getElementById('reviewSave')?.addEventListener('click', handleReviewSave);

  // Page navigation
  document.getElementById('reviewPrevPage')?.addEventListener('click', () => {
    if (reviewModalState.currentPage > 1) {
      reviewModalState.currentPage--;
      updateReviewPageNavigation();
      renderReviewPageContent();
      highlightCurrentPageThumb();
    }
  });

  document.getElementById('reviewNextPage')?.addEventListener('click', () => {
    if (reviewModalState.currentPage < reviewModalState.totalPages) {
      reviewModalState.currentPage++;
      updateReviewPageNavigation();
      renderReviewPageContent();
      highlightCurrentPageThumb();
    }
  });

  // Keyboard navigation (no Escape close - only close button)
  document.addEventListener('keydown', (e) => {
    if (!modal.classList.contains('show')) return;

    if (e.key === 'ArrowLeft' && !e.target.matches('input, textarea')) {
      document.getElementById('reviewPrevPage')?.click();
    } else if (e.key === 'ArrowRight' && !e.target.matches('input, textarea')) {
      document.getElementById('reviewNextPage')?.click();
    } else if ((e.key === 'k' || e.key === 'K') && !e.target.matches('input, textarea')) {
      toggleReviewPreviewCollapse();
    }
  });

  // Reprocess button
  document.getElementById('reviewReprocessBtn')?.addEventListener('click', toggleReprocessOptions);

  // Tab switching
  document.querySelectorAll('.review-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchReviewTab(tab);
    });
  });

  // KVP Mode Toggle (Aggregated/Per-Page)
  document.querySelectorAll('.kvp-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchKvpViewMode(btn.dataset.mode);
    });
  });

  // Draggable divider
  const divider = document.getElementById('reviewDivider');
  const previewPanel = modal.querySelector('.review-layout-preview');
  if (divider && previewPanel) {
    let isDragging = false;
    let startX = 0;
    let startWidth = 0;

    divider.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.clientX;
      startWidth = previewPanel.offsetWidth;
      divider.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const delta = e.clientX - startX;
      const newWidth = Math.max(250, Math.min(600, startWidth + delta));
      previewPanel.style.width = newWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        divider.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  }
}

function toggleReviewPreviewCollapse() {
  const previewPanel = document.querySelector('.review-layout-preview');
  const divider = document.getElementById('reviewDivider');
  const hint = document.querySelector('.review-collapse-hint');

  if (!previewPanel) return;

  const isCollapsed = previewPanel.classList.toggle('collapsed');

  if (divider) {
    divider.classList.toggle('hidden', isCollapsed);
  }

  // Update hint text
  if (hint) {
    const textSpan = hint.querySelector('.review-collapse-text');
    if (textSpan) {
      textSpan.textContent = isCollapsed ? 'to expand' : 'to collapse';
    }
  }
}

function switchReviewTab(tab) {
  // Update tab buttons
  document.querySelectorAll('.review-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  // Store active tab
  reviewModalState.activeTab = tab;

  // Update toggle visibility (enable for KVP and ANON tabs)
  updateKvpToggleVisibility();

  // Update col 3 header label
  const kvpLabel = document.querySelector('#reviewKvpLabel');
  if (kvpLabel) {
    const labels = { kvp: 'EXTRACTED DATA', anon: 'DETECTED PII', text: 'TEXT CONTENT' };
    kvpLabel.textContent = labels[tab] || 'EXTRACTED DATA';
  }

  // Show page indicator for KVP and ANON tabs when in per-page mode
  const pageIndicator = document.getElementById('reviewKvpPageIndicator');
  if (pageIndicator) {
    const showIndicator = (tab === 'kvp' || tab === 'anon') && reviewModalState.kvpViewMode === 'perPage';
    pageIndicator.classList.toggle('visible', showIndicator);
  }

  // Re-render content for the active tab
  renderReviewPageContent();
}

function renderReviewPageThumbnails() {
  const container = document.querySelector('.review-pages-list');
  if (!container) return;

  container.innerHTML = '';

  for (let i = 1; i <= reviewModalState.totalPages; i++) {
    const hasError = reviewModalState.errors.some(e => e.page === i);

    const thumb = document.createElement('div');
    thumb.className = 'review-page-thumb' + (i === reviewModalState.currentPage ? ' active' : '') + (hasError ? ' has-error' : '');
    thumb.dataset.page = i;

    thumb.innerHTML = `
      <div class="review-page-placeholder">${i}</div>
    `;

    thumb.addEventListener('click', () => {
      reviewModalState.currentPage = i;
      updateReviewPageNavigation();
      renderReviewPageContent();
      highlightCurrentPageThumb();
    });

    container.appendChild(thumb);
  }

  // Update page count in header
  const countEl = document.querySelector('.review-pages-count');
  if (countEl) countEl.textContent = `(${reviewModalState.totalPages})`;
}

function highlightCurrentPageThumb() {
  document.querySelectorAll('.review-page-thumb').forEach(thumb => {
    thumb.classList.toggle('active', parseInt(thumb.dataset.page) === reviewModalState.currentPage);
  });
}

function updateReviewPageNavigation() {
  const currentEl = document.getElementById('currentPageNum');
  const totalEl = document.getElementById('totalPageNum');
  const prevBtn = document.getElementById('reviewPrevPage');
  const nextBtn = document.getElementById('reviewNextPage');

  if (currentEl) currentEl.textContent = reviewModalState.currentPage;
  if (totalEl) totalEl.textContent = reviewModalState.totalPages;
  if (prevBtn) prevBtn.disabled = reviewModalState.currentPage <= 1;
  if (nextBtn) nextBtn.disabled = reviewModalState.currentPage >= reviewModalState.totalPages;
}

function renderReviewPageContent() {
  const page = reviewModalState.currentPage;
  const tab = reviewModalState.activeTab || 'kvp';

  updateReviewPageNavigation();
  renderReviewOriginalPreview(page);

  // Render content based on active tab
  if (tab === 'kvp') {
    renderReviewKvpContent(page);
  } else if (tab === 'anon') {
    renderReviewAnonContent(page);
  } else if (tab === 'text') {
    renderReviewTextContent(page);
  }
}

function renderReviewOriginalPreview(page) {
  const img = document.getElementById('reviewPreviewImage');
  if (!img) return;

  // Get page image URL from mock data (or use placeholder)
  const pageData = reviewModalState.processedData.pages?.find(p => p.pageNumber === page);
  const imageUrl = pageData?.imageUrl || 'https://placehold.co/600x800/f5f5f5/999?text=Page+' + page;
  img.src = imageUrl;
  img.alt = `Original page ${page}`;
}

function renderReviewKvpContent(page) {
  const container = document.querySelector('.review-kvp-list');
  if (!container) return;

  // Check if KVP extraction was enabled
  if (!reviewModalState.enabledModes.kvp) {
    container.innerHTML = `
      <div class="review-not-processed">
        <span class="review-not-processed-icon">ℹ</span>
        <p>Key-value extraction was not selected during processing.</p>
        <p class="review-not-processed-hint">To extract structured data, reprocess with key-value extraction enabled.</p>
      </div>
    `;
    return;
  }

  const isAggregated = reviewModalState.kvpViewMode === 'aggregated';

  // Update page indicator number
  const pageNumEl = document.getElementById('kvpPageNumber');
  if (pageNumEl) pageNumEl.textContent = page;

  let kvpsToRender;

  if (isAggregated) {
    // Ensure aggregated data exists
    if (reviewModalState.aggregatedKvps.length === 0 && reviewModalState.processedData.kvp.length > 0) {
      aggregateKvps();
    }
    kvpsToRender = reviewModalState.aggregatedKvps;
  } else {
    // Per-page: filter to current page only
    kvpsToRender = reviewModalState.processedData.kvp
      .filter(k => k.page === page)
      .map(k => ({
        key: k.key,
        displayKey: k.key,
        value: k.value,
        confidence: k.confidence,
        pages: [k.page]
      }));
  }

  // Handle empty state
  if (kvpsToRender.length === 0) {
    container.innerHTML = isAggregated
      ? '<div class="review-empty-state">No key-value pairs extracted from this document</div>'
      : `<div class="review-kvp-empty">
           <span class="review-kvp-empty-text">No extractions on this page</span>
           <button class="review-kvp-reextract-btn" onclick="reextractCurrentPage()">Re-extract Page</button>
         </div>`;
    return;
  }

  // Apply virtual scroll class if needed
  container.classList.toggle('virtual-scroll', kvpsToRender.length > 50);

  // Render KVP rows (display only)
  container.innerHTML = kvpsToRender.map((kvp, idx) => {
    const pagesLabel = kvp.pages.length > 1 ? `p.${kvp.pages.join(',')}` : `p.${kvp.pages[0]}`;

    return `
      <div class="review-kvp-row" data-key="${escapeHtml(kvp.key)}" data-idx="${idx}">
        <span class="review-kvp-label">${escapeHtml(kvp.displayKey.replace(/_/g, ' '))}</span>
        <span class="review-kvp-value">${escapeHtml(kvp.value)}</span>
        ${isAggregated ? `<span class="review-kvp-pages">${pagesLabel}</span>` : ''}
      </div>
    `;
  }).join('');
}

function renderReviewAnonContent(page) {
  const container = document.querySelector('.review-kvp-list');
  if (!container) return;

  // Check if anonymization was enabled
  if (!reviewModalState.enabledModes.anon) {
    container.innerHTML = `
      <div class="review-not-processed">
        <span class="review-not-processed-icon">ℹ</span>
        <p>Anonymization was not selected during processing.</p>
        <p class="review-not-processed-hint">To detect PII, reprocess with anonymization enabled.</p>
      </div>
    `;
    return;
  }

  const isAggregated = reviewModalState.kvpViewMode === 'aggregated';

  // Update page indicator number
  const pageNumEl = document.getElementById('kvpPageNumber');
  if (pageNumEl) pageNumEl.textContent = page;

  let anonToRender;

  if (isAggregated) {
    // Ensure aggregated data exists
    if (reviewModalState.aggregatedAnon.length === 0 && reviewModalState.processedData.anon.length > 0) {
      aggregateAnon();
    }
    anonToRender = reviewModalState.aggregatedAnon;
  } else {
    // Per-page mode: filter by current page
    anonToRender = reviewModalState.processedData.anon
      .filter(a => a.page === page)
      .map(a => ({
        entity: a.entity,
        original: a.original,
        redacted: a.redacted,
        confidence: a.confidence || 0,
        pages: [a.page]
      }));
  }

  if (anonToRender.length === 0) {
    container.innerHTML = isAggregated
      ? '<div class="review-empty-state">No PII entities detected in this document</div>'
      : '<div class="review-empty-state">No PII entities detected on this page</div>';
    return;
  }

  // Sticky header row (same structure for both aggregated and per-page modes)
  const headerHtml = `
    <div class="review-anon-header">
      <span class="review-anon-entity-type">Entity</span>
      <span class="review-anon-original">Original</span>
      <span class="review-anon-redacted">Redacted</span>
      <span class="review-anon-pages">Page</span>
    </div>
  `;

  // Render anonymization entities
  const rowsHtml = anonToRender.map((item, idx) => {
    const pagesLabel = item.pages.length > 1 ? `p.${item.pages.join(',')}` : `p.${item.pages[0]}`;

    return `
      <div class="review-anon-row" data-index="${idx}">
        <span class="review-anon-entity-type">${item.entity.replace(/_/g, ' ')}</span>
        <span class="review-anon-original">${escapeHtml(item.original)}</span>
        <span class="review-anon-redacted">${escapeHtml(item.redacted)}</span>
        <span class="review-anon-pages">${pagesLabel}</span>
      </div>
    `;
  }).join('');

  container.innerHTML = headerHtml + rowsHtml;
}

function renderReviewTextContent(page) {
  const container = document.querySelector('.review-kvp-list');
  if (!container) return;

  // Check if text extraction was enabled
  if (!reviewModalState.enabledModes.text) {
    container.innerHTML = `
      <div class="review-not-processed">
        <span class="review-not-processed-icon">ℹ</span>
        <p>Text extraction was not selected during processing.</p>
        <p class="review-not-processed-hint">To extract clean text, reprocess with text extraction enabled.</p>
      </div>
    `;
    return;
  }

  const isAggregated = reviewModalState.kvpViewMode === 'aggregated';

  let content;
  let isEditable = true;

  if (isAggregated) {
    // Concatenate all pages with separators
    content = reviewModalState.processedData.text
      .slice()
      .sort((a, b) => a.page - b.page)
      .map(t => `--- Page ${t.page} ---\n\n${t.content}`)
      .join('\n\n');
    isEditable = false; // Aggregated view is read-only
  } else {
    // Single page
    const pageText = reviewModalState.processedData.text.find(t => t.page === page);
    const editedContent = reviewModalState.edits.text.get(page);
    content = editedContent !== undefined ? editedContent : (pageText?.content || '');
  }

  if (!content) {
    container.innerHTML = isAggregated
      ? '<div class="review-empty-state">No text content in this document</div>'
      : '<div class="review-empty-state">No text content for this page</div>';
    return;
  }

  const pageText = reviewModalState.processedData.text.find(t => t.page === page);

  container.innerHTML = `
    <div class="review-text-note">Text extracted in reading order (layout-dependent)${isAggregated ? ' — All pages combined' : ''}</div>
    <textarea class="review-text-area${isAggregated ? ' aggregated' : ''}" ${isAggregated ? 'data-aggregated="true" readonly' : `data-page="${page}" data-original="${escapeHtml(pageText?.content || '')}"`}>${escapeHtml(content)}</textarea>
  `;

  // Add edit listener (only for per-page mode)
  if (!isAggregated) {
    const textarea = container.querySelector('.review-text-area');
    textarea?.addEventListener('input', (e) => {
      const pageNum = parseInt(e.target.dataset.page);
      const newContent = e.target.value;
      const originalContent = e.target.dataset.original;

      if (newContent !== originalContent) {
        reviewModalState.edits.text.set(pageNum, newContent);
        reviewModalState.hasUnsavedChanges = true;
      } else {
        reviewModalState.edits.text.delete(pageNum);
        reviewModalState.hasUnsavedChanges = reviewModalState.edits.kvp.size > 0 ||
                                              reviewModalState.edits.anon.size > 0 ||
                                              reviewModalState.edits.text.size > 0;
      }
      updateReviewSaveButton();
    });
  }
}

function renderReviewMetadata() {
  const fileNameEl = document.getElementById('reviewFileName');
  const pagesEl = document.getElementById('reviewMetaPages');
  const dateEl = document.getElementById('reviewMetaDate');

  if (fileNameEl) fileNameEl.textContent = reviewModalState.fileName || 'document.pdf';
  if (pagesEl) pagesEl.textContent = reviewModalState.totalPages;
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function updateReviewSaveButton() {
  const saveBtn = document.getElementById('reviewSave');
  if (saveBtn) {
    saveBtn.disabled = !reviewModalState.hasUnsavedChanges;
  }
}

async function handleReviewSave() {
  // TODO: Implement actual save to API
  // const payload = {
  //   fileId: reviewModalState.fileId,
  //   edits: {
  //     kvp: Object.fromEntries(reviewModalState.edits.kvp),
  //     anon: Object.fromEntries(reviewModalState.edits.anon),
  //     text: Object.fromEntries(reviewModalState.edits.text)
  //   }
  // };
  // await fetch(`/api/tasks/${fileId}/update`, { method: 'POST', body: JSON.stringify(payload) });

  console.log('Saving changes:', {
    kvp: Object.fromEntries(reviewModalState.edits.kvp),
    anon: Object.fromEntries(reviewModalState.edits.anon),
    text: Object.fromEntries(reviewModalState.edits.text)
  });

  // Reset edit state
  reviewModalState.edits = { kvp: new Map(), anon: new Map(), text: new Map() };
  reviewModalState.hasUnsavedChanges = false;
  updateReviewSaveButton();

  // Show success feedback
  const saveBtn = document.getElementById('reviewSave');
  if (saveBtn) {
    const originalText = saveBtn.textContent;
    saveBtn.textContent = 'Saved!';
    saveBtn.classList.add('success');
    setTimeout(() => {
      saveBtn.textContent = originalText;
      saveBtn.classList.remove('success');
    }, 2000);
  }
}

function toggleReprocessOptions() {
  const optionsDiv = document.getElementById('reviewReprocessOptions');
  if (!optionsDiv) return;

  const isVisible = optionsDiv.style.display !== 'none';
  optionsDiv.style.display = isVisible ? 'none' : 'block';
}

// Helper function to escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==========================================
// UPLOAD FUNCTIONALITY
// ==========================================

function initUpload() {
  const fileInput = document.getElementById('fileInput');

  // Note: No need to add click handler on label since it has for="fileInput"
  // The HTML label already handles clicking the file input

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      showKvpConfigModal(e.target.files);
    }
  });

  // Drag and drop on the upload zone
  const uploadZone = document.querySelector('.upload-zone');
  if (uploadZone) {
    uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadZone.classList.add('dragging');
    });

    uploadZone.addEventListener('dragleave', () => {
      uploadZone.classList.remove('dragging');
    });

    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadZone.classList.remove('dragging');

      if (e.dataTransfer.files.length > 0) {
        showKvpConfigModal(e.dataTransfer.files);
      }
    });
  }

  // Global drag overlay effect
  initGlobalDragOverlay();
}

function initGlobalDragOverlay() {
  // Create overlay element with icon and text
  const overlay = document.createElement('div');
  overlay.className = 'drag-overlay';
  overlay.innerHTML = `
    <svg class="drag-overlay-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="17 8 12 3 7 8"></polyline>
      <line x1="12" y1="3" x2="12" y2="15"></line>
    </svg>
    <span class="drag-overlay-text">Drop your files here.</span>
  `;
  document.body.appendChild(overlay);

  let dragCounter = 0;

  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    if (dragCounter === 1) {
      overlay.classList.add('active');
    }
  });

  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) {
      overlay.classList.remove('active');
    }
  });

  document.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    overlay.classList.remove('active');

    // Handle file drop from anywhere on screen
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      showKvpConfigModal(e.dataTransfer.files);
    }
  });
}

let selectedFileForUpload = null;

function initEmptyStateUpload() {
  const circularDropzone = document.getElementById('circularDropzone');
  const emptyStateFileInput = document.getElementById('emptyStateFileInput');
  const btnUploadCircular = document.getElementById('btnUploadCircular');
  const selectedFileName = document.getElementById('selectedFileName');

  if (!circularDropzone || !emptyStateFileInput) return;

  // Click to browse
  circularDropzone.addEventListener('click', () => emptyStateFileInput.click());

  // File selected via input
  emptyStateFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      selectedFileForUpload = e.target.files[0];
      showSelectedFile(selectedFileForUpload);
    }
  });

  // Upload button click
  if (btnUploadCircular) {
    btnUploadCircular.addEventListener('click', () => {
      if (selectedFileForUpload) {
        handleFileUpload(selectedFileForUpload);
      }
    });
  }

  // Drag and drop
  circularDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    circularDropzone.classList.add('dragging');
  });

  circularDropzone.addEventListener('dragleave', () => {
    circularDropzone.classList.remove('dragging');
  });

  circularDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    circularDropzone.classList.remove('dragging');

    if (e.dataTransfer.files.length > 0) {
      selectedFileForUpload = e.dataTransfer.files[0];
      showSelectedFile(selectedFileForUpload);
    }
  });
}

function showSelectedFile(file) {
  const selectedFileName = document.getElementById('selectedFileName');
  const btnUploadCircular = document.getElementById('btnUploadCircular');
  const uploadText = document.querySelector('.upload-text');
  const uploadSubtext = document.querySelector('.upload-subtext');
  const uploadHint = document.querySelector('.upload-hint');

  if (selectedFileName && btnUploadCircular) {
    // Hide the upload instructions
    if (uploadText) uploadText.style.display = 'none';
    if (uploadSubtext) uploadSubtext.style.display = 'none';
    if (uploadHint) uploadHint.style.display = 'none';

    // Show selected file name
    selectedFileName.textContent = file.name;
    selectedFileName.style.display = 'block';

    // Show upload button
    btnUploadCircular.style.display = 'flex';
  }
}

function updateCircularProgress(percent) {
  const progressRing = document.getElementById('progressRing');
  if (!progressRing) return;

  // Circle circumference = 2 * π * r
  // r = 120 (from the SVG)
  const radius = 120;
  const circumference = 2 * Math.PI * radius;

  // Calculate stroke-dashoffset based on percentage
  const offset = circumference - (percent / 100) * circumference;

  progressRing.style.strokeDasharray = circumference;
  progressRing.style.strokeDashoffset = offset;
}

async function handleFileUpload(file) {
  const circularDropzone = document.getElementById('circularDropzone');
  const btnUploadCircular = document.getElementById('btnUploadCircular');
  const progressRing = document.getElementById('progressRing');

  // Show uploading state
  if (circularDropzone) circularDropzone.classList.add('uploading');
  if (btnUploadCircular) btnUploadCircular.style.display = 'none';

  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('userId', USER_ID);

    // Create XMLHttpRequest for progress tracking
    const xhr = new XMLHttpRequest();

    // Track upload progress
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percentComplete = (e.loaded / e.total) * 100;
        updateCircularProgress(percentComplete);
      }
    });

    // Handle completion
    const uploadPromise = new Promise((resolve, reject) => {
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          reject(new Error(`Upload failed: ${xhr.statusText}`));
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Upload failed'));
      });
    });

    xhr.open('POST', `${API_URL}/api/tasks`);
    xhr.send(formData);

    const data = await uploadPromise;

    if (data.success) {
      const taskId = data.data.taskId;

      // If a folder is selected (not "All Documents"), move the task to that folder
      if (currentFolderId && currentFolderId !== 'all') {
        console.log(`📁 Moving task ${taskId} to folder ${currentFolderId}`);
        try {
          const folderResponse = await fetch(`${API_URL}/api/folders/${currentFolderId}/tasks/${taskId}`, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json'
            }
          });

          const folderData = await folderResponse.json();

          if (folderData.success) {
            console.log(`✓ Task added to folder: ${folders.find(f => f.id === currentFolderId)?.name}`);
          } else {
            console.error('Failed to add task to folder:', folderData.error);
          }
        } catch (error) {
          console.error('Failed to add task to folder:', error);
        }
      } else {
        console.log('📁 No folder selected, task added to All Documents');
      }

      // Complete the progress ring
      updateCircularProgress(100);

      // Clear the selected file
      selectedFileForUpload = null;

      // Reload tasks and show viewer for new task
      setTimeout(async () => {
        await loadTasks();

        // Find the newly uploaded task and show it
        const newTask = tasks.find(t => t.id === taskId);
        if (newTask) {
          showViewer(newTask);
        }
      }, 500);
    } else {
      throw new Error(data.error || 'Upload failed');
    }
  } catch (error) {
    console.error('Upload failed:', error);

    // Show error state
    if (circularDropzone) {
      circularDropzone.classList.remove('uploading');
      circularDropzone.classList.add('error');
    }

    // Reset progress
    updateCircularProgress(0);

    // Show error message
    const selectedFileName = document.getElementById('selectedFileName');
    if (selectedFileName) {
      selectedFileName.textContent = `✗ Upload failed: ${error.message}`;
      selectedFileName.style.color = '#ef4444';
    }

    // Reset after 3 seconds
    setTimeout(() => {
      if (circularDropzone) circularDropzone.classList.remove('error');
      selectedFileForUpload = null;
      renderDocumentGrid(); // Refresh to show clean state
    }, 3000);
  }
}

// ==========================================
// FOLDER FUNCTIONALITY
// ==========================================

function initFolders() {
  const newFolderBtn = document.getElementById('newFolderBtn');
  const newFolderModal = document.getElementById('newFolderModal');
  const cancelFolderBtn = document.getElementById('cancelFolderBtn');
  const folderForm = document.getElementById('folderForm');
  const backToFoldersBtn = document.getElementById('backToFoldersBtn');

  // New folder button
  if (newFolderBtn) {
    newFolderBtn.addEventListener('click', () => {
      isEditingFolder = false;
      editingFolderId = null;
      document.getElementById('folderForm').reset();
      document.getElementById('folderModalTitle').textContent = 'New Folder';
      document.getElementById('saveFolderBtn').textContent = 'Create Folder';
      newFolderModal.classList.add('active');
    });
  }

  // Back to folders list button
  if (backToFoldersBtn) {
    backToFoldersBtn.addEventListener('click', () => {
      // Just show folders list in sidebar (stay in current view)
      showFoldersList();
    });
  }

  // Cancel button
  if (cancelFolderBtn) {
    cancelFolderBtn.addEventListener('click', () => {
      newFolderModal.classList.remove('active');
    });
  }

  // Close (X) button
  const closeNewFolderModal = document.getElementById('closeNewFolderModal');
  if (closeNewFolderModal) {
    closeNewFolderModal.addEventListener('click', () => {
      newFolderModal.classList.remove('active');
    });
  }

  // Close modal on outside click
  if (newFolderModal) {
    newFolderModal.addEventListener('click', (e) => {
      if (e.target === newFolderModal) {
        newFolderModal.classList.remove('active');
      }
    });
  }

  // Folder form submission
  if (folderForm) {
    folderForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleFolderSubmit();
    });
  }
}

async function loadFolders() {
  try {
    const response = await fetch(`${API_URL}/api/folders`, {
      credentials: 'include'
    });

    const data = await response.json();

    if (data.success) {
      folders = data.folders;
      renderFolders();
      updateFolderCounts();
      console.log(`✓ Folders loaded: ${folders.length} total`);
    }
  } catch (error) {
    console.error('Failed to load folders:', error);
  }
}

function renderFolders() {
  const foldersList = document.getElementById('foldersList');
  if (!foldersList) return;

  // Create "All Documents" folder
  const allDocsHTML = `
    <div class="folder-item all-documents ${currentFolderId === 'all' ? 'active' : ''}" data-folder-id="all">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
      </svg>
      <span>All Documents</span>
      <span class="folder-count" id="allDocsCount">0</span>
    </div>
  `;

  const customFolders = folders.map(folder => `
    <div class="folder-item ${currentFolderId === folder.id ? 'active' : ''}"
         data-folder-id="${folder.id}"
         draggable="false">
      <div class="folder-color" style="background: ${folder.color || '#c7ff00'}"></div>
      <span class="folder-name">${escapeHtml(folder.name)}</span>
      <span class="folder-count">0</span>
      <button class="folder-menu-btn" title="Folder options">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="1"></circle>
          <circle cx="12" cy="5" r="1"></circle>
          <circle cx="12" cy="19" r="1"></circle>
        </svg>
      </button>
      <div class="folder-menu">
        <button class="folder-menu-item edit-folder">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
          Edit Project
        </button>
        <button class="folder-menu-item delete-folder">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
          Delete
        </button>
      </div>
    </div>
  `).join('');

  // Clear and rebuild
  foldersList.innerHTML = allDocsHTML + customFolders;

  // Add click handlers for folder selection
  foldersList.querySelectorAll('.folder-item').forEach(item => {
    const folderId = item.dataset.folderId;

    // Click on folder name to select
    item.addEventListener('click', (e) => {
      if (!e.target.closest('.folder-menu-btn') && !e.target.closest('.folder-menu')) {
        selectFolder(folderId);
      }
    });

    // Three-dot menu button
    const menuBtn = item.querySelector('.folder-menu-btn');
    const menu = item.querySelector('.folder-menu');

    if (menuBtn && menu) {
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();

        // Close all other menus
        document.querySelectorAll('.folder-menu.show').forEach(m => {
          if (m !== menu) m.classList.remove('show');
        });

        // Toggle this menu
        menu.classList.toggle('show');
      });
    }

    // Edit folder
    const editBtn = item.querySelector('.edit-folder');
    if (editBtn) {
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.remove('show');
        editFolder(folderId);
      });
    }

    // Delete folder
    const deleteBtn = item.querySelector('.delete-folder');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.remove('show');
        deleteFolder(folderId);
      });
    }
  });

  // Close menus when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.folder-item')) {
      document.querySelectorAll('.folder-menu.show').forEach(m => {
        m.classList.remove('show');
      });
    }
  });

  // Make folder items drop targets for drag and drop
  enableFolderDropTargets();
}

function selectFolder(folderId) {
  currentFolderId = folderId;

  // Close any open menus
  document.querySelectorAll('.folder-menu.show').forEach(m => {
    m.classList.remove('show');
  });

  // Update active state
  document.querySelectorAll('.folder-item').forEach(item => {
    item.classList.remove('active');
  });

  const selectedFolder = document.querySelector(`[data-folder-id="${folderId}"]`);
  if (selectedFolder) {
    selectedFolder.classList.add('active');
  }

  // Filter tasks in main area
  renderDocumentGrid();

  // If in viewer mode (viewing a document), show folder documents list in sidebar
  const viewerView = document.getElementById('viewerView');
  if (viewerView && viewerView.classList.contains('active')) {
    showFolderDocumentsListInViewer(folderId);
  }

  console.log(`📁 Selected folder: ${folderId === 'all' ? 'All Documents' : folders.find(f => f.id === folderId)?.name}`);
}

function showFolderDocumentsListInViewer(folderId) {
  const headerTitle = document.getElementById('foldersHeaderTitle');
  const backBtn = document.getElementById('backToFoldersBtn');
  const foldersList = document.getElementById('foldersList');

  // Get folder info or use "All Documents"
  let folderName = 'All Documents';
  let folderColor = null;

  if (folderId) {
    const folder = folders.find(f => f.id === folderId);
    if (folder) {
      folderName = folder.name;
      folderColor = folder.color;
    }
  }

  // Update header
  if (headerTitle) {
    headerTitle.textContent = folderName;
    headerTitle.style.textTransform = 'none';
  }

  if (backBtn) {
    backBtn.style.display = 'flex';
  }

  // Replace folders list with document list
  if (foldersList) {
    // Filter documents based on folder
    let folderTasks;
    if (!folderId || folderId === 'all') {
      // Show all documents for "All Documents"
      folderTasks = tasks;
    } else {
      // Filter by specific folder
      folderTasks = tasks.filter(t => t.folder_id === folderId);
    }

    // Create list of documents
    const documentsHTML = folderTasks.map(task => {
      const isActive = currentTask && task.id === currentTask.id;
      return `
        <div class="folder-item document-item ${isActive ? 'active' : ''}" data-task-id="${task.id}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
          <span class="folder-name" title="${escapeHtml(task.filename)}">${escapeHtml(task.filename)}</span>
        </div>
      `;
    }).join('');

    foldersList.innerHTML = documentsHTML || '<div class="empty-state-small">No documents in this folder</div>';

    // Add click handlers to switch documents (for viewer mode)
    foldersList.querySelectorAll('.document-item').forEach(item => {
      item.addEventListener('click', () => {
        const taskId = item.dataset.taskId;
        const task = tasks.find(t => t.id === taskId);
        if (task) {
          showViewer(task);
        }
      });
    });
  }
}

function showFoldersList() {
  // Reset header to "Folders"
  const headerTitle = document.getElementById('foldersHeaderTitle');
  const backBtn = document.getElementById('backToFoldersBtn');

  if (headerTitle) {
    headerTitle.textContent = 'Folders';
    headerTitle.style.textTransform = 'uppercase';
  }

  if (backBtn) {
    backBtn.style.display = 'none';
  }

  // Reset to "All Documents" view
  currentFolderId = 'all';

  // Re-render folders list in sidebar
  renderFolders();

  // Update folder counts
  updateFolderCounts();
}

function updateFolderCounts() {
  // Update "All Documents" count
  const allDocsCount = document.getElementById('allDocsCount');
  if (allDocsCount) {
    allDocsCount.textContent = tasks.length;
  }

  // Update custom folder counts
  folders.forEach(folder => {
    const folderItem = document.querySelector(`[data-folder-id="${folder.id}"]`);
    if (folderItem) {
      const countEl = folderItem.querySelector('.folder-count');
      const count = tasks.filter(task => task.folder_id === folder.id).length;
      if (countEl) {
        countEl.textContent = count;
      }
    }
  });
}

async function handleFolderSubmit() {
  const name = document.getElementById('folderName').value.trim();
  const description = document.getElementById('folderDescription').value.trim();
  const color = document.getElementById('folderColor').value;

  if (!name) {
    alert('Folder name is required');
    return;
  }

  const saveFolderBtn = document.getElementById('saveFolderBtn');
  saveFolderBtn.disabled = true;
  saveFolderBtn.textContent = isEditingFolder ? 'Updating...' : 'Creating...';

  try {
    const url = isEditingFolder
      ? `${API_URL}/api/folders/${editingFolderId}`
      : `${API_URL}/api/folders`;

    const method = isEditingFolder ? 'PUT' : 'POST';

    const response = await fetch(url, {
      method,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name, description, color })
    });

    const data = await response.json();

    if (data.success) {
      document.getElementById('newFolderModal').classList.remove('active');
      document.getElementById('folderForm').reset();
      await loadFolders();

      // If editing, refresh tasks to update folder names
      if (isEditingFolder) {
        await loadTasks();
      }

      console.log(`✓ Folder ${isEditingFolder ? 'updated' : 'created'}: ${name}`);
    } else {
      alert(data.error || 'Failed to save folder');
    }
  } catch (error) {
    console.error('Failed to save folder:', error);
    alert('Failed to save folder: ' + error.message);
  } finally {
    saveFolderBtn.disabled = false;
    saveFolderBtn.textContent = isEditingFolder ? 'Update Folder' : 'Create Folder';
  }
}

function editFolder(folderId) {
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return;

  isEditingFolder = true;
  editingFolderId = folderId;

  document.getElementById('folderModalTitle').textContent = 'Edit Folder';
  document.getElementById('folderName').value = folder.name;
  document.getElementById('folderDescription').value = folder.description || '';
  document.getElementById('folderColor').value = folder.color || '#c7ff00';
  document.getElementById('saveFolderBtn').textContent = 'Update Folder';
  document.getElementById('newFolderModal').classList.add('active');
}

async function deleteFolder(folderId) {
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return;

  const taskCount = tasks.filter(task => task.folder_id === folderId).length;
  const message = taskCount > 0
    ? `Delete "${folder.name}"? ${taskCount} document(s) will be moved to "All Documents".`
    : `Delete "${folder.name}"?`;

  if (!confirm(message)) return;

  try {
    const response = await fetch(`${API_URL}/api/folders/${folderId}`, {
      method: 'DELETE',
      credentials: 'include'
    });

    const data = await response.json();

    if (data.success) {
      // If we were viewing this folder, switch to "All Documents"
      if (currentFolderId === folderId) {
        selectFolder('all');
      }

      await loadFolders();
      await loadTasks(); // Refresh to show tasks moved to "All Documents"

      console.log(`✓ Folder deleted: ${folder.name}`);
    } else {
      alert(data.error || 'Failed to delete folder');
    }
  } catch (error) {
    console.error('Failed to delete folder:', error);
    alert('Failed to delete folder: ' + error.message);
  }
}

// Drag and drop for moving tasks to folders
function enableFolderDropTargets() {
  const folderItems = document.querySelectorAll('.folder-item');

  folderItems.forEach(item => {
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      item.classList.add('drag-over');
    });

    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over');
    });

    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');

      const taskId = e.dataTransfer.getData('text/plain');
      const folderId = item.dataset.folderId;

      if (taskId && folderId) {
        await moveTaskToFolder(taskId, folderId);
      }
    });
  });
}

async function moveTaskToFolder(taskId, folderId) {
  try {
    const targetFolderId = folderId === 'all' ? null : folderId;
    const url = targetFolderId
      ? `${API_URL}/api/folders/${targetFolderId}/tasks/${taskId}`
      : `${API_URL}/api/folders/null/tasks/${taskId}`;

    const response = await fetch(url, {
      method: targetFolderId ? 'POST' : 'DELETE',
      credentials: 'include'
    });

    const data = await response.json();

    if (data.success) {
      await loadTasks();
      updateFolderCounts();

      const folder = folderId === 'all' ? 'All Documents' : folders.find(f => f.id === folderId)?.name;
      console.log(`✓ Task moved to: ${folder}`);
    } else {
      alert(data.error || 'Failed to move task');
    }
  } catch (error) {
    console.error('Failed to move task:', error);
    alert('Failed to move task: ' + error.message);
  }
}

// ==========================================
// LOAD AND RENDER TASKS
// ==========================================

async function loadTasks() {
  // Debounce: wait 300ms before loading
  if (loadTasksTimeout) {
    clearTimeout(loadTasksTimeout);
  }

  loadTasksTimeout = setTimeout(async () => {
    try {
      const response = await fetch(`${API_URL}/api/tasks?userId=${USER_ID}`);

      // Check for session expiration
      if (response.status === 401) {
        await handleSessionExpired();
        return;
      }

      const data = await response.json();

      if (data.success) {
        tasks = data.data.tasks;
        updateStats(data.data.stats);
        updateFolderCounts();
        renderDocumentGrid();

        // If viewing a task, update it
        if (currentTask) {
          const updatedTask = tasks.find(t => t.id === currentTask.id);
          if (updatedTask) {
            currentTask = updatedTask;

            // Update viewer based on status change
            if (updatedTask.status === 'completed') {
              showResultsCard(updatedTask);
            } else if (updatedTask.status === 'failed') {
              showErrorCard(updatedTask);
            } else {
              updateProcessingStatus(updatedTask.status);
            }
          }
        }

        console.log(`✓ Tasks loaded: ${tasks.length} total`);
      }
    } catch (error) {
      console.error('Failed to load tasks:', error);
    }
  }, 300);
}

async function loadTasksWithoutReload() {
  // Silent update: refresh task list without reloading viewer
  // Used during active editing sessions to avoid disrupting the user
  try {
    const response = await fetch(`${API_URL}/api/tasks?userId=${USER_ID}`);

    // Check for session expiration
    if (response.status === 401) {
      await handleSessionExpired();
      return;
    }

    const data = await response.json();

    if (data.success) {
      tasks = data.data.tasks;
      updateStats(data.data.stats);
      renderDocumentGrid();

      // Update currentTask metadata silently (no viewer reload)
      if (currentTask) {
        const updatedTask = tasks.find(t => t.id === currentTask.id);
        if (updatedTask) {
          currentTask = updatedTask;
          console.log('✓ Task metadata updated (silent)');
        }
      }
    }
  } catch (error) {
    console.error('Failed to load tasks (silent):', error);
  }
}

function updateStats(stats) {
  // Inline stats (dashboard)
  document.getElementById('statTotalInline').textContent = stats.total || 0;
  document.getElementById('statProcessingInline').textContent =
    (parseInt(stats.pending || 0) + parseInt(stats.processing || 0));
  document.getElementById('statCompletedInline').textContent = stats.completed || 0;
}

function renderDocumentGrid() {
  const grid = document.getElementById('documentGrid');

  // Filter tasks by current folder
  let filteredTasks = tasks;
  if (currentFolderId !== 'all') {
    filteredTasks = tasks.filter(task => task.folder_id === currentFolderId);
  }

  if (filteredTasks.length === 0) {
    if (currentFolderId === 'all') {
      // Show upload dropzone for empty "All Documents" view
      grid.innerHTML = `
        <div class="empty-state" id="emptyState">
          <div class="circular-upload-container">
            <div class="circular-dropzone" id="circularDropzone">
              <input type="file" id="emptyStateFileInput" accept=".pdf,image/*" hidden>
              <svg class="circular-progress-ring" width="280" height="280">
                <circle class="progress-ring-bg" cx="140" cy="140" r="120" />
                <circle class="progress-ring-fill" cx="140" cy="140" r="120" id="progressRing" />
              </svg>
              <div class="dropzone-content">
                <svg class="upload-icon" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
                <p class="upload-text">Drop your file here</p>
                <p class="upload-subtext">or click to browse</p>
                <small class="upload-hint">PDF, PNG, JPG (Max 50MB)</small>
                <div class="selected-file-name" id="selectedFileName" style="display: none;"></div>
              </div>
            </div>
            <button class="btn-upload-circular" id="btnUploadCircular" style="display: none;">
              Upload
            </button>
          </div>
        </div>
      `;
      // Re-initialize upload functionality
      initEmptyStateUpload();
    } else {
      // Show simple empty message for specific folders
      grid.innerHTML = `
        <div class="empty-state">
          <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
          <p>No documents in this folder</p>
          <small>Drag and drop documents here to organize them</small>
        </div>
      `;
    }
    return;
  }

  grid.innerHTML = filteredTasks.map(task => createDocumentCard(task)).join('');

  // Add click and drag handlers
  filteredTasks.forEach(task => {
    const card = document.querySelector(`[data-task-id="${task.id}"]`);
    if (card) {
      card.addEventListener('click', () => showViewer(task));

      // Make card draggable for folder organization
      card.setAttribute('draggable', 'true');
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', task.id);
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
      });
    }
  });
}

function createDocumentCard(task) {
  const statusClass = task.status.toLowerCase();
  const isProcessing = task.status === 'processing';

  return `
    <div class="document-card" data-task-id="${task.id}">
      <div class="doc-card-header">
        <div class="doc-card-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
        </div>
        <div class="doc-card-status ${statusClass}">
          <span class="status-dot ${isProcessing ? 'pulse' : ''}"></span>
          ${task.status.toUpperCase()}
        </div>
      </div>
      <div class="doc-card-title" title="${escapeHtml(task.filename)}">
        ${escapeHtml(task.filename)}
      </div>
      <div class="doc-card-meta">
        ${formatDate(task.created_at)}
      </div>
    </div>
  `;
}

// ==========================================
// VIEWER ACTIONS
// ==========================================

async function loadDocumentPreview(taskId) {
  const previewContainer = document.getElementById('previewContainerCard');

  console.log('📋 Loading document for task ID:', taskId);

  try {
    let htmlContent;
    let versionNumber;
    let contentSource;

    // Always try to load latest version from database first
    // This ensures we get the most recent changes, even if they're only auto-saved
    console.log('📚 Checking for latest version in database...');

    let response = await fetch(`${API_URL}/api/versions/${taskId}/latest`, {
      headers: { 'x-user-id': USER_ID }
    });

    if (response.ok) {
      // Found version in database
      htmlContent = await response.text();
      versionNumber = response.headers.get('X-Version-Number');
      contentSource = response.headers.get('X-Content-Source');

      console.log(`📖 Loaded version ${versionNumber} from ${contentSource}`);

      // Check if content is corrupted (PDF embed instead of actual HTML)
      const isCorrupted = htmlContent.includes('type="application/pdf"') ||
                          htmlContent.includes('<embed');

      if (isCorrupted) {
        console.warn('⚠️ Detected corrupted version, loading original from S3...');
        const s3Response = await fetch(`${API_URL}/api/tasks/${taskId}/preview`, {
          headers: { 'x-user-id': USER_ID }
        });
        htmlContent = await s3Response.text();
        console.log('✓ Loaded original HTML from S3 instead');
      }
    } else if (response.status === 404) {
      // No versions yet - load original from S3
      console.log('📄 New document (no versions) - loading original from S3');

      const s3Response = await fetch(`${API_URL}/api/tasks/${taskId}/preview`, {
        headers: { 'x-user-id': USER_ID }
      });

      if (!s3Response.ok) {
        console.error('❌ Failed to load document from S3:', s3Response.status);
        throw new Error(`Failed to load document: ${s3Response.status}`);
      }

      htmlContent = await s3Response.text();
      console.log('✓ Loaded original HTML from S3');
    } else {
      // Unexpected error
      console.error('❌ Failed to load version from database:', response.status);
      throw new Error(`Failed to load document: ${response.status}`);
    }

    // Create iframe and inject HTML using srcdoc
    const iframe = document.createElement('iframe');
    iframe.id = 'untxtPreview';
    iframe.setAttribute('frameborder', '0');

    // Set explicit dimensions (CSS might not apply to dynamically created iframes)
    iframe.style.cssText = `
      width: 21cm !important;
      height: 29.7cm !important;
      min-height: 29.7cm !important;
      background: white !important;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
      border: none !important;
      display: block !important;
      margin: 0 auto;
      opacity: 1 !important;
      visibility: visible !important;
      z-index: 1 !important;
    `;

    // Use srcdoc to inject the HTML content
    iframe.srcdoc = htmlContent;

    // Replace placeholder with iframe
    previewContainer.innerHTML = '';
    previewContainer.appendChild(iframe);

    // Wait for iframe to load, then make editable and start view session
    iframe.onload = () => {
      // Force white background on iframe content
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        if (iframeDoc && iframeDoc.body) {
          iframeDoc.body.style.backgroundColor = 'white';
          iframeDoc.body.style.color = 'black';
        }
      } catch (e) {
        console.warn('Could not access iframe content:', e);
      }

      makeIframeEditableGoogleDocs();
      // Start with view-only session - will upgrade to edit session on first keystroke
      startViewSession('untxt_view');
    };

  } catch (error) {
    console.error('Failed to load document preview:', error);
    previewContainer.innerHTML = `
      <div class="preview-placeholder">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
        <p>Failed to load preview</p>
      </div>
    `;
  }
}

function makeIframeEditableGoogleDocs() {
  const previewContainer = document.getElementById('previewContainerCard');
  const iframe = previewContainer?.querySelector('iframe');

  if (!iframe || !iframe.contentDocument) {
    console.error('No iframe found');
    return;
  }

  const iframeBody = iframe.contentDocument.body;
  if (iframeBody) {
    iframeBody.contentEditable = 'true';
    iframeBody.style.outline = 'none';
    iframeBody.focus();

    // Setup auto-save
    setupAutoSaveGoogleDocs(iframeBody);

    console.log('✏️ Content is now editable (Google Docs mode)');
  }
}

/**
 * Load original PDF preview with HIPAA-compliant in-memory caching
 * Called when user clicks "Original" button
 */
async function loadOriginalPreview(taskId) {
  const previewContainer = document.getElementById('previewContainerCard');

  try {
    // Show loading state
    previewContainer.innerHTML = `
      <div class="pdf-loading-state" style="display: flex;">
        <div class="spinner"></div>
        <p>Loading original PDF...</p>
      </div>
    `;

    // Load PDF with caching (HIPAA-compliant)
    const blobUrl = await loadPdfPreview(taskId);

    // Get task info for content type
    const task = tasks.find(t => t.id === taskId);
    const contentType = task?.mime_type || 'application/pdf';

    // Create iframe to display original file
    const iframe = document.createElement('iframe');
    iframe.id = 'originalPreview';
    iframe.setAttribute('frameborder', '0');

    // Set explicit dimensions
    iframe.style.cssText = `
      width: 100%;
      height: 100%;
      background: white;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
      border: none !important;
      display: block !important;
      margin: 0 auto;
    `;

    // For PDFs, hide toolbar and navigation panes
    if (contentType.includes('pdf')) {
      iframe.src = `${blobUrl}#toolbar=0&navpanes=0&scrollbar=0`;
    } else {
      // For images or other files
      iframe.src = blobUrl;
    }

    // Replace loading with iframe
    previewContainer.innerHTML = '';
    previewContainer.appendChild(iframe);

    // Start view-only session for audit logging (HIPAA compliance)
    await startViewSession('original_view');

    console.log(`✓ Original preview displayed for task ${taskId}`);

  } catch (error) {
    console.error('Failed to load original preview:', error);
    previewContainer.innerHTML = `
      <div class="pdf-error-state" style="display: flex;">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <p class="error-message">${error.message || 'Failed to load original'}</p>
        <button class="btn-retry" onclick="loadOriginalPreview('${taskId}')">Retry</button>
      </div>
    `;
  }
}

function switchPreview(view) {
  if (!currentTask) return;

  const toggleUntxt = document.getElementById('toggleUntxt');
  const toggleOriginal = document.getElementById('toggleOriginal');
  const previewContainer = document.getElementById('previewContainerCard');

  // Clean up any existing blob URLs
  const existingIframe = previewContainer.querySelector('iframe');
  if (existingIframe && existingIframe.dataset.blobUrl) {
    URL.revokeObjectURL(existingIframe.dataset.blobUrl);
  }

  if (view === 'untxt') {
    toggleUntxt.classList.add('active');
    toggleOriginal.classList.remove('active');
    loadDocumentPreview(currentTask.id);
  } else {
    toggleOriginal.classList.add('active');
    toggleUntxt.classList.remove('active');
    loadOriginalPreview(currentTask.id);
  }
}

async function loadTextPreview(taskId) {
  const previewEl = document.getElementById('extractedTextPreview');

  try {
    previewEl.innerHTML = '<p class="text-loading">Loading text preview...</p>';

    // Use the preview endpoint to get HTML (not PDF)
    const response = await fetch(`${API_URL}/api/tasks/${taskId}/preview`, {
      headers: {
        'x-user-id': USER_ID
      }
    });

    if (!response.ok) {
      throw new Error('Failed to load text preview');
    }

    const contentType = response.headers.get('Content-Type') || '';
    const content = await response.text();

    // Store full content for copy/download
    previewEl.dataset.fullText = content;

    // Check if content is HTML or plain text
    if (contentType.includes('html') || content.trim().startsWith('<')) {
      // Parse HTML and extract text content
      const parser = new DOMParser();
      const doc = parser.parseFromString(content, 'text/html');

      // Remove script and style tags
      doc.querySelectorAll('script, style').forEach(el => el.remove());

      // Get the text content
      const extractedText = doc.body.textContent || doc.body.innerText || '';

      // Clean up whitespace
      const cleanText = extractedText
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join('\n\n');

      // Show full text (not just preview)
      previewEl.textContent = cleanText;

      // Store clean text for copying
      previewEl.dataset.cleanText = cleanText;
    } else {
      // Plain text - show full content
      previewEl.textContent = content;
      previewEl.dataset.cleanText = content;
    }

  } catch (error) {
    console.error('Failed to load text preview:', error);
    previewEl.innerHTML = '<p class="text-loading">Failed to load preview</p>';
  }
}

async function copyExtractedTextHeader() {
  const previewEl = document.getElementById('extractedTextPreview');
  // Use clean text if available, otherwise fall back to full content or displayed text
  const text = previewEl.dataset.cleanText || previewEl.dataset.fullText || previewEl.textContent;

  try {
    await navigator.clipboard.writeText(text);

    // Show success feedback on header button
    const btn = document.getElementById('copyTextHeaderBtn');
    const originalHTML = btn.innerHTML;

    // Add copied class and change to checkmark
    btn.classList.add('copied');
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    `;
    btn.disabled = true;

    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = originalHTML;
      btn.disabled = false;
    }, 2000);

  } catch (error) {
    console.error('Failed to copy text:', error);
    alert('Failed to copy text to clipboard');
  }
}

async function downloadOriginal(taskId) {
  try {
    const response = await fetch(`${API_URL}/api/tasks/${taskId}/download`, {
      credentials: 'include',
      headers: {
        'x-user-id': USER_ID
      }
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Download failed');
    }

    const contentDisposition = response.headers.get('Content-Disposition');
    let filename = 'download';
    if (contentDisposition) {
      const matches = /filename="([^"]+)"/.exec(contentDisposition);
      if (matches) filename = matches[1];
    }

    const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
    const arrayBuffer = await response.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: contentType });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  } catch (error) {
    console.error('Download original failed:', error);
    alert('Failed to download original file: ' + error.message);
  }
}

async function downloadResult(taskId) {
  if (!currentTask) {
    taskId = taskId || currentTask?.id;
  }

  const downloadBtn = document.getElementById('downloadResultBtn');
  if (downloadBtn) {
    downloadBtn.textContent = 'Preparing download...';
    downloadBtn.disabled = true;
  }

  try {
    // Get current content from iframe - save COMPLETE HTML document
    const previewContainer = document.getElementById('previewContainerCard');
    const iframe = previewContainer?.querySelector('iframe');

    let htmlContent;

    // If viewing Original PDF, fetch the UNTXT content from server instead
    if (iframe?.id === 'originalPreview') {
      console.log('📄 Viewing Original PDF - fetching UNTXT content from server for download');

      const fetchResponse = await fetch(`${API_URL}/api/versions/${taskId || currentTask?.id}/latest`, {
        headers: { 'x-user-id': USER_ID }
      });

      if (!fetchResponse.ok) {
        throw new Error('Failed to fetch UNTXT content for download');
      }

      htmlContent = await fetchResponse.text();

      // Check if content is corrupted (PDF embed instead of actual HTML)
      // Only check for PDF embeds, not length (length can vary for valid docs)
      const isCorrupted = htmlContent.includes('type="application/pdf"') ||
                          htmlContent.includes('<embed');

      if (isCorrupted) {
        console.warn('⚠️ Detected corrupted/invalid version with PDF embed, loading original from S3...');

        // Check if document has versions - if yes, need to fix corruption
        if (currentTask?.total_versions > 0) {
          console.log('📄 Document has corrupted versions - using S3 original instead');
        }

        // Load original HTML from S3
        const s3Response = await fetch(`${API_URL}/api/tasks/${taskId || currentTask?.id}/preview`, {
          headers: { 'x-user-id': USER_ID }
        });

        if (!s3Response.ok) {
          throw new Error('Failed to fetch original HTML from S3');
        }

        htmlContent = await s3Response.text();
        console.log('✓ Loaded original HTML from S3 instead of corrupted version');
      }
    } else if (iframe?.id === 'untxtPreview') {
      // Get content from the current UNTXT iframe
      htmlContent = iframe?.contentDocument?.documentElement?.outerHTML;

      // Validate: Don't save if content looks corrupted (PDF embed)
      if (!htmlContent || htmlContent.includes('type="application/pdf"') || htmlContent.includes('<embed')) {
        throw new Error('Cannot save: Document appears corrupted. Please reload the document.');
      }
    } else {
      throw new Error('No document preview loaded');
    }

    // Final validation before saving: Ensure content doesn't have PDF embeds
    if (htmlContent && (htmlContent.includes('type="application/pdf"') || htmlContent.includes('<embed'))) {
      console.error('❌ Attempted to save corrupted HTML with PDF embed');
      throw new Error('Cannot save: Content contains PDF embed. This should not happen.');
    }

    // Generate a session ID if we don't have one (e.g., downloading without editing)
    const sessionIdToUse = currentSessionId || `download-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const response = await fetch(`${API_URL}/api/sessions/${taskId}/download-result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': USER_ID
      },
      body: JSON.stringify({
        htmlContent: htmlContent || '',
        sessionId: sessionIdToUse
      })
    });

    if (!response.ok) {
      throw new Error('Download failed');
    }

    // Download PDF
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentTask?.filename || 'document'}_result.pdf`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    // Show version info
    const versionNumber = response.headers.get('X-Version-Number');
    console.log(`📥 Downloaded as version ${versionNumber}`);
    alert(`Downloaded! Auto-saved as version ${versionNumber}`);

  } catch (error) {
    console.error('Download failed:', error);
    alert('Download failed. Please try again.');
  } finally {
    if (downloadBtn) {
      downloadBtn.textContent = 'Download Result';
      downloadBtn.disabled = false;
    }
  }
}

async function deleteTaskFromViewer(taskId) {
  if (!confirm('Are you sure you want to delete this task? This will remove all associated files from storage.')) {
    return;
  }

  try {
    // End session and clear state BEFORE deleting to prevent errors
    if (currentSessionId) {
      // End session without trying to save (task will be deleted anyway)
      const tempSessionId = currentSessionId;
      currentSessionId = null; // Clear immediately to prevent auto-save
      currentTask = null; // Clear task to prevent further operations

      console.log('🗑️ Ending session before deletion:', tempSessionId);
    }

    const response = await fetch(`${API_URL}/api/tasks/${taskId}`, {
      method: 'DELETE',
    });

    const data = await response.json();

    if (data.success) {
      // Go back to dashboard
      showDashboard();
    } else {
      alert('Failed to delete task: ' + (data.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('Delete failed:', error);
    alert('Failed to delete task: ' + error.message);
  }
}

function retryTask() {
  // For now, just go back to dashboard
  // In the future, could implement re-queuing
  alert('Retry functionality coming soon. Please upload the document again.');
  showDashboard();
}

// ==========================================
// WEBSOCKET
// ==========================================

function initWebSocket() {
  const wsDot = document.querySelector('.ws-dot');

  function connect() {
    if (!USER_ID) {
      console.error('Cannot initialize WebSocket: USER_ID not set');
      return;
    }
    ws = new WebSocket(`${WS_URL}?userId=${USER_ID}`);

    ws.onopen = () => {
      console.log('✓ WebSocket connected - Real-time updates ACTIVE');
      wsDot.classList.add('connected');
      wsDot.classList.remove('disconnected');
      loadTasks();
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === 'task_update') {
          handleTaskUpdate(message.data);
        } else if (message.type === 'db_change') {
          handleDatabaseChange(message.data);
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('✗ WebSocket disconnected - Reconnecting...');
      wsDot.classList.remove('connected');
      wsDot.classList.add('disconnected');
      setTimeout(connect, 3000);
    };
  }

  connect();
}

function handleTaskUpdate(data) {
  console.log('🔄 Real-time update received:', data.taskId, '→', data.status);

  // Find task in local state
  const taskIndex = tasks.findIndex(t => t.id === data.taskId);

  if (taskIndex !== -1) {
    tasks[taskIndex].status = data.status;
    renderDocumentGrid();
  }

  // Reload full data
  loadTasks();
}

function handleDatabaseChange(data) {
  console.log('💾 Database change detected:', data.table, data.operation, data.recordId);

  // Don't reload document if we're actively editing (Google Docs flow)
  // Only reload task list to update metadata (but skip showResultsCard)
  if (currentSessionId && currentTask) {
    // Silent update: refresh task metadata without reloading document
    loadTasksWithoutReload();
  } else {
    // Normal flow: reload everything
    loadTasks();
  }
}

// ==========================================
// AUTH
// ==========================================

// Global flag to prevent multiple session expiration alerts
let sessionExpiredHandled = false;

// Inactivity tracking
let inactivityTimer = null;
let lastActivityTime = Date.now();
const INACTIVITY_TIMEOUT = 15 * 60 * 1000; // 15 minutes in milliseconds

/**
 * Reset inactivity timer on user activity
 */
function resetInactivityTimer() {
  lastActivityTime = Date.now();

  // Clear existing timer
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
  }

  // Set new timer for 15 minutes
  inactivityTimer = setTimeout(() => {
    console.warn('⚠️ 15 minutes of inactivity - session expired');
    handleSessionExpired();
  }, INACTIVITY_TIMEOUT);
}

/**
 * Initialize inactivity tracking
 * Monitors mouse, keyboard, scroll, and touch events
 */
function initInactivityTracking() {
  // Activity events to monitor
  const activityEvents = [
    'mousedown',
    'mousemove',
    'keypress',
    'scroll',
    'touchstart',
    'click'
  ];

  // Debounced activity handler (only reset timer every 1 second max)
  let activityDebounce = null;
  const handleActivity = () => {
    if (activityDebounce) return;

    activityDebounce = setTimeout(() => {
      resetInactivityTimer();
      activityDebounce = null;
    }, 1000); // Debounce to 1 second
  };

  // Add listeners for all activity events
  activityEvents.forEach(event => {
    document.addEventListener(event, handleActivity, true);
  });

  // Start initial timer
  resetInactivityTimer();

  console.log('✓ Inactivity tracking initialized (15 minute timeout)');
}

/**
 * Handle 401 Unauthorized responses globally
 * Closes any active document edit session and redirects to login
 */
async function handleSessionExpired() {
  // Prevent multiple alerts/redirects
  if (sessionExpiredHandled) return;
  sessionExpiredHandled = true;

  console.warn('⚠️ Session expired - closing edit session and redirecting to login');

  // Clear inactivity timer
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
  }

  // Close any active document edit session
  if (currentSessionId) {
    try {
      await endEditSession();
      console.log('✅ Edit session closed due to session expiration');
    } catch (error) {
      console.error('Failed to close edit session:', error);
    }
  }

  // Alert user and redirect
  alert('Your session has expired due to inactivity. Please log in again.');
  window.location.href = 'auth.html';
}

async function checkAuth() {
  try {
    const response = await fetch(`${API_URL}/api/auth/session`, {
      credentials: 'include'
    });

    const data = await response.json();

    if (data.success && data.data.authenticated) {
      const user = data.data.user;

      // Store user ID globally for WebSocket and API calls
      USER_ID = user.id;

      const userInfo = document.getElementById('userInfo');
      if (userInfo) {
        userInfo.textContent = `${user.username} (${user.email})`;
      }
      return true;
    }

    return false;
  } catch (error) {
    console.error('Auth check error:', error);
    return false;
  }
}

async function logout() {
  try {
    // HIPAA Compliance: Clear all cached PDFs from memory before logout
    clearPdfCache();

    // End any active editing sessions
    if (currentSessionId) {
      endEditSession();
    }

    const response = await fetch(`${API_URL}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include'
    });

    const data = await response.json();

    if (data.success) {
      window.location.href = 'auth.html';
    }
  } catch (error) {
    console.error('Logout error:', error);
    // Still clear cache even if logout API fails
    clearPdfCache();
    alert('Failed to logout');
  }
}

// ==========================================
// UTILITIES
// ==========================================

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);

  // For bytes, show exact count
  if (i === 0) {
    return Math.round(value) + ' ' + sizes[i];
  }

  // For KB and above, show more precision for small values
  // Use 3 decimal places if value < 1, otherwise 2 decimal places
  const decimals = value < 1 ? 3 : 2;
  const formatted = value.toFixed(decimals);

  // Remove trailing zeros but keep at least one decimal if < 1
  const trimmed = parseFloat(formatted).toString();

  return trimmed + ' ' + sizes[i];
}

function formatDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

function formatNumber(num) {
  return num.toLocaleString();
}


// ==========================================
// OLD VERSIONING CODE REMOVED
// ==========================================
// Google Docs flow replaced the old Edit button approach
// Documents are now immediately editable with auto-save
//

// GOOGLE DOCS FLOW: Session Management
// =====================================================

async function startViewSession(viewType = 'view_only') {
  if (currentSessionId) return; // Already have a session

  if (!currentTask || !currentTask.id) {
    console.error('❌ No current task for view session!');
    return;
  }

  // Generate unique view-only session ID
  currentSessionId = `view-${viewType}-${USER_ID}_${currentTask.id}_${Date.now()}`;
  console.log(`👁️ Starting ${viewType} session:`, currentSessionId);

  try {
    const response = await fetch(`${API_URL}/api/sessions/${currentTask.id}/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': USER_ID
      },
      body: JSON.stringify({
        sessionId: currentSessionId,
        viewType: viewType  // 'original_view' or 'view_only'
      })
    });

    if (response.ok) {
      console.log(`✅ ${viewType} session logged for audit trail`);
    } else {
      console.warn(`⚠️ Failed to log ${viewType} session:`, response.status);
    }
  } catch (error) {
    console.error(`Failed to start ${viewType} session:`, error);
  }
}

async function startEditSession() {
  if (currentSessionId) return; // Already started

  console.log('🔍 Starting session for currentTask:', currentTask);
  console.log('🔍 Task ID:', currentTask?.id);

  if (!currentTask || !currentTask.id) {
    console.error('❌ No current task or task ID!');
    return;
  }

  // Generate unique session ID
  currentSessionId = `${USER_ID}_${currentTask.id}_${Date.now()}`;
  console.log('🔑 Generated session ID:', currentSessionId);

  try {
    const response = await fetch(`${API_URL}/api/sessions/${currentTask.id}/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': USER_ID
      },
      body: JSON.stringify({ sessionId: currentSessionId })
    });

    if (response.ok) {
      console.log('📝 Edit session started:', currentSessionId);
      console.log('💾 Auto-save: Every 3 seconds → Database');
      console.log('📸 Snapshots: Every 5 minutes → New version');
    }
  } catch (error) {
    console.error('Failed to start session:', error);
  }
}

async function endEditSession() {
  if (!currentSessionId) return;
  if (!currentTask?.id) {
    console.log('⚠️ No current task, skipping session end');
    currentSessionId = null;
    return;
  }

  // Capture task ID at the beginning (it might be cleared during execution)
  const taskId = currentTask.id;

  // Check if this is a view-only session (starts with 'view-')
  const isViewOnlySession = currentSessionId.startsWith('view-');

  // For edit sessions, force immediate save before ending
  if (!isViewOnlySession) {
    console.log('💾 Forcing immediate save before ending session...');
    await autoSaveVersion();  // Wait for save to complete
  }

  // Get current content - save COMPLETE HTML document
  const previewContainer = document.getElementById('previewContainerCard');
  const iframe = previewContainer?.querySelector('iframe');

  // For edit sessions, try to get content from UNTXT iframe
  let htmlContent = null;
  if (!isViewOnlySession && iframe?.id === 'untxtPreview') {
    try {
      htmlContent = iframe?.contentDocument?.documentElement?.outerHTML;
    } catch (e) {
      console.warn('Could not get iframe content:', e);
    }
  }

  // ALWAYS send beacon to close session, even if content retrieval failed
  const data = new Blob([JSON.stringify({
    sessionId: currentSessionId,
    htmlContent: htmlContent || '',  // Empty if view-only or if content couldn't be retrieved
    outcome: isViewOnlySession ? 'viewed' : 'completed',
    userId: USER_ID  // Include userId in body since sendBeacon doesn't support headers
  })], { type: 'application/json' });

  const beaconSent = navigator.sendBeacon(
    `${API_URL}/api/sessions/${taskId}/end`,  // Use captured taskId
    data
  );

  if (beaconSent) {
    if (isViewOnlySession) {
      console.log('👁️ View session ended:', currentSessionId);
    } else {
      console.log('✅ Edit session ended:', currentSessionId);
      console.log('☁️ Backend will upload to S3');
    }
  } else {
    console.error('❌ Failed to send session end beacon');
  }

  currentSessionId = null;
}

// Attach session end events
window.addEventListener('beforeunload', endEditSession);
window.addEventListener('pagehide', endEditSession);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    endEditSession();
  }
});

// =====================================================
// GOOGLE DOCS FLOW: Auto-Save
// =====================================================

function setupAutoSaveGoogleDocs(iframeBody) {
  // Listen for content changes
  iframeBody.addEventListener('input', () => {
    // On first edit, upgrade from view session to edit session
    upgradeToEditSession();

    clearTimeout(autoSaveTimer);

    // Show "typing" indicator after 500ms
    setTimeout(() => {
      if (!isSaving) {
        showSaveStatus('typing');
      }
    }, 500);

    // Actually save after 3s of no typing (debounced)
    autoSaveTimer = setTimeout(autoSaveVersion, 3000);
  });

  // Also save on paste
  iframeBody.addEventListener('paste', () => {
    // On paste, upgrade from view session to edit session
    upgradeToEditSession();

    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(autoSaveVersion, 3000);
  });
}

// Upgrade from view-only session to edit session on first edit
async function upgradeToEditSession() {
  // Check if we're in a view session (starts with 'view-')
  if (currentSessionId && currentSessionId.startsWith('view-')) {
    console.log('✏️ First edit detected - upgrading to edit session');

    // End view session
    await endEditSession();

    // Start edit session
    await startEditSession();
  }
}

async function autoSaveVersion() {
  if (isSaving) return; // Prevent concurrent saves
  if (!currentSessionId) return; // No session
  if (!currentTask || !currentTask.id) return; // Task deleted or invalid

  const previewContainer = document.getElementById('previewContainerCard');
  const iframe = previewContainer?.querySelector('iframe');

  // Only auto-save UNTXT content (not Original PDF)
  if (iframe.id !== 'untxtPreview') {
    console.log('⚠️ Skipping auto-save: Not in UNTXT view');
    return;
  }

  // Save COMPLETE HTML document (including <head>, <style>, <body>)
  // This preserves all CSS and formatting from the original OCR result
  const htmlContent = iframe?.contentDocument?.documentElement?.outerHTML;

  if (!htmlContent) return;

  // Validate: Don't save corrupted content (PDF embeds)
  if (htmlContent.includes('type="application/pdf"') || htmlContent.includes('<embed')) {
    console.warn('⚠️ Skipping auto-save: Content appears corrupted with PDF embed');
    return;
  }

  // Skip if no changes
  if (htmlContent === lastSavedContent) return;

  isSaving = true;
  showSaveStatus('saving');

  try {
    // Save to backend database (backend handles snapshots every 5 minutes)
    const response = await fetch(`${API_URL}/api/versions/${currentTask.id}/save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': USER_ID
      },
      body: JSON.stringify({
        htmlContent,
        sessionId: currentSessionId,
        editReason: 'Auto-save'
      })
    });

    if (response.ok) {
      const result = await response.json();
      lastSavedContent = htmlContent;
      showSaveStatus('saved');

      // Log snapshot info
      if (result.version?.snapshot) {
        console.log(`📸 Created 5-minute snapshot v${result.version.version_number}`);
      } else if (result.version) {
        console.log(`💾 Auto-saved to database v${result.version.version_number}`);
      }
    } else if (response.status === 401) {
      // Session expired - handle globally
      console.warn('⚠️ Auto-save failed: Session expired');
      await handleSessionExpired();
      return; // Stop execution, user will be redirected
    } else {
      throw new Error('Save failed');
    }
  } catch (error) {
    console.error('Auto-save failed:', error);
    showSaveStatus('error');
  } finally {
    isSaving = false;
  }
}

function showSaveStatus(status) {
  const indicator = document.getElementById('saveIndicator');
  if (!indicator) return;

  if (status === 'typing') {
    indicator.textContent = '';
    indicator.className = 'save-indicator';
  } else if (status === 'saving') {
    indicator.textContent = '💾 Saving...';
    indicator.className = 'save-indicator saving';
  } else if (status === 'saved') {
    indicator.textContent = '✓ All changes saved';
    indicator.className = 'save-indicator saved';

    // Fade out after 2 seconds
    setTimeout(() => {
      indicator.textContent = '';
    }, 2000);
  } else if (status === 'error') {
    indicator.textContent = '⚠️ Unable to save';
    indicator.className = 'save-indicator error';
  }
}

// =====================================================
// NO CRASH RECOVERY NEEDED
// =====================================================
// All changes are saved to database every 3 seconds
// Backend handles S3 upload on session end
// No localStorage needed - database is source of truth
