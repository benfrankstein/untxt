/**
 * Anonymization Results Modal
 * Displays anonymized data with ENTITY/ORIGINAL/REDACTED/PAGE layout
 */

// API Configuration
const ANON_RESULTS_API_URL = (() => {
  const USE_SECURE = window.location.protocol === 'https:' || localStorage.getItem('forceSecure') === 'true';
  const API_PROTOCOL = USE_SECURE ? 'https' : 'http';
  const API_HOST = window.location.hostname === 'localhost' ? 'localhost:8080' : window.location.host;
  return `${API_PROTOCOL}://${API_HOST}`;
})();

const AnonResultsModal = {
  currentTaskId: null,
  currentPageIndex: 0,
  taskData: null,
  anonData: null,
  anonDataPerPage: {},
  documentImages: [],
  currentTab: 'aggregated', // 'aggregated' or 'per-page'

  /**
   * Initialize the modal and inject HTML structure
   */
  init() {
    if (document.getElementById('anon-results-modal-overlay')) {
      console.log('Anon Results Modal already initialized');
      return;
    }

    const modalHTML = `
      <div id="anon-results-modal-overlay" class="anon-results-modal-overlay">
        <div class="anon-results-modal">
          <!-- Header -->
          <div class="anon-results-modal-header">
            <h2>
              <span class="anon-modal-icon">🔒</span>
              <span id="anon-results-modal-filename">Anonymization Results</span>
              <span class="file-info" id="anon-results-modal-fileinfo"></span>
            </h2>
            <button class="anon-results-modal-close" id="anon-results-modal-close-btn">&times;</button>
          </div>

          <!-- Body - Three Column Layout -->
          <div class="anon-results-modal-body">
            <!-- Left: Thumbnails -->
            <div class="anon-results-modal-thumbnails" id="anon-results-modal-thumbnails">
              <h3>Pages</h3>
              <div id="anon-results-thumbnails-list"></div>
            </div>

            <!-- Center: Document Preview -->
            <div class="anon-results-modal-preview">
              <div class="preview-header">
                <h3>Original Document</h3>
                <div class="preview-pagination">
                  <button id="anon-results-prev-page" title="Previous Page">◀</button>
                  <span id="anon-results-page-indicator">Page 1 of 1</span>
                  <button id="anon-results-next-page" title="Next Page">▶</button>
                </div>
              </div>
              <div class="preview-content" id="anon-results-preview-content">
                <img id="anon-results-preview-image" src="" alt="Document Preview" />
              </div>
            </div>

            <!-- Right: Anonymized Data -->
            <div class="anon-results-modal-data">
              <div class="data-header">
                <h3>Anonymized Data</h3>
                <div class="data-header-controls">
                  <div class="data-header-tabs">
                    <button class="data-tab active" data-tab="aggregated">Aggregated</button>
                    <button class="data-tab" data-tab="per-page">Per-Page</button>
                  </div>
                  <button class="btn-download-mapping" id="anon-download-mapping-btn">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                    </svg>
                    Download Mapping
                  </button>
                </div>
              </div>

              <!-- Stats Summary -->
              <div id="anon-results-stats-summary" class="anon-results-stats-summary">
                <div class="anon-stats-row">
                  <div class="anon-stat-badge total">
                    <span class="stat-number" id="anon-stat-total">0</span>
                    <span class="stat-label">Total Fields</span>
                  </div>
                  <div class="anon-stat-badge anonymized">
                    <span class="stat-number" id="anon-stat-anonymized">0</span>
                    <span class="stat-label">Anonymized</span>
                  </div>
                  <div class="anon-stat-badge pages">
                    <span class="stat-number" id="anon-stat-pages">0</span>
                    <span class="stat-label">Pages</span>
                  </div>
                </div>
              </div>

              <!-- Data Content -->
              <div class="data-content" id="anon-results-data-content">
                <div class="anon-results-loading">
                  <div class="anon-results-loading-spinner"></div>
                  <p>Loading anonymized data...</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Attach event listeners
    document.getElementById('anon-results-modal-close-btn')?.addEventListener('click', () => this.close());
    document.getElementById('anon-results-modal-overlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'anon-results-modal-overlay') {
        this.close();
      }
    });

    // Tab switching
    document.querySelectorAll('.anon-results-modal .data-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const tabName = e.target.dataset.tab;
        this.switchTab(tabName);
      });
    });

    // Pagination
    document.getElementById('anon-results-prev-page')?.addEventListener('click', () => this.previousPage());
    document.getElementById('anon-results-next-page')?.addEventListener('click', () => this.nextPage());

    // Download mapping button
    document.getElementById('anon-download-mapping-btn')?.addEventListener('click', () => this.downloadMapping());

    console.log('✓ Anon Results Modal initialized');
  },

  /**
   * Open modal with task data
   */
  async open(taskId, taskData) {
    this.init();

    this.currentTaskId = taskId;
    this.taskData = taskData;
    this.currentPageIndex = 0;

    // Show modal
    const overlay = document.getElementById('anon-results-modal-overlay');
    overlay.classList.add('active');

    // Set filename
    document.getElementById('anon-results-modal-filename').textContent = taskData.filename || 'Document';
    document.getElementById('anon-results-modal-fileinfo').textContent = `${taskData.page_count || 0} pages`;

    // Load data
    await this.loadAnonData();
    await this.loadDocumentImages();

    // Render
    this.renderThumbnails();
    this.renderPreview();
    this.renderData();
  },

  /**
   * Close modal
   */
  close() {
    const overlay = document.getElementById('anon-results-modal-overlay');
    overlay?.classList.remove('active');

    // Reset state
    this.currentTaskId = null;
    this.taskData = null;
    this.anonData = null;
    this.anonDataPerPage = {};
    this.documentImages = [];
    this.currentPageIndex = 0;
    this.currentTab = 'aggregated';
  },

  /**
   * Load anonymized data (aggregated)
   */
  async loadAnonData() {
    try {
      const USER_ID = localStorage.getItem('user_id');
      const response = await fetch(`${ANON_RESULTS_API_URL}/api/tasks/${this.currentTaskId}/anon-json?aggregated=true`, {
        credentials: 'include',
        headers: { 'x-user-id': USER_ID }
      });

      if (!response.ok) {
        throw new Error('Failed to load anonymized data');
      }

      this.anonData = await response.json();
      console.log('✓ Loaded anonymized data:', this.anonData);
    } catch (error) {
      console.error('Error loading anonymized data:', error);
      this.anonData = { items: [], page_count: 0 };
    }
  },

  /**
   * Load per-page data
   */
  async loadAnonDataForPage(pageNumber) {
    if (this.anonDataPerPage[pageNumber]) {
      return this.anonDataPerPage[pageNumber];
    }

    try {
      const USER_ID = localStorage.getItem('user_id');
      const response = await fetch(`${ANON_RESULTS_API_URL}/api/tasks/${this.currentTaskId}/anon-json?page=${pageNumber}`, {
        credentials: 'include',
        headers: { 'x-user-id': USER_ID }
      });

      if (!response.ok) {
        throw new Error(`Failed to load page ${pageNumber}`);
      }

      const data = await response.json();
      this.anonDataPerPage[pageNumber] = data;
      console.log(`✓ Loaded page ${pageNumber} data`);
      return data;
    } catch (error) {
      console.error(`Error loading page ${pageNumber}:`, error);
      return { items: [] };
    }
  },

  /**
   * Load document images from S3
   */
  async loadDocumentImages() {
    try {
      const USER_ID = localStorage.getItem('user_id');

      // Get task pages data to find image S3 keys
      const response = await fetch(`${ANON_RESULTS_API_URL}/api/tasks/${this.currentTaskId}`, {
        credentials: 'include',
        headers: { 'x-user-id': USER_ID }
      });

      if (!response.ok) {
        throw new Error('Failed to load task data');
      }

      const taskData = await response.json();
      const pages = taskData.data.pages || [];

      // Filter anon pages and get their image keys
      const anonPages = pages.filter(p => p.format_type === 'anon');
      this.documentImages = anonPages.map(page => ({
        pageNumber: page.page_number,
        s3Key: page.page_image_s3_key
      })).sort((a, b) => a.pageNumber - b.pageNumber);

      console.log('✓ Loaded document images:', this.documentImages.length);
    } catch (error) {
      console.error('Error loading document images:', error);
      this.documentImages = [];
    }
  },

  /**
   * Render thumbnails
   */
  renderThumbnails() {
    const container = document.getElementById('anon-results-thumbnails-list');
    if (!container) return;

    container.innerHTML = '';

    this.documentImages.forEach((img, index) => {
      const thumb = document.createElement('div');
      thumb.className = 'thumbnail' + (index === this.currentPageIndex ? ' active' : '');
      thumb.innerHTML = `
        <div class="thumbnail-number">Page ${img.pageNumber}</div>
        <div class="thumbnail-placeholder">📄</div>
      `;
      thumb.addEventListener('click', () => {
        this.currentPageIndex = index;
        this.renderThumbnails();
        this.renderPreview();
        if (this.currentTab === 'per-page') {
          this.renderData();
        }
      });
      container.appendChild(thumb);
    });
  },

  /**
   * Render preview
   */
  async renderPreview() {
    const img = document.getElementById('anon-results-preview-image');
    const indicator = document.getElementById('anon-results-page-indicator');

    if (!img || !indicator) return;

    const currentImage = this.documentImages[this.currentPageIndex];
    const totalPages = this.documentImages.length;

    if (currentImage) {
      // Get presigned URL for image
      try {
        const USER_ID = localStorage.getItem('user_id');
        const response = await fetch(`${ANON_RESULTS_API_URL}/api/s3/presigned-url?key=${encodeURIComponent(currentImage.s3Key)}`, {
          credentials: 'include',
          headers: { 'x-user-id': USER_ID }
        });

        if (response.ok) {
          const data = await response.json();
          img.src = data.url;
        } else {
          img.src = '';
        }
      } catch (error) {
        console.error('Error loading preview image:', error);
        img.src = '';
      }

      indicator.textContent = `Page ${currentImage.pageNumber} of ${totalPages}`;
    } else {
      img.src = '';
      indicator.textContent = 'No preview available';
    }
  },

  /**
   * Previous page
   */
  previousPage() {
    if (this.currentPageIndex > 0) {
      this.currentPageIndex--;
      this.renderThumbnails();
      this.renderPreview();
      if (this.currentTab === 'per-page') {
        this.renderData();
      }
    }
  },

  /**
   * Next page
   */
  nextPage() {
    if (this.currentPageIndex < this.documentImages.length - 1) {
      this.currentPageIndex++;
      this.renderThumbnails();
      this.renderPreview();
      if (this.currentTab === 'per-page') {
        this.renderData();
      }
    }
  },

  /**
   * Switch tab
   */
  switchTab(tabName) {
    this.currentTab = tabName;

    // Update tab buttons
    document.querySelectorAll('.anon-results-modal .data-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // Re-render data
    this.renderData();
  },

  /**
   * Render data
   */
  async renderData() {
    const container = document.getElementById('anon-results-data-content');
    if (!container) return;

    container.innerHTML = '<div class="anon-results-loading"><div class="anon-results-loading-spinner"></div><p>Loading...</p></div>';

    if (this.currentTab === 'aggregated') {
      await this.renderAggregatedData();
    } else {
      await this.renderPerPageData();
    }
  },

  /**
   * Render aggregated data
   */
  async renderAggregatedData() {
    const container = document.getElementById('anon-results-data-content');
    if (!container) return;

    const items = this.anonData?.items || [];

    // Update stats
    document.getElementById('anon-stat-total').textContent = items.length;
    document.getElementById('anon-stat-anonymized').textContent = items.filter(i => i.anonymized_value).length;
    document.getElementById('anon-stat-pages').textContent = this.anonData?.page_count || 0;

    if (items.length === 0) {
      container.innerHTML = '<div class="anon-results-empty">No anonymized data found</div>';
      return;
    }

    // Create table
    const table = document.createElement('table');
    table.className = 'anon-results-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Entity</th>
          <th>Original Value</th>
          <th>Anonymized Value</th>
          <th>Page</th>
        </tr>
      </thead>
      <tbody id="anon-results-table-body"></tbody>
    `;
    container.innerHTML = '';
    container.appendChild(table);

    const tbody = document.getElementById('anon-results-table-body');
    items.forEach(item => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><span class="entity-badge">${this.escapeHtml(item.key || '-')}</span></td>
        <td class="original-value">${this.escapeHtml(item.value || '-')}</td>
        <td class="anonymized-value">${this.escapeHtml(item.anonymized_value || '-')}</td>
        <td class="page-number">Page ${item.page_number || '-'}</td>
      `;
      tbody.appendChild(row);
    });
  },

  /**
   * Render per-page data
   */
  async renderPerPageData() {
    const container = document.getElementById('anon-results-data-content');
    if (!container) return;

    const currentImage = this.documentImages[this.currentPageIndex];
    if (!currentImage) {
      container.innerHTML = '<div class="anon-results-empty">No data available</div>';
      return;
    }

    const pageData = await this.loadAnonDataForPage(currentImage.pageNumber);
    const items = pageData?.items || [];

    // Update stats for current page
    document.getElementById('anon-stat-total').textContent = items.length;
    document.getElementById('anon-stat-anonymized').textContent = items.filter(i => i.anonymized_value).length;
    document.getElementById('anon-stat-pages').textContent = `Page ${currentImage.pageNumber}`;

    if (items.length === 0) {
      container.innerHTML = '<div class="anon-results-empty">No data on this page</div>';
      return;
    }

    // Create table
    const table = document.createElement('table');
    table.className = 'anon-results-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Entity</th>
          <th>Original Value</th>
          <th>Anonymized Value</th>
        </tr>
      </thead>
      <tbody id="anon-results-table-body"></tbody>
    `;
    container.innerHTML = '';
    container.appendChild(table);

    const tbody = document.getElementById('anon-results-table-body');
    items.forEach(item => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><span class="entity-badge">${this.escapeHtml(item.key || '-')}</span></td>
        <td class="original-value">${this.escapeHtml(item.value || '-')}</td>
        <td class="anonymized-value">${this.escapeHtml(item.anonymized_value || '-')}</td>
      `;
      tbody.appendChild(row);
    });
  },

  /**
   * Download mapping file
   */
  async downloadMapping() {
    try {
      const USER_ID = localStorage.getItem('user_id');
      const currentImage = this.documentImages[this.currentPageIndex];
      const pageNumber = this.currentTab === 'per-page' && currentImage ? currentImage.pageNumber : 1;

      const response = await fetch(`${ANON_RESULTS_API_URL}/api/tasks/${this.currentTaskId}/anon-mapping?page=${pageNumber}`, {
        credentials: 'include',
        headers: { 'x-user-id': USER_ID }
      });

      if (!response.ok) {
        throw new Error('Failed to download mapping file');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `anon_mapping_page_${pageNumber}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      console.log('✓ Downloaded mapping file');
    } catch (error) {
      console.error('Error downloading mapping:', error);
      alert('Failed to download mapping file');
    }
  },

  /**
   * Escape HTML
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  AnonResultsModal.init();
});

// Export globally
window.AnonResultsModal = AnonResultsModal;
