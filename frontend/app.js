// Configuration
const USE_SECURE = window.location.protocol === 'https:' ||
                   localStorage.getItem('forceSecure') === 'true';

const API_PROTOCOL = USE_SECURE ? 'https' : 'http';
const WS_PROTOCOL = USE_SECURE ? 'wss' : 'ws';
const API_HOST = window.location.hostname === 'localhost' ? 'localhost:8080' : window.location.host;

const API_URL = `${API_PROTOCOL}://${API_HOST}`;
const WS_URL = `${WS_PROTOCOL}://${API_HOST}`;

const USER_ID = '3c8bf409-1992-4156-add2-3d5bb3df6ec1'; // benfrankstein (admin)

console.log('🔒 Security Configuration:');
console.log(`  Protocol: ${USE_SECURE ? 'HTTPS/WSS (Secure)' : 'HTTP/WS (Development)'}`);
console.log(`  API URL: ${API_URL}`);
console.log(`  WebSocket URL: ${WS_URL}`);

// State
let ws = null;
let tasks = [];
let currentTask = null; // Currently viewing task
let loadTasksTimeout = null;

// Google Docs Flow - Session Management
let currentSessionId = null;
let autoSaveTimer = null;
let lastSavedContent = '';
let isSaving = false;
let lastAutoSaveTime = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Check if user is authenticated
  const isAuthenticated = await checkAuth();
  if (!isAuthenticated) {
    window.location.href = 'auth.html';
    return;
  }

  initUpload();
  initWebSocket();
  loadTasks();

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
});

// ==========================================
// VIEW MANAGEMENT
// ==========================================

function showDashboard() {
  // End session before navigating
  endEditSession();

  document.getElementById('dashboardView').classList.add('active');
  document.getElementById('viewerView').classList.remove('active');
  currentTask = null;
  loadTasks(); // Refresh the list
}

function showViewer(task) {
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
  } else if (task.status === 'failed') {
    showErrorCard(task);
  } else {
    showProcessingCard(task);
  }

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

  // Load text preview
  loadTextPreview(task.id);

  // Load document preview (HTML)
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
      status.className = 'upload-status visible success';
      status.textContent = `✓ ${file.name} uploaded successfully! Processing...`;

      // Clear file input
      document.getElementById('fileInput').value = '';

      // Reload tasks and show viewer for new task
      setTimeout(async () => {
        await loadTasks();
        status.classList.remove('visible');

        // Find the newly uploaded task and show it
        const newTask = tasks.find(t => t.id === data.data.taskId);
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
      const data = await response.json();

      if (data.success) {
        tasks = data.data.tasks;
        updateStats(data.data.stats);
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

  if (tasks.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
        <p>No documents yet</p>
        <small>Upload your first document to get started</small>
      </div>
    `;
    return;
  }

  grid.innerHTML = tasks.map(task => createDocumentCard(task)).join('');

  // Add click handlers
  tasks.forEach(task => {
    const card = document.querySelector(`[data-task-id="${task.id}"]`);
    if (card) {
      card.addEventListener('click', () => showViewer(task));
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
    // Load latest version from backend
    const response = await fetch(`${API_URL}/api/versions/${taskId}/latest`, {
      headers: { 'x-user-id': USER_ID }
    });

    if (!response.ok) {
      console.error('❌ Failed to load document:', response.status, response.statusText);
      throw new Error(`Failed to load document: ${response.status}`);
    }

    const htmlContent = await response.text();
    const versionNumber = response.headers.get('X-Version-Number');
    const contentSource = response.headers.get('X-Content-Source');

    console.log(`📖 Loaded version ${versionNumber} from ${contentSource}`);

    // Create iframe and inject HTML using srcdoc
    const iframe = document.createElement('iframe');
    iframe.id = 'untxtPreview';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.borderRadius = '0.5rem';
    iframe.style.backgroundColor = '#fff';

    // Use srcdoc to inject the HTML content
    iframe.srcdoc = htmlContent;

    // Replace placeholder with iframe
    previewContainer.innerHTML = '';
    previewContainer.appendChild(iframe);

    // Wait for iframe to load, then make editable and start session
    iframe.onload = () => {
      makeIframeEditableGoogleDocs();
      startEditSession();
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

async function loadOriginalPreview(taskId) {
  const previewContainer = document.getElementById('previewContainerCard');

  try {
    // Fetch the original file with auth
    const response = await fetch(`${API_URL}/api/tasks/${taskId}/download`, {
      headers: {
        'x-user-id': USER_ID
      }
    });

    if (!response.ok) {
      throw new Error('Failed to load original document');
    }

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const contentType = response.headers.get('Content-Type') || blob.type;

    // Create iframe to display original file
    const iframe = document.createElement('iframe');
    iframe.id = 'originalPreview';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.borderRadius = '0.5rem';
    iframe.style.backgroundColor = '#fff';

    // For PDFs, hide toolbar and navigation panes
    if (contentType.includes('pdf')) {
      iframe.src = `${blobUrl}#toolbar=0&navpanes=0&scrollbar=0`;
    } else {
      // For images or other files
      iframe.src = blobUrl;
    }

    // Replace placeholder with iframe
    previewContainer.innerHTML = '';
    previewContainer.appendChild(iframe);

    // Store blob URL for cleanup
    iframe.dataset.blobUrl = blobUrl;

  } catch (error) {
    console.error('Failed to load original preview:', error);
    previewContainer.innerHTML = `
      <div class="preview-placeholder">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
        <p>Failed to load original</p>
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
    const htmlContent = iframe?.contentDocument?.documentElement?.outerHTML;

    const response = await fetch(`${API_URL}/api/sessions/${taskId}/download-result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': USER_ID
      },
      body: JSON.stringify({
        htmlContent: htmlContent || '',
        sessionId: currentSessionId
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

async function checkAuth() {
  try {
    const response = await fetch(`${API_URL}/api/auth/session`, {
      credentials: 'include'
    });

    const data = await response.json();

    if (data.success && data.data.authenticated) {
      const user = data.data.user;
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
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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

function endEditSession() {
  if (!currentSessionId) return;

  // Get current content - save COMPLETE HTML document
  const previewContainer = document.getElementById('previewContainerCard');
  const iframe = previewContainer?.querySelector('iframe');
  const htmlContent = iframe?.contentDocument?.documentElement?.outerHTML;

  if (htmlContent) {
    // Use sendBeacon for reliable delivery even if page is closing
    const data = new Blob([JSON.stringify({
      sessionId: currentSessionId,
      htmlContent: htmlContent,
      outcome: 'completed'
    })], { type: 'application/json' });

    navigator.sendBeacon(
      `${API_URL}/api/sessions/${currentTask.id}/end`,
      data
    );

    console.log('✅ Edit session ended:', currentSessionId);
    console.log('☁️ Backend will upload to S3');
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
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(autoSaveVersion, 3000);
  });
}

async function autoSaveVersion() {
  if (isSaving) return; // Prevent concurrent saves
  if (!currentSessionId) return; // No session
  if (!currentTask) return;

  const previewContainer = document.getElementById('previewContainerCard');
  const iframe = previewContainer?.querySelector('iframe');

  // Save COMPLETE HTML document (including <head>, <style>, <body>)
  // This preserves all CSS and formatting from the original OCR result
  const htmlContent = iframe?.contentDocument?.documentElement?.outerHTML;

  if (!htmlContent) return;

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
