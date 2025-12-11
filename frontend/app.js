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
let currentFolderId = null; // null (not selected yet), 'all', or folder UUID
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

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Check for OAuth success in URL params
  const urlParams = new URLSearchParams(window.location.search);
  const loginSuccess = urlParams.get('login');
  const linkedSuccess = urlParams.get('linked');

  if (loginSuccess === 'success') {
    // Show success message
    showNotification('Successfully signed in with Google!', 'success');

    // Clean URL
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  if (linkedSuccess === 'success') {
    // Show success message for account linking
    showNotification('Google account linked successfully!', 'success');

    // Clean URL
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  // Check if user is authenticated
  console.log('🔒 Checking authentication...');
  const isAuthenticated = await checkAuth();
  console.log('🔒 Authentication result:', isAuthenticated);

  if (!isAuthenticated) {
    console.log('❌ Not authenticated, redirecting to auth page');
    window.location.href = 'auth.html';
    return;
  }

  console.log('✅ Authenticated, loading dashboard...');

  // Initialize inactivity tracking (15 minute timeout)
  initInactivityTracking();

  initUpload();
  initFormatModal();
  initEmptyStateUpload();
  initWebSocket();
  initFolders();
  await loadFolders();
  await loadTasks();

  // Check URL parameters for project selection (reuse urlParams from above)
  const projectParam = urlParams.get('project');

  // Check if a project was selected from the sidebar or URL
  const selectedProject = projectParam || localStorage.getItem('selectedProject');
  if (selectedProject) {
    // Clear the flag
    localStorage.removeItem('selectedProject');

    console.log('📁 Auto-selecting project from sidebar:', selectedProject);

    // Wait a bit for tasks to load, then select folder
    setTimeout(() => {
      // Check if this project/folder exists
      const folderExists = folders.some(f => f.id === selectedProject);

      if (folderExists) {
        // Select the specific folder
        selectFolder(selectedProject);
      } else {
        // Folder doesn't exist, show all documents instead
        console.log('⚠️ Folder not found, showing all documents');
        selectFolder('all');
      }
    }, 500);
  } else {
    // No project selected, auto-select first folder in list
    setTimeout(() => {
      if (folders.length > 0) {
        console.log('📁 Auto-selecting first folder:', folders[0].name);
        selectFolder(folders[0].id);
      } else {
        // No folders, select "All Documents"
        selectFolder('all');
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

  // Don't render files list here - wait for folder selection
  // renderFilesList();

  // Function to open a task in inline viewer dropdown
  async function openTaskInViewer(taskId) {
    try {
      console.log('Opening task in viewer, taskId:', taskId);

      // Find the row for this task
      const row = document.querySelector(`tr.file-row[data-task-id="${taskId}"]`);
      if (!row) {
        console.error('Row not found for taskId:', taskId);
        return;
      }

      // Fetch the task details
      const response = await fetch(`${API_URL}/api/tasks/${taskId}`, {
        credentials: 'include',
        headers: { 'x-user-id': USER_ID }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch task');
      }

      const data = await response.json();
      // The task is nested in data.data.task (not just data.data)
      const task = data.data?.task || data.data;

      console.log('Task fetched:', task);
      console.log('Task ID:', task.id);

      // Set as current task
      currentTask = task;

      // Show inline viewer for this row
      await showInlineViewer(row, task);

    } catch (error) {
      console.error('Error opening task in viewer:', error);
      showToast('Failed to load document', 'error');
    }
  }

  // Function to show inline viewer below a row
  async function showInlineViewer(row, task) {
    const table = row.closest('tbody');
    const existingViewer = table.querySelector('.inline-viewer-row');

    // Close existing viewer if open
    if (existingViewer) {
      existingViewer.remove();
      const allRows = table.querySelectorAll('.file-row');
      allRows.forEach(r => {
        r.classList.remove('viewer-active');
        // Revert Close button back to View button
        const viewBtn = r.querySelector('.btn-view, .btn-close-viewer');
        if (viewBtn && viewBtn.classList.contains('btn-close-viewer')) {
          viewBtn.className = 'btn-view';
          viewBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
            View
          `;
        }
      });
    }

    // Mark this row as active
    row.classList.add('viewer-active');

    // Change View button to Close button
    const viewBtn = row.querySelector('.btn-view');
    if (viewBtn) {
      viewBtn.className = 'btn-close-viewer';
      viewBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"></path>
        </svg>
        Close
      `;
    }

    // Create inline viewer row
    const viewerRow = document.createElement('tr');
    viewerRow.className = 'inline-viewer-row';
    viewerRow.innerHTML = `
      <td colspan="6">
        <div class="inline-viewer">
          <div class="inline-viewer-tabs">
            <button class="inline-viewer-tab active" data-format="html">HTML</button>
            <button class="inline-viewer-tab" data-format="txt">TXT</button>
            <button class="inline-viewer-tab" data-format="json">JSON</button>
          </div>
          <div class="inline-viewer-download-toolbar">
            <button class="btn-download-format" data-download="html">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              Download HTML
            </button>
            <button class="btn-download-format" data-download="txt">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              Download TXT
            </button>
            <button class="btn-download-format" data-download="json">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              Download JSON
            </button>
            <button class="btn-download-all" data-download="all">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              Download All
            </button>
          </div>
          <div class="inline-viewer-content format-html" data-task-id="${task.id}">
            <p style="text-align: center; color: rgba(0,0,0,0.4); padding: 3rem;">Loading...</p>
          </div>
        </div>
      </td>
    `;

    // Insert after current row
    row.after(viewerRow);

    // Setup tab switching
    const tabs = viewerRow.querySelectorAll('.inline-viewer-tab');
    const content = viewerRow.querySelector('.inline-viewer-content');

    tabs.forEach(tab => {
      tab.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const format = tab.dataset.format;

        // Store current scroll position before any DOM changes
        const scrollY = window.pageYOffset || document.documentElement.scrollTop;

        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        content.className = `inline-viewer-content format-${format}`;

        // Use requestAnimationFrame to ensure scroll position is maintained
        requestAnimationFrame(() => {
          window.scrollTo({ top: scrollY, behavior: 'instant' });
        });

        await loadInlineViewerContent(task.id, format, content);

        // Restore scroll position again after content loads
        requestAnimationFrame(() => {
          window.scrollTo({ top: scrollY, behavior: 'instant' });
        });
      });
    });

    // Setup download buttons
    const downloadBtns = viewerRow.querySelectorAll('.btn-download-format, .btn-download-all');
    downloadBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        const downloadType = btn.dataset.download;
        if (downloadType === 'all') {
          await downloadAllFormats(task);
        } else {
          await downloadFormat(task, downloadType);
        }
      });
    });

    // Load HTML by default
    await loadInlineViewerContent(task.id, 'html', content);
  }

  // Function to close inline viewer
  function closeInlineViewer(row) {
    const table = row.closest('tbody');
    const viewerRow = table.querySelector('.inline-viewer-row');

    if (viewerRow) {
      viewerRow.remove();
    }

    row.classList.remove('viewer-active');

    // Revert Close button back to View button
    const closeBtn = row.querySelector('.btn-close-viewer');
    if (closeBtn) {
      closeBtn.className = 'btn-view';
      closeBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>
        View
      `;
    }
  }

  // Load content for inline viewer
  async function loadInlineViewerContent(taskId, format, contentElement) {
    try {
      contentElement.innerHTML = '<p style="text-align: center; color: rgba(0,0,0,0.4); padding: 3rem;">Loading...</p>';

      if (format === 'html') {
        const response = await fetch(`${API_URL}/api/tasks/${taskId}/preview`, {
          headers: { 'x-user-id': USER_ID }
        });

        if (!response.ok) throw new Error('Failed to load HTML');

        const htmlContent = await response.text();

        // Create iframe and set srcdoc directly to avoid escaping issues
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'width: 100%; height: 600px; border: none; background: white; border-radius: 4px;';
        iframe.sandbox = 'allow-same-origin allow-scripts';
        iframe.srcdoc = htmlContent;

        contentElement.innerHTML = '';
        contentElement.appendChild(iframe);
      } else if (format === 'txt') {
        const response = await fetch(`${API_URL}/api/tasks/${taskId}/txt`, {
          headers: { 'x-user-id': USER_ID }
        });

        if (!response.ok) throw new Error('Failed to load text');

        const txtContent = await response.text();
        contentElement.textContent = txtContent;
      } else if (format === 'json') {
        const response = await fetch(`${API_URL}/api/tasks/${taskId}/json`, {
          headers: { 'x-user-id': USER_ID }
        });

        if (!response.ok) throw new Error('Failed to load JSON');

        const jsonData = await response.json();
        contentElement.textContent = JSON.stringify(jsonData, null, 2);
      }
    } catch (error) {
      console.error(`Error loading ${format}:`, error);
      contentElement.innerHTML = `<p style="color: #ef4444; text-align: center; padding: 2rem;">Failed to load ${format.toUpperCase()} content</p>`;
    }
  }

  // Download format helper
  async function downloadFormat(task, format) {
    const taskId = task.id;
    const filename = task.filename.replace(/\.[^/.]+$/, '');

    try {
      let url, downloadFilename;

      if (format === 'html') {
        url = `${API_URL}/api/tasks/${taskId}/result`;
        downloadFilename = `${filename}_result.pdf`;
      } else if (format === 'txt') {
        url = `${API_URL}/api/tasks/${taskId}/txt`;
        downloadFilename = `${filename}_extracted.txt`;
      } else if (format === 'json') {
        url = `${API_URL}/api/tasks/${taskId}/json`;
        downloadFilename = `${filename}_data.json`;
      }

      const response = await fetch(url, {
        headers: { 'x-user-id': USER_ID }
      });

      if (!response.ok) throw new Error('Download failed');

      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = downloadFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);

      showToast(`Downloaded ${format.toUpperCase()}`, 'success');
    } catch (error) {
      console.error(`Error downloading ${format}:`, error);
      showToast(`Failed to download ${format.toUpperCase()}`, 'error');
    }
  }

  // Download all formats
  async function downloadAllFormats(task) {
    await downloadFormat(task, 'html');
    setTimeout(() => downloadFormat(task, 'txt'), 200);
    setTimeout(() => downloadFormat(task, 'json'), 400);
    showToast('Downloading all formats...', 'info');
  }

  // Handle View/Close button clicks - open or close task in viewer
  document.addEventListener('click', async (e) => {
    // Handle View button - open viewer
    const viewBtn = e.target.closest('.btn-view');
    if (viewBtn) {
      e.stopPropagation();
      const taskId = viewBtn.dataset.taskId;
      if (taskId) {
        await openTaskInViewer(taskId);
      }
      return;
    }

    // Handle Close button - close viewer
    const closeBtn = e.target.closest('.btn-close-viewer');
    if (closeBtn) {
      e.stopPropagation();
      const row = closeBtn.closest('.file-row');
      if (row) {
        closeInlineViewer(row);
      }
    }
  });

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

    // Always use list view
    documentGrid.classList.add('list-view');
    listViewBtn.classList.add('active');
    gridViewBtn.classList.remove('active');
    localStorage.setItem('viewMode', 'list');
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

  // Setup main document viewer
  setupMainDocumentViewer();
  setupMainViewerDownloadButtons();
});

// ==========================================
// MAIN DOCUMENT VIEWER - TAB SWITCHING
// ==========================================

function setupMainDocumentViewer() {
  const tabs = document.querySelectorAll('#mainTabHtml, #mainTabTxt, #mainTabJson');
  const content = document.getElementById('mainViewerContent');
  const contentWrapper = document.getElementById('mainViewerContentWrapper');
  const jsonSelector = document.getElementById('mainJsonSelector');

  if (!tabs.length || !content) return;

  tabs.forEach(tab => {
    tab.addEventListener('click', async () => {
      const format = tab.dataset.format;

      // Update active tab
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Update content class
      content.className = `inline-viewer-content format-${format}`;

      // Load content for selected format
      await loadMainViewerContent(format);
    });
  });
}

async function loadMainViewerContent(format) {
  const content = document.getElementById('mainViewerContent');
  const contentWrapper = document.getElementById('mainViewerContentWrapper');
  const jsonSelector = document.getElementById('mainJsonSelector');

  if (!currentTask || !currentTask.id) {
    content.innerHTML = '<p style="text-align: center; color: rgba(0,0,0,0.4); padding: 3rem;">No document selected</p>';
    return;
  }

  const taskId = currentTask.id;

  try {
    if (format === 'html') {
      // Hide JSON selector
      jsonSelector.style.display = 'none';
      contentWrapper.classList.remove('has-json-sidebar');

      // Load HTML preview in iframe
      content.innerHTML = `
        <iframe
          id="htmlPreviewFrame"
          style="width: 100%; height: 600px; border: none; background: white; border-radius: 4px;"
          sandbox="allow-same-origin"
        ></iframe>
      `;

      const response = await fetch(`${API_URL}/api/tasks/${taskId}/preview`, {
        headers: { 'x-user-id': USER_ID }
      });

      if (!response.ok) throw new Error('Failed to load HTML');

      const htmlContent = await response.text();
      const iframe = document.getElementById('htmlPreviewFrame');
      iframe.srcdoc = htmlContent;

    } else if (format === 'txt') {
      // Hide JSON selector
      jsonSelector.style.display = 'none';
      contentWrapper.classList.remove('has-json-sidebar');

      // Load TXT content
      content.textContent = 'Loading text...';

      const response = await fetch(`${API_URL}/api/tasks/${taskId}/txt`, {
        headers: { 'x-user-id': USER_ID }
      });

      if (!response.ok) throw new Error('Failed to load text');

      const txtContent = await response.text();
      content.textContent = txtContent;

    } else if (format === 'json') {
      // Show JSON selector
      jsonSelector.style.display = 'flex';
      contentWrapper.classList.add('has-json-sidebar');

      // Load JSON content
      content.textContent = 'Loading JSON...';

      const response = await fetch(`${API_URL}/api/tasks/${taskId}/json`, {
        headers: { 'x-user-id': USER_ID }
      });

      if (!response.ok) throw new Error('Failed to load JSON');

      const jsonData = await response.json();
      content.textContent = JSON.stringify(jsonData, null, 2);

      // Initialize JSON field selector (reuse existing function if available)
      const mainViewer = document.querySelector('.main-document-viewer');
      if (mainViewer && typeof initJsonFieldSelector === 'function') {
        initJsonFieldSelector(mainViewer, JSON.stringify(jsonData), currentTask.filename);
      }
    }

  } catch (error) {
    console.error(`Error loading ${format}:`, error);
    content.innerHTML = `<p style="color: #ef4444; text-align: center; padding: 2rem;">Failed to load ${format.toUpperCase()} content</p>`;
  }
}

function setupMainViewerDownloadButtons() {
  const downloadHtml = document.getElementById('mainDownloadHtml');
  const downloadTxt = document.getElementById('mainDownloadTxt');
  const downloadJson = document.getElementById('mainDownloadJson');
  const downloadAll = document.getElementById('mainDownloadAll');

  if (downloadHtml) {
    downloadHtml.addEventListener('click', () => downloadMainViewerFormat('html'));
  }
  if (downloadTxt) {
    downloadTxt.addEventListener('click', () => downloadMainViewerFormat('txt'));
  }
  if (downloadJson) {
    downloadJson.addEventListener('click', () => downloadMainViewerFormat('json'));
  }
  if (downloadAll) {
    downloadAll.addEventListener('click', () => downloadAllMainViewerFormats());
  }
}

async function downloadMainViewerFormat(format) {
  if (!currentTask || !currentTask.id) return;

  const taskId = currentTask.id;
  const filename = currentTask.filename.replace(/\.[^/.]+$/, '');

  try {
    let url, downloadFilename;

    if (format === 'html') {
      url = `${API_URL}/api/tasks/${taskId}/result`; // Downloads as PDF
      downloadFilename = `${filename}_result.pdf`;
    } else if (format === 'txt') {
      url = `${API_URL}/api/tasks/${taskId}/txt`;
      downloadFilename = `${filename}_extracted.txt`;
    } else if (format === 'json') {
      url = `${API_URL}/api/tasks/${taskId}/json`;
      downloadFilename = `${filename}_data.json`;
    }

    const response = await fetch(url, {
      headers: { 'x-user-id': USER_ID }
    });

    if (!response.ok) throw new Error('Download failed');

    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = downloadFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);

    showToast(`Downloaded ${format.toUpperCase()}`, 'success');

  } catch (error) {
    console.error(`Error downloading ${format}:`, error);
    showToast(`Failed to download ${format.toUpperCase()}`, 'error');
  }
}

async function downloadAllMainViewerFormats() {
  await downloadMainViewerFormat('html');
  setTimeout(() => downloadMainViewerFormat('txt'), 200);
  setTimeout(() => downloadMainViewerFormat('json'), 400);
  showToast('Downloading all formats...', 'info');
}

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

    // Load HTML tab content in main viewer
    loadMainViewerContent('html');

    // Update viewer title
    const viewerDocTitle = document.getElementById('viewerDocTitle');
    if (viewerDocTitle) {
      viewerDocTitle.textContent = task.filename;
    }
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

async function renderFilesList() {
  const grid = document.getElementById('documentGrid');

  // Don't render if no folder is selected yet
  if (currentFolderId === null) {
    grid.innerHTML = '<p style="text-align: center; color: rgba(0,0,0,0.4); padding: 3rem;">Loading...</p>';
    return;
  }

  // Filter tasks by current folder
  let filteredTasks = tasks;
  if (currentFolderId && currentFolderId !== 'all') {
    filteredTasks = tasks.filter(task => task.folder_id === currentFolderId);
  }

  // If no tasks, show empty state
  if (filteredTasks.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>
        <p>No documents in this folder</p>
        <small>Upload files or drag existing files into this folder to organize them</small>
      </div>
    `;
    return;
  }

  grid.innerHTML = `
    <div class="files-list-container">
      <table class="files-table">
        <thead>
          <tr>
            <th class="checkbox-col">
              <input type="checkbox" id="selectAllFiles" class="file-checkbox">
            </th>
            <th class="sortable">Name</th>
            <th class="sortable"># of Pages</th>
            <th class="sortable">Status</th>
            <th>Action</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${filteredTasks.map(task => {
            const isCompleted = task.status === 'completed';
            const isProcessing = task.status === 'processing' || task.status === 'pending';
            const isFailed = task.status === 'failed';

            // Render status cell differently for processing files
            let statusCell;
            if (isProcessing) {
              statusCell = `<span class="status-badge status-processing">Processing...</span>`;
            } else if (isFailed) {
              statusCell = `<span class="status-badge status-failed">Failed</span>`;
            } else {
              statusCell = `<span class="status-badge status-completed">Completed</span>`;
            }

            // Action button - only show View for completed files
            let actionButton = '';
            if (isCompleted) {
              actionButton = `
                <button class="btn-view" data-task-id="${task.id}">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                  View
                </button>
              `;
            }

            return `
              <tr class="file-row" data-task-id="${task.id}">
                <td class="checkbox-col">
                  <input type="checkbox" class="file-checkbox" data-file-name="${task.filename}">
                </td>
                <td class="file-name">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                  </svg>
                  ${task.filename}
                </td>
                <td class="file-pages">${task.page_count || '-'}</td>
                <td class="file-status">
                  ${statusCell}
                </td>
                <td class="file-action">
                  ${actionButton}
                </td>
                <td class="file-menu-cell">
                  <button class="file-menu-btn" data-file="${task.filename}" data-task-id="${task.id}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="12" cy="12" r="2"></circle>
                      <circle cx="5" cy="12" r="2"></circle>
                      <circle cx="19" cy="12" r="2"></circle>
                    </svg>
                  </button>
                  <div class="file-context-menu" data-file="${task.filename}" data-task-id="${task.id}">
                    <button class="context-menu-item" data-action="download">
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
  `;

  // Setup "Select All" checkbox functionality
  const selectAllCheckbox = document.getElementById('selectAllFiles');
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', (e) => {
      const fileCheckboxes = document.querySelectorAll('.file-checkbox:not(#selectAllFiles)');
      fileCheckboxes.forEach(checkbox => {
        checkbox.checked = e.target.checked;
      });
    });
  }

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
      } else if (action === 'download') {
        console.log(`Download original: ${fileName}`);
        // TODO: Implement download original API call
      } else if (action === 'delete') {
        if (confirm(`Delete "${fileName}"?`)) {
          console.log(`Delete: ${fileName}`);
          // TODO: Implement delete API call
        }
      }
    });
  });
}

// ==========================================
// INLINE VIEWER
// ==========================================

// Mock document data removed - all data now comes from backend API
const mockDocuments_REMOVED = {
  'annual-report-2024.pdf': {
    html: `<h1>Annual Report 2024</h1>
      <p>This comprehensive annual report provides a detailed overview of our company's performance throughout the fiscal year 2024. Our organization has demonstrated remarkable resilience and growth despite challenging market conditions, achieving significant milestones across all business units.</p>

      <h2>Executive Summary</h2>
      <p>The year 2024 marked a transformative period for our organization. We successfully expanded into three new markets, launched five innovative product lines, and strengthened our position as an industry leader. Our strategic initiatives focused on digital transformation, customer experience enhancement, and operational excellence have yielded exceptional results.</p>
      <p>Key highlights include a 23% increase in year-over-year revenue, successful integration of acquired subsidiaries, and the establishment of strategic partnerships with major industry players. Our commitment to sustainability and corporate social responsibility has also been recognized with several prestigious awards.</p>

      <h2>Financial Summary</h2>
      <p><strong>Revenue:</strong> $1,234,567,890</p>
      <p><strong>Operating Expenses:</strong> $890,123,456</p>
      <p><strong>Net Income:</strong> $344,444,434</p>
      <p><strong>EBITDA:</strong> $456,789,012</p>
      <p><strong>Total Assets:</strong> $2,345,678,901</p>
      <p><strong>Shareholder Equity:</strong> $1,567,890,123</p>

      <h2>Market Performance</h2>
      <p>Our stock price increased by 34% over the fiscal year, outperforming the broader market index by 12 percentage points. We successfully completed two debt refinancing operations, reducing our overall cost of capital and improving our credit rating to AA+. The company declared quarterly dividends totaling $2.50 per share, representing a 15% increase from the previous year.</p>
      <p>Trading volume reached record highs, with average daily transactions exceeding 5 million shares. Our market capitalization grew to $8.9 billion, placing us among the top 50 companies in our sector globally.</p>

      <h2>Operational Highlights</h2>
      <p>Our operational efficiency improved dramatically through the implementation of advanced automation systems and AI-driven analytics. Manufacturing output increased by 28% while maintaining quality standards, and our supply chain optimization initiatives reduced logistics costs by 17%.</p>
      <p>Customer satisfaction scores reached an all-time high of 94%, driven by our enhanced customer service platform and personalized engagement strategies. We processed over 12 million customer transactions with a 99.7% satisfaction rate.</p>

      <h2>Future Outlook</h2>
      <p>Looking ahead to 2025, we are well-positioned for continued growth and innovation. Our pipeline includes several high-potential projects in emerging technologies, planned expansions into Asian and Latin American markets, and strategic investments in sustainable business practices.</p>
      <p>We anticipate revenue growth of 18-22% in the coming year, supported by strong demand for our core products and successful market penetration of new offerings. Our board has approved a capital expenditure budget of $450 million for infrastructure upgrades and technology investments.</p>`,
    txt: `Annual Report 2024

This comprehensive annual report provides a detailed overview of our company's performance throughout the fiscal year 2024. Our organization has demonstrated remarkable resilience and growth despite challenging market conditions, achieving significant milestones across all business units.

Executive Summary
The year 2024 marked a transformative period for our organization. We successfully expanded into three new markets, launched five innovative product lines, and strengthened our position as an industry leader. Our strategic initiatives focused on digital transformation, customer experience enhancement, and operational excellence have yielded exceptional results.

Key highlights include a 23% increase in year-over-year revenue, successful integration of acquired subsidiaries, and the establishment of strategic partnerships with major industry players. Our commitment to sustainability and corporate social responsibility has also been recognized with several prestigious awards.

Financial Summary
Revenue: $1,234,567,890
Operating Expenses: $890,123,456
Net Income: $344,444,434
EBITDA: $456,789,012
Total Assets: $2,345,678,901
Shareholder Equity: $1,567,890,123

Market Performance
Our stock price increased by 34% over the fiscal year, outperforming the broader market index by 12 percentage points. We successfully completed two debt refinancing operations, reducing our overall cost of capital and improving our credit rating to AA+. The company declared quarterly dividends totaling $2.50 per share, representing a 15% increase from the previous year.

Trading volume reached record highs, with average daily transactions exceeding 5 million shares. Our market capitalization grew to $8.9 billion, placing us among the top 50 companies in our sector globally.

Operational Highlights
Our operational efficiency improved dramatically through the implementation of advanced automation systems and AI-driven analytics. Manufacturing output increased by 28% while maintaining quality standards, and our supply chain optimization initiatives reduced logistics costs by 17%.

Customer satisfaction scores reached an all-time high of 94%, driven by our enhanced customer service platform and personalized engagement strategies. We processed over 12 million customer transactions with a 99.7% satisfaction rate.

Future Outlook
Looking ahead to 2025, we are well-positioned for continued growth and innovation. Our pipeline includes several high-potential projects in emerging technologies, planned expansions into Asian and Latin American markets, and strategic investments in sustainable business practices.

We anticipate revenue growth of 18-22% in the coming year, supported by strong demand for our core products and successful market penetration of new offerings. Our board has approved a capital expenditure budget of $450 million for infrastructure upgrades and technology investments.`,
    json: JSON.stringify({
      title: 'Annual Report 2024',
      company_name: 'Acme Corporation',
      fiscal_year: 2024,
      report_type: 'annual',
      report_date: '2024-12-31',
      pages: 156,
      revenue: 1234567890,
      operating_expenses: 890123456,
      net_income: 344444434,
      ebitda: 456789012,
      total_assets: 2345678901,
      shareholder_equity: 1567890123,
      stock_price_change: '34%',
      market_cap: '8.9B',
      credit_rating: 'AA+',
      quarterly_dividend: 2.50,
      dividend_yield: 2.8,
      earnings_per_share: 12.45,
      price_to_earnings: 18.2,
      return_on_equity: 22.0,
      debt_to_equity: 0.49,
      current_ratio: 2.1,
      employee_count: 8450,
      offices_worldwide: 34,
      countries_operating: 67,
      ceo_name: 'Jane Thompson',
      cfo_name: 'Michael Chen',
      auditor: 'Ernst & Young LLP',
      processed_date: '2025-01-15',
      file_size_mb: 12.8,
      language: 'English',
      customer_satisfaction: 94
    }, null, 2)
  },
  'invoice_march.pdf': {
    html: '<h1>Invoice</h1><p><strong>Invoice #:</strong> INV-2024-003</p><p><strong>Date:</strong> March 1, 2024</p><h2>Line Items</h2><ul><li>Service A - $100.00</li><li>Service B - $56.00</li></ul><p><strong>Total:</strong> $156.00</p>',
    txt: 'Invoice\n\nInvoice #: INV-2024-003\nDate: March 1, 2024\n\nLine Items\n- Service A - $100.00\n- Service B - $56.00\n\nTotal: $156.00',
    json: JSON.stringify({
      invoice_number: 'INV-2024-003',
      date: '2024-03-01',
      line_items: [
        { description: 'Service A', amount: 100.00 },
        { description: 'Service B', amount: 56.00 }
      ],
      total: 156.00,
      currency: 'USD'
    }, null, 2)
  },
  'meeting-notes.pdf': {
    html: '<h1>Meeting Notes</h1><p><strong>Date:</strong> January 12, 2025</p><h2>Attendees</h2><ul><li>John Doe</li><li>Jane Smith</li><li>Bob Johnson</li></ul><h2>Agenda</h2><ol><li>Project Updates</li><li>Budget Review</li><li>Next Steps</li></ol>',
    txt: 'Meeting Notes\n\nDate: January 12, 2025\n\nAttendees\n- John Doe\n- Jane Smith\n- Bob Johnson\n\nAgenda\n1. Project Updates\n2. Budget Review\n3. Next Steps',
    json: JSON.stringify({
      meeting_date: '2025-01-12',
      attendees: ['John Doe', 'Jane Smith', 'Bob Johnson'],
      agenda: ['Project Updates', 'Budget Review', 'Next Steps'],
      type: 'meeting_notes'
    }, null, 2)
  },
  'contract_final.pdf': {
    html: '<h1>Contract Agreement</h1><p>This agreement entered into on January 10, 2025...</p>',
    txt: 'Contract Agreement\n\nThis agreement entered into on January 10, 2025...',
    json: JSON.stringify({ type: 'contract', date: '2025-01-10' }, null, 2)
  },
  'presentation-slides.pdf': {
    html: '<h1>Presentation</h1><p>Slide content here...</p>',
    txt: 'Presentation\n\nSlide content here...',
    json: JSON.stringify({ type: 'presentation', slides: 67 }, null, 2)
  }
};

function toggleInlineViewer(row, fileName) {
  const table = row.closest('tbody');
  const existingViewer = table.querySelector('.inline-viewer-row');
  const viewBtn = row.querySelector('.btn-view');

  // If viewer is already open, close it
  if (existingViewer) {
    existingViewer.classList.add('closing');
    // Remove class from the row
    const openRow = table.querySelector('.file-row.has-drawer-open');

    // Restore button to "View"
    if (viewBtn) {
      viewBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>
        View
      `;
    }

    setTimeout(() => {
      if (openRow) {
        openRow.classList.remove('has-drawer-open');
      }
      existingViewer.remove();
    }, 400);
    return;
  }

  // Transform button to "Close"
  if (viewBtn) {
    viewBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 6L6 18M6 6l12 12"></path>
      </svg>
      Close
    `;
  }

  // Add class to current row
  row.classList.add('has-drawer-open');

  // Get document data from backend API (mock data removed)
  // This inline viewer is deprecated - use the main viewer instead
  const docData = {
    html: '<p>Use the main viewer to see document content</p>',
    txt: 'Use the main viewer to see document content',
    json: JSON.stringify({ note: 'Use the main viewer to see document content' }, null, 2)
  };

  // Create viewer row
  const viewerRow = document.createElement('tr');
  viewerRow.className = 'inline-viewer-row';
  viewerRow.innerHTML = `
    <td colspan="6">
      <div class="inline-viewer-slide-wrapper">
        <div class="inline-viewer">
          <div class="inline-viewer-header">
            <h3 class="inline-viewer-title">${fileName}</h3>
          </div>

          <div class="inline-viewer-tabs">
            <button class="inline-viewer-tab active" data-format="html">HTML</button>
            <button class="inline-viewer-tab" data-format="txt">TXT</button>
            <button class="inline-viewer-tab" data-format="json">JSON</button>
          </div>

          <div class="inline-viewer-download-toolbar">
            <button class="btn-download-format" data-download="html">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
              </svg>
              Download HTML
            </button>
            <button class="btn-download-format" data-download="txt">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
              </svg>
              Download TXT
            </button>
            <button class="btn-download-format" data-download="json">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
              </svg>
              Download JSON
            </button>
            <button class="btn-download-all" data-download="all">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
              </svg>
              Download All
            </button>
          </div>

          <div class="inline-viewer-content-wrapper">
            <div class="json-field-selector" style="display: none;">
              <div class="json-selector-header">
                <button class="json-preset-dropdown" type="button">
                  <span class="json-preset-text">Select Preset...</span>
                  <svg class="json-preset-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M6 9l6 6 6-6"></path>
                  </svg>
                </button>
                <div class="json-preset-menu" style="display: none;"></div>
              </div>
              <div class="json-field-list"></div>
              <div class="json-selector-actions">
                <input type="text" class="json-preset-name" placeholder="Preset name..." />
                <button class="btn-save-preset">Save Preset</button>
              </div>
            </div>
            <div class="inline-viewer-content format-html">${docData.html}</div>
          </div>
        </div>
      </div>
    </td>
  `;

  // Insert viewer after current row
  row.after(viewerRow);

  // Setup tab switching
  const tabs = viewerRow.querySelectorAll('.inline-viewer-tab');
  const content = viewerRow.querySelector('.inline-viewer-content');
  const jsonSelector = viewerRow.querySelector('.json-field-selector');
  const contentWrapper = viewerRow.querySelector('.inline-viewer-content-wrapper');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const format = tab.dataset.format;
      content.className = `inline-viewer-content format-${format}`;

      if (format === 'html') {
        content.innerHTML = docData.html;
        jsonSelector.style.display = 'none';
        contentWrapper.classList.remove('has-json-sidebar');
      } else if (format === 'txt') {
        content.textContent = docData.txt;
        jsonSelector.style.display = 'none';
        contentWrapper.classList.remove('has-json-sidebar');
      } else if (format === 'json') {
        jsonSelector.style.display = 'flex';
        contentWrapper.classList.add('has-json-sidebar');
        initJsonFieldSelector(viewerRow, docData.json, fileName);
      }
    });
  });

  // Setup download buttons
  const downloadButtons = viewerRow.querySelectorAll('[data-download]');
  downloadButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const downloadType = btn.dataset.download;

      if (downloadType === 'all') {
        // Download all three formats as a ZIP (for now, download individually)
        downloadFile(docData.html, `${fileName}.html`, 'text/html');
        setTimeout(() => downloadFile(docData.txt, `${fileName}.txt`, 'text/plain'), 100);
        setTimeout(() => downloadFile(docData.json, `${fileName}.json`, 'application/json'), 200);
      } else if (downloadType === 'html') {
        downloadFile(docData.html, `${fileName}.html`, 'text/html');
      } else if (downloadType === 'txt') {
        downloadFile(docData.txt, `${fileName}.txt`, 'text/plain');
      } else if (downloadType === 'json') {
        downloadFile(docData.json, `${fileName}.json`, 'application/json');
      }
    });
  });
}

// Helper function to trigger file download
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ==========================================
// JSON FIELD SELECTOR & PRESET MANAGEMENT
// ==========================================

function initJsonFieldSelector(viewerRow, jsonString, fileName) {
  const jsonData = JSON.parse(jsonString);
  const fields = extractJsonFields(jsonData);
  const fieldList = viewerRow.querySelector('.json-field-list');
  const content = viewerRow.querySelector('.inline-viewer-content');
  const presetDropdown = viewerRow.querySelector('.json-preset-dropdown');
  const presetText = viewerRow.querySelector('.json-preset-text');
  const presetMenu = viewerRow.querySelector('.json-preset-menu');
  const presetNameInput = viewerRow.querySelector('.json-preset-name');
  const savePresetBtn = viewerRow.querySelector('.btn-save-preset');

  // Load saved presets
  loadPresetsIntoMenu(presetMenu);

  // Toggle dropdown menu
  presetDropdown.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = presetMenu.style.display === 'block';
    presetMenu.style.display = isOpen ? 'none' : 'block';
    presetDropdown.classList.toggle('open', !isOpen);
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', () => {
    presetMenu.style.display = 'none';
    presetDropdown.classList.remove('open');
  });

  // Populate field checkboxes
  fieldList.innerHTML = '';
  fields.forEach(field => {
    const label = document.createElement('label');
    label.className = 'json-field-item';
    label.innerHTML = `
      <input type="checkbox" value="${field}" checked />
      <span>${field}</span>
    `;
    fieldList.appendChild(label);
  });

  // Update JSON when checkboxes change
  const checkboxes = fieldList.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      updateFilteredJson(jsonData, checkboxes, content);
    });
  });

  // Handle preset selection
  presetMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.json-preset-item');
    if (!item) return;

    const presetValue = item.dataset.value;
    presetText.textContent = item.textContent;
    presetMenu.style.display = 'none';
    presetDropdown.classList.remove('open');

    if (presetValue === '__all__') {
      checkboxes.forEach(cb => cb.checked = true);
      updateFilteredJson(jsonData, checkboxes, content);
    } else {
      const presets = getPresets();
      const preset = presets.find(p => p.name === presetValue);
      if (preset) {
        checkboxes.forEach(cb => {
          cb.checked = preset.fields.includes(cb.value);
        });
        updateFilteredJson(jsonData, checkboxes, content);
      }
    }
  });

  // Save preset button
  savePresetBtn.addEventListener('click', () => {
    const presetName = presetNameInput.value.trim();
    if (!presetName) {
      alert('Please enter a preset name');
      return;
    }

    const selectedFields = Array.from(checkboxes)
      .filter(cb => cb.checked)
      .map(cb => cb.value);

    if (selectedFields.length === 0) {
      alert('Please select at least one field');
      return;
    }

    savePreset(presetName, selectedFields);
    loadPresetsIntoMenu(presetMenu);
    presetNameInput.value = '';
    alert(`Preset "${presetName}" saved!`);
  });

  // Initial render
  updateFilteredJson(jsonData, checkboxes, content);
}

function extractJsonFields(obj) {
  let fields = [];
  for (const key in obj) {
    if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      fields = fields.concat(extractJsonFields(obj[key]));
    } else {
      fields.push(key);
    }
  }
  return fields;
}

function updateFilteredJson(jsonData, checkboxes, contentElement) {
  const selectedFields = Array.from(checkboxes)
    .filter(cb => cb.checked)
    .map(cb => cb.value);

  const filteredData = filterJsonByFields(jsonData, selectedFields);
  contentElement.textContent = JSON.stringify(filteredData, null, 2);
}

function filterJsonByFields(obj, fields) {
  const result = {};
  fields.forEach(field => {
    if (field in obj) {
      result[field] = obj[field];
    }
  });
  return result;
}

function getPresets() {
  const presetsJson = localStorage.getItem('jsonPresets');
  return presetsJson ? JSON.parse(presetsJson) : [];
}

function savePreset(name, fields) {
  const presets = getPresets();
  const existingIndex = presets.findIndex(p => p.name === name);

  if (existingIndex >= 0) {
    presets[existingIndex].fields = fields;
  } else {
    presets.push({ name, fields });
  }

  localStorage.setItem('jsonPresets', JSON.stringify(presets));
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

  // Add saved presets
  presets.forEach(preset => {
    const item = document.createElement('div');
    item.className = 'json-preset-item';
    item.dataset.value = preset.name;
    item.textContent = preset.name;
    menu.appendChild(item);
  });
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

async function processFileUpload(files, formats) {
  console.log('Processing upload with formats:', formats);
  console.log('Files:', files);

  // Upload each file using the existing handleFileUpload function
  // The backend currently processes all formats (HTML + JSON) by default
  for (const file of files) {
    try {
      await handleFileUpload(file);
    } catch (error) {
      console.error('Upload failed:', error);
      showNotification('Upload failed: ' + error.message, 'error');
    }
  }
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
      showFormatModal(e.target.files);
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
        showFormatModal(e.dataTransfer.files);
      }
    });
  }
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

// ==========================================
// CREDITS CHECK
// ==========================================

/**
 * Check if user has sufficient credits before upload
 * @returns {Promise<boolean>} True if user has credits, false otherwise
 */
async function checkCreditsBeforeUpload() {
  try {
    // Get current balance from API
    const response = await fetch(`${API_URL}/api/credits/balance`, {
      credentials: 'include'
    });

    if (!response.ok) {
      console.error('Failed to fetch credit balance');
      // Fail open - allow upload if check fails for better UX
      return true;
    }

    const data = await response.json();
    const balance = data.data.balance || 0;

    if (balance < 1) {
      // Show insufficient credits modal
      showInsufficientCreditsModal(balance);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error checking credits:', error);
    // Fail open - allow upload if check fails
    return true;
  }
}

/**
 * Show modal when user has insufficient credits
 * @param {number} balance - Current credit balance
 */
function showInsufficientCreditsModal(balance) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay active';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2>Insufficient Credits</h2>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <p style="margin-bottom: 1rem;">You need at least 1 credit to upload a document.</p>
        <p style="margin-bottom: 1rem;">Current balance: <strong>${balance} credits</strong></p>
        <p style="color: var(--gray-600); font-size: 0.875rem;">Each page costs 1 credit to process.</p>
      </div>
      <div class="modal-footer" style="display: flex; gap: 0.75rem; justify-content: flex-end;">
        <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
        <button class="btn-primary" onclick="window.location.href='settings.html#credits'">Buy Credits</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Close on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });

  // Close on ESC key
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      modal.remove();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

async function handleFileUpload(file) {
  // Check credits before upload
  const hasCredits = await checkCreditsBeforeUpload();
  if (!hasCredits) {
    return; // Stop upload if insufficient credits
  }

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

      // Update credit balance if provided in response
      if (data.data.creditsRemaining !== null && data.data.creditsRemaining !== undefined) {
        console.log(`✓ Credits deducted. Remaining balance: ${data.data.creditsRemaining}`);
        // Refresh sidebar credits display
        if (typeof SidebarNav !== 'undefined') {
          SidebarNav.loadCredits();
        }
      }

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
      renderFilesList(); // Refresh to show clean state
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
      openNewProjectModal();
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

  // Save folder button (also handles form submission)
  const saveFolderBtn = document.getElementById('saveFolderBtn');
  if (saveFolderBtn) {
    saveFolderBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await handleFolderSubmit();
    });
  }
}

// Open new project modal (called from sidebar-nav.js)
function openNewProjectModal() {
  isEditingFolder = false;
  editingFolderId = null;
  document.getElementById('folderForm').reset();
  document.getElementById('folderModalTitle').textContent = 'Create New Project';
  document.getElementById('saveFolderBtn').textContent = 'Create Project';
  document.getElementById('newFolderModal').classList.add('active');
}

// Make it globally accessible
window.openNewProjectModal = openNewProjectModal;

async function loadFolders() {
  try {
    const response = await fetch(`${API_URL}/api/folders`, {
      credentials: 'include'
    });

    const data = await response.json();

    if (data.success) {
      folders = data.folders;

      // Cache projects for instant loading on other pages
      localStorage.setItem('sidebarProjects', JSON.stringify(folders));

      renderFolders();
      updateFolderCounts();
      console.log(`✓ Folders loaded: ${folders.length} total`);
    }
  } catch (error) {
    console.error('Failed to load folders:', error);
  }
}

function renderFolders() {
  // Sidebar projects are managed by sidebar-nav.js
  // Just notify it to update if needed
  if (typeof SidebarNav !== 'undefined' && SidebarNav.renderProjects) {
    SidebarNav.renderProjects(folders);
  }

  // Setup click handlers for project items (for app.js selectFolder functionality)
  setupProjectClickHandlers();

  // Render Folders List (existing code)
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
    if (!e.target.closest('.project-item-wrapper')) {
      document.querySelectorAll('.project-context-menu.active').forEach(m => {
        m.classList.remove('active');
      });
    }
  });

  // Make folder items drop targets for drag and drop
  enableFolderDropTargets();
}

// Setup click handlers for project items in sidebar (app.js specific)
function setupProjectClickHandlers() {
  document.querySelectorAll('.project-item[data-project-id]').forEach(link => {
    // Remove existing listeners to avoid duplicates
    const newLink = link.cloneNode(true);
    link.parentNode.replaceChild(newLink, link);

    newLink.addEventListener('click', (e) => {
      e.preventDefault();
      const projectId = newLink.dataset.projectId;
      selectFolder(projectId);
    });
  });
}

function selectFolder(folderId) {
  currentFolderId = folderId;

  // Save to localStorage so it persists on reload
  localStorage.setItem('selectedProject', folderId);

  // Close any open menus
  document.querySelectorAll('.folder-menu.show').forEach(m => {
    m.classList.remove('show');
  });

  // Update active state on folder items
  document.querySelectorAll('.folder-item').forEach(item => {
    item.classList.remove('active');
  });

  const selectedFolder = document.querySelector(`[data-folder-id="${folderId}"]`);
  if (selectedFolder) {
    selectedFolder.classList.add('active');
  }

  // Update active state on project items in sidebar
  document.querySelectorAll('.project-item').forEach(item => {
    item.classList.remove('active');
  });

  const selectedProject = document.querySelector(`.project-item[data-project-id="${folderId}"]`);
  if (selectedProject) {
    selectedProject.classList.add('active');
  }

  // Update page heading with folder name
  const projectNameHeader = document.getElementById('projectNameHeader');
  if (projectNameHeader) {
    if (folderId === 'all') {
      projectNameHeader.textContent = 'All Files';
    } else {
      const folder = folders.find(f => f.id === folderId);
      projectNameHeader.textContent = folder ? folder.name : 'Documents';
    }
  }

  // Filter tasks in main area
  renderFilesList();

  // If in viewer mode (viewing a document), show folder documents list in sidebar
  const viewerView = document.getElementById('viewerView');
  if (viewerView && viewerView.classList.contains('active')) {
    showFolderDocumentsListInViewer(folderId);
  }

  console.log(`📁 Selected folder: ${folderId === 'all' ? 'All Files' : folders.find(f => f.id === folderId)?.name}`);
}

function showFolderDocumentsListInViewer(folderId) {
  const headerTitle = document.getElementById('foldersHeaderTitle');
  const backBtn = document.getElementById('backToFoldersBtn');
  const foldersList = document.getElementById('foldersList');

  // Get folder info or use "All Files"
  let folderName = 'All Files';
  let folderColor = null;

  if (folderId && folderId !== 'all') {
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

        // If we're editing the currently selected folder, update the header
        if (editingFolderId === currentFolderId) {
          const projectNameHeader = document.getElementById('projectNameHeader');
          if (projectNameHeader) {
            projectNameHeader.textContent = name;
          }
        }
      }

      const action = isEditingFolder ? 'updated' : 'created';
      console.log(`✓ Folder ${action}: ${name}`);
      showToast(`Folder ${action}: ${name}`, 'success');
    } else {
      showToast(data.error || 'Failed to save folder', 'error');
    }
  } catch (error) {
    console.error('Failed to save folder:', error);
    showToast('Failed to save folder: ' + error.message, 'error');
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

// Make functions globally accessible for sidebar
window.editFolder = editFolder;

// Show delete confirmation modal
function showDeleteConfirmation(folderName, taskCount, onConfirm) {
  const modal = document.getElementById('deleteConfirmModal');
  const title = document.getElementById('deleteConfirmTitle');
  const message = document.getElementById('deleteConfirmMessage');
  const confirmBtn = document.getElementById('confirmDeleteBtn');
  const cancelBtn = document.getElementById('cancelDeleteBtn');

  title.textContent = `Delete "${folderName}"?`;
  message.textContent = taskCount > 0
    ? `${taskCount} document(s) will be moved to "All Documents".`
    : 'This project will be deleted permanently.';

  modal.classList.add('show');

  // Remove any existing listeners
  const newConfirmBtn = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
  const newCancelBtn = cancelBtn.cloneNode(true);
  cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

  // Add new listeners
  newConfirmBtn.addEventListener('click', () => {
    modal.classList.remove('show');
    onConfirm();
  });

  newCancelBtn.addEventListener('click', () => {
    modal.classList.remove('show');
  });

  // Close on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('show');
    }
  });
}

async function deleteFolder(folderId) {
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return;

  const taskCount = tasks.filter(task => task.folder_id === folderId).length;

  showDeleteConfirmation(folder.name, taskCount, async () => {
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
        showToast(`Project deleted: ${folder.name}`, 'success');
      } else {
        showToast(data.error || 'Failed to delete project', 'error');
      }
    } catch (error) {
      console.error('Failed to delete folder:', error);
      showToast('Failed to delete project: ' + error.message, 'error');
    }
  });
}

// Make deleteFolder globally accessible for sidebar
window.deleteFolder = deleteFolder;

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

      const folderName = folderId === 'all' ? 'All Documents' : folders.find(f => f.id === folderId)?.name;
      console.log(`✓ Task moved to: ${folderName}`);
      showToast(`Moved to ${folderName}`, 'success');
    } else {
      showToast(data.error || 'Failed to move file', 'error');
    }
  } catch (error) {
    console.error('Failed to move task:', error);
    showToast('Failed to move file: ' + error.message, 'error');
  }
}

// ==========================================
// TOAST NOTIFICATIONS
// ==========================================

/**
 * Show toast notification
 * @param {string} message - Message to display
 * @param {string} type - Type: 'success', 'error', 'info'
 */
function showToast(message, type = 'info') {
  // Create toast element
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  // Add to page
  document.body.appendChild(toast);

  // Animate in
  setTimeout(() => toast.classList.add('show'), 10);

  // Remove after 3 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
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
        // Don't render files list here - wait for folder selection
        // renderFilesList();

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
      renderFilesList();

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
  // Inline stats (dashboard) - only update if elements exist
  const statTotal = document.getElementById('statTotalInline');
  const statProcessing = document.getElementById('statProcessingInline');
  const statCompleted = document.getElementById('statCompletedInline');

  if (statTotal) statTotal.textContent = stats.total || 0;
  if (statProcessing) statProcessing.textContent = (parseInt(stats.pending || 0) + parseInt(stats.processing || 0));
  if (statCompleted) statCompleted.textContent = stats.completed || 0;
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
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          <p>No documents in ${folders.find(f => f.id === currentFolderId)?.name || 'this folder'}</p>
          <small>Upload files or drag existing files into this folder to organize them</small>
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
        } else if (message.type === 'credit_update') {
          // Handle real-time credit balance updates
          handleCreditUpdate(message.data);
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
    renderFilesList();
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

/**
 * Handle real-time credit balance updates via WebSocket
 */
function handleCreditUpdate(data) {
  console.log('💰 Credit update received:', data);

  // Refresh credit balance in sidebar
  if (typeof SidebarNav !== 'undefined') {
    SidebarNav.loadCredits();
  }

  // Show notification if provided
  if (data.message) {
    console.log(data.message);
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

      // Show content after successful authentication
      document.body.classList.add('auth-checked');

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
