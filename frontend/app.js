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

  initUpload();
  initEmptyStateUpload();
  initWebSocket();
  initFolders();
  loadFolders();
  loadTasks();

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
// UPLOAD FUNCTIONALITY
// ==========================================

function initUpload() {
  const uploadDropzone = document.getElementById('uploadDropzone');
  const fileInput = document.getElementById('fileInput');

  uploadDropzone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileUpload(e.target.files[0]);
    }
  });

  // Drag and drop
  uploadDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadDropzone.classList.add('dragging');
  });

  uploadDropzone.addEventListener('dragleave', () => {
    uploadDropzone.classList.remove('dragging');
  });

  uploadDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadDropzone.classList.remove('dragging');

    if (e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  });
}

function initEmptyStateUpload() {
  const emptyStateDropzone = document.getElementById('emptyStateDropzone');
  const emptyStateFileInput = document.getElementById('emptyStateFileInput');

  if (!emptyStateDropzone || !emptyStateFileInput) return;

  emptyStateDropzone.addEventListener('click', () => emptyStateFileInput.click());

  emptyStateFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileUpload(e.target.files[0]);
    }
  });

  // Drag and drop
  emptyStateDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    emptyStateDropzone.classList.add('dragging');
  });

  emptyStateDropzone.addEventListener('dragleave', () => {
    emptyStateDropzone.classList.remove('dragging');
  });

  emptyStateDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    emptyStateDropzone.classList.remove('dragging');

    if (e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  });
}

async function handleFileUpload(file) {
  const status = document.getElementById('uploadStatus');
  status.className = 'upload-status visible uploading';
  status.textContent = `Uploading ${file.name}...`;

  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('userId', USER_ID);

    const response = await fetch(`${API_URL}/api/tasks`, {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();

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

      status.className = 'upload-status visible success';
      status.textContent = `✓ ${file.name} uploaded successfully! Processing...`;

      // Clear file input
      document.getElementById('fileInput').value = '';

      // Close modal
      const uploadModal = document.getElementById('uploadModal');
      if (uploadModal) {
        setTimeout(() => {
          uploadModal.classList.remove('active');
        }, 1000);
      }

      // Reload tasks and show viewer for new task
      setTimeout(async () => {
        await loadTasks();
        status.classList.remove('visible');

        // Find the newly uploaded task and show it
        const newTask = tasks.find(t => t.id === taskId);
        if (newTask) {
          showViewer(newTask);
        }
      }, 1500);
    } else {
      throw new Error(data.error || 'Upload failed');
    }
  } catch (error) {
    status.className = 'upload-status visible error';
    status.textContent = `✗ Upload failed: ${error.message}`;

    setTimeout(() => {
      status.classList.remove('visible');
    }, 5000);
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
          <div class="empty-state-upload-dropzone" id="emptyStateDropzone">
            <input type="file" id="emptyStateFileInput" accept=".pdf,image/*" hidden>
            <svg class="upload-icon" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            <p class="upload-text">Drop your document here</p>
            <p class="upload-subtext">or click to browse</p>
            <small class="upload-hint">PDF, PNG, JPG (Max 50MB)</small>
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
