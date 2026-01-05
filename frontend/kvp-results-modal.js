/**
 * KVP Results Modal
 * Displays extracted key-value pairs with document preview in a modal overlay
 */

// API Configuration - same as app.js
const KVP_MODAL_API_URL = (() => {
  const USE_SECURE = window.location.protocol === 'https:' || localStorage.getItem('forceSecure') === 'true';
  const API_PROTOCOL = USE_SECURE ? 'https' : 'http';
  const API_HOST = window.location.hostname === 'localhost' ? 'localhost:8080' : window.location.host;
  return `${API_PROTOCOL}://${API_HOST}`;
})();

const KVPResultsModal = {
  currentTaskId: null,
  currentPageIndex: 0,
  taskData: null,
  kvpData: null,
  kvpDataPerPage: {}, // Cache for per-page data
  documentImages: [],
  currentTab: 'aggregated', // 'aggregated' or 'per-page'

  /**
   * Initialize the modal and inject HTML structure
   */
  init() {
    if (document.getElementById('kvp-results-modal-overlay')) {
      console.log('KVP Results Modal already initialized');
      return;
    }

    const modalHTML = `
      <div id="kvp-results-modal-overlay" class="kvp-modal-overlay">
        <div class="kvp-modal">
          <!-- Header -->
          <div class="kvp-modal-header">
            <h2>
              <span id="kvp-modal-filename">Document Results</span>
              <span class="file-info" id="kvp-modal-fileinfo"></span>
            </h2>
            <button class="kvp-modal-close" id="kvp-modal-close-btn">&times;</button>
          </div>

          <!-- Body - Three Column Layout -->
          <div class="kvp-modal-body">
            <!-- Left: Thumbnails -->
            <div class="kvp-modal-thumbnails" id="kvp-modal-thumbnails">
              <h3>Pages</h3>
              <div id="kvp-thumbnails-list"></div>
            </div>

            <!-- Center: Document Preview -->
            <div class="kvp-modal-preview">
              <div class="preview-header">
                <h3>Original</h3>
                <div class="preview-pagination">
                  <button id="kvp-prev-page" title="Previous Page">◀</button>
                  <span id="kvp-page-indicator">Page 1 of 1</span>
                  <button id="kvp-next-page" title="Next Page">▶</button>
                </div>
              </div>
              <div class="preview-content" id="kvp-preview-content">
                <img id="kvp-preview-image" src="" alt="Document Preview" />
              </div>
            </div>

            <!-- Right: Extracted Data -->
            <div class="kvp-modal-data">
              <div class="data-header">
                <h3>Extracted Data</h3>
                <div class="data-header-tabs">
                  <button class="data-tab active" data-tab="aggregated">Aggregated</button>
                  <button class="data-tab" data-tab="per-page">Per-Page</button>
                </div>
              </div>

              <!-- Stats Summary -->
              <div id="kvp-stats-summary" class="kvp-stats-summary" style="display: none;">
                <div class="kvp-stats-row">
                  <div class="kvp-stat-badge total">
                    <span class="stat-number" id="stat-total">0</span>
                    <span class="stat-label">Total Fields</span>
                  </div>
                  <div class="kvp-stat-badge found">
                    <span class="stat-number" id="stat-found">0</span>
                    <span class="stat-label">Found</span>
                  </div>
                  <div class="kvp-stat-badge missing">
                    <span class="stat-number" id="stat-missing">0</span>
                    <span class="stat-label">Missing</span>
                  </div>
                </div>
              </div>

              <!-- Data Content -->
              <div class="data-content" id="kvp-data-content">
                <div class="kvp-loading">
                  <div class="kvp-loading-spinner"></div>
                  <p>Loading extracted data...</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="kvp-modal-footer">
            <button class="kvp-reprocess-btn" id="kvp-reprocess-btn">Reprocess Page</button>
            <div class="kvp-modal-actions">
              <button class="kvp-export-btn" id="kvp-export-json-btn">Export JSON</button>
              <button class="kvp-export-btn" id="kvp-export-csv-btn">Export CSV</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    this.attachEventListeners();
  },

  /**
   * Attach event listeners to modal controls
   */
  attachEventListeners() {
    // Close button
    document.getElementById('kvp-modal-close-btn').addEventListener('click', () => {
      this.close();
    });

    // Click outside to close
    document.getElementById('kvp-results-modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'kvp-results-modal-overlay') {
        this.close();
      }
    });

    // Escape key to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) {
        this.close();
      }
    });

    // Page navigation
    document.getElementById('kvp-prev-page').addEventListener('click', () => {
      this.navigatePage(-1);
    });

    document.getElementById('kvp-next-page').addEventListener('click', () => {
      this.navigatePage(1);
    });

    // Tab switching
    document.querySelectorAll('.data-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const tabName = e.target.dataset.tab;
        this.switchTab(tabName);
      });
    });

    // Reprocess button
    document.getElementById('kvp-reprocess-btn').addEventListener('click', () => {
      this.reprocessPage();
    });

    // Export buttons
    document.getElementById('kvp-export-json-btn').addEventListener('click', () => {
      this.exportAsJSON();
    });

    document.getElementById('kvp-export-csv-btn').addEventListener('click', () => {
      this.exportAsCSV();
    });
  },

  /**
   * Open modal with task data
   */
  async open(taskId) {
    this.init(); // Ensure modal is initialized

    this.currentTaskId = taskId;
    this.currentPageIndex = 0;

    // Show modal with loading state
    const overlay = document.getElementById('kvp-results-modal-overlay');
    overlay.classList.add('show');

    // Small delay for CSS transition to work properly
    setTimeout(() => {
      overlay.style.opacity = '1';
    }, 10);

    document.body.style.overflow = 'hidden';

    // Fetch task data
    await this.loadTaskData(taskId);
  },

  /**
   * Close modal
   */
  close() {
    const overlay = document.getElementById('kvp-results-modal-overlay');
    overlay.classList.remove('show');
    document.body.style.overflow = '';

    // Reset state
    this.currentTaskId = null;
    this.currentPageIndex = 0;
    this.taskData = null;
    this.kvpData = null;
    this.documentImages = [];
  },

  /**
   * Check if modal is open
   */
  isOpen() {
    const overlay = document.getElementById('kvp-results-modal-overlay');
    return overlay && overlay.classList.contains('show');
  },

  /**
   * Load task data from backend
   */
  async loadTaskData(taskId) {
    try {
      const response = await fetch(`${KVP_MODAL_API_URL}/api/tasks/${taskId}`, {
        credentials: 'include',
        headers: {
          'x-user-id': USER_ID
        }
      });
      if (!response.ok) {
        throw new Error('Failed to load task data');
      }

      const responseData = await response.json();
      // Extract task from nested structure: { success, data: { task } }
      this.taskData = responseData.data?.task || responseData.data || responseData;

      console.log('Modal task data loaded:', this.taskData);

      // Update header
      document.getElementById('kvp-modal-filename').textContent = this.taskData.filename || this.taskData.original_filename || 'Document Results';
      document.getElementById('kvp-modal-fileinfo').textContent =
        `${this.taskData.pages?.length || 0} pages • Processed ${new Date(this.taskData.created_at).toLocaleDateString()}`;

      // Load KVP results
      await this.loadKVPResults();

      // Load document images
      await this.loadDocumentImages();

      // Render everything
      this.renderThumbnails();
      this.renderPreview();
      this.renderExtractedData();

    } catch (error) {
      console.error('Error loading task data:', error);
      this.showError('Failed to load extraction results');
    }
  },

  /**
   * Load KVP extraction results (aggregated - all pages combined)
   */
  async loadKVPResults() {
    try {
      // Find KVP pages
      const kvpPages = this.taskData.pages?.filter(p => p.format_type === 'kvp') || [];

      if (kvpPages.length === 0) {
        throw new Error('No KVP results found for this task');
      }

      console.log(`Loading aggregated KVP results from ${kvpPages.length} page(s)...`);

      // Fetch aggregated JSON data from all pages
      const jsonResponse = await fetch(`${KVP_MODAL_API_URL}/api/tasks/${this.currentTaskId}/kvp-json?aggregated=true`, {
        credentials: 'include',
        headers: {
          'x-user-id': USER_ID
        }
      });
      if (!jsonResponse.ok) {
        throw new Error(`Failed to fetch KVP JSON: ${jsonResponse.status}`);
      }

      const jsonData = await jsonResponse.json();
      console.log('Loaded aggregated KVP JSON data:', jsonData);

      // Extract kvp_output from the response
      this.kvpData = jsonData.kvp_output || jsonData;

      console.log('✓ KVP data extracted:', this.kvpData);
      console.log('Has items array?', this.kvpData.items && Array.isArray(this.kvpData.items));
      console.log('Has structured?', !!this.kvpData.structured);
      console.log('Has fields?', !!this.kvpData.fields);

      if (!this.kvpData || Object.keys(this.kvpData).length === 0) {
        throw new Error('KVP data is empty or invalid');
      }

      console.log(`✓ Aggregated KVP data loaded: ${this.kvpData.items?.length || 0} total items from ${kvpPages.length} pages`);

    } catch (error) {
      console.error('Error loading KVP results:', error);
      throw error;
    }
  },

  /**
   * Load KVP data for a specific page
   */
  async loadPageData(pageNumber) {
    // Check cache first
    if (this.kvpDataPerPage[pageNumber]) {
      console.log(`Using cached data for page ${pageNumber}`);
      return this.kvpDataPerPage[pageNumber];
    }

    try {
      console.log(`Loading KVP data for page ${pageNumber}...`);

      const jsonResponse = await fetch(`${KVP_MODAL_API_URL}/api/tasks/${this.currentTaskId}/kvp-json?page=${pageNumber}`, {
        credentials: 'include',
        headers: {
          'x-user-id': USER_ID
        }
      });

      if (!jsonResponse.ok) {
        throw new Error(`Failed to fetch page ${pageNumber} KVP JSON: ${jsonResponse.status}`);
      }

      const jsonData = await jsonResponse.json();
      const pageData = jsonData.kvp_output || jsonData;

      // Cache the data
      this.kvpDataPerPage[pageNumber] = pageData;

      console.log(`✓ Loaded page ${pageNumber} KVP data:`, pageData);

      return pageData;

    } catch (error) {
      console.error(`Error loading page ${pageNumber} data:`, error);
      throw error;
    }
  },

  /**
   * Load document images for preview
   */
  async loadDocumentImages() {
    // Get original document images from task data
    this.documentImages = [];

    console.log('Loading document images from pages:', this.taskData.pages);

    // Use the page_image_s3_key from task_pages
    if (this.taskData.pages) {
      for (const page of this.taskData.pages) {
        if (page.page_image_s3_key) {
          // Create backend endpoint URL for the page image
          const imageUrl = `${KVP_MODAL_API_URL}/api/tasks/${this.currentTaskId}/page-image/${page.page_number}`;
          this.documentImages.push(imageUrl);
          console.log(`Added page ${page.page_number} image: ${imageUrl}`);
        }
      }
    }

    // If no images, create placeholder
    if (this.documentImages.length === 0) {
      console.warn('No page images found, using placeholder');
      this.documentImages = ['/api/placeholder-image'];
    }

    console.log('✓ Loaded', this.documentImages.length, 'document images');
  },

  /**
   * Render page thumbnails
   */
  renderThumbnails() {
    const container = document.getElementById('kvp-thumbnails-list');
    container.innerHTML = '';

    // Determine total pages from task data or document images
    const totalPages = this.taskData?.page_count || this.documentImages.length;

    for (let index = 0; index < totalPages; index++) {
      const thumbnail = document.createElement('div');
      thumbnail.className = 'thumbnail-item';
      if (index === this.currentPageIndex) {
        thumbnail.classList.add('active');
      }

      // Just display the page number, no image
      thumbnail.innerHTML = `
        <div class="thumbnail-page-number">${index + 1}</div>
      `;

      thumbnail.addEventListener('click', async () => {
        this.currentPageIndex = index;
        this.renderThumbnails();
        this.renderPreview();

        // If in per-page mode, load and display that page's data
        if (this.currentTab === 'per-page') {
          await this.loadPageData(index + 1);
          this.renderExtractedData();
        }
      });

      container.appendChild(thumbnail);
    }
  },

  /**
   * Render document preview
   */
  async renderPreview() {
    const previewImg = document.getElementById('kvp-preview-image');
    const pageIndicator = document.getElementById('kvp-page-indicator');
    const prevBtn = document.getElementById('kvp-prev-page');
    const nextBtn = document.getElementById('kvp-next-page');

    console.log('Rendering preview for page', this.currentPageIndex);
    console.log('Document images:', this.documentImages);

    // Update image - fetch as blob with authentication
    if (this.documentImages.length > 0) {
      const imageUrl = this.documentImages[this.currentPageIndex];
      console.log('Fetching preview image:', imageUrl);

      try {
        const response = await fetch(imageUrl, {
          credentials: 'include',
          headers: {
            'x-user-id': USER_ID
          }
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.status}`);
        }

        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);

        // Revoke previous object URL to avoid memory leaks
        if (previewImg.src && previewImg.src.startsWith('blob:')) {
          URL.revokeObjectURL(previewImg.src);
        }

        previewImg.src = objectUrl;
        console.log('✓ Image loaded successfully');

      } catch (error) {
        console.error('Failed to load image:', error);
        previewImg.alt = 'Failed to load image';
      }
    }

    // Update pagination
    pageIndicator.textContent = `Page ${this.currentPageIndex + 1} of ${this.documentImages.length}`;
    prevBtn.disabled = this.currentPageIndex === 0;
    nextBtn.disabled = this.currentPageIndex === this.documentImages.length - 1;
  },

  /**
   * Navigate pages
   */
  async navigatePage(direction) {
    const newIndex = this.currentPageIndex + direction;
    if (newIndex >= 0 && newIndex < this.documentImages.length) {
      this.currentPageIndex = newIndex;
      this.renderThumbnails();
      this.renderPreview();

      // If in per-page mode, load and display that page's data
      if (this.currentTab === 'per-page') {
        await this.loadPageData(newIndex + 1);
        this.renderExtractedData();
      }
    }
  },

  /**
   * Render extracted KVP data
   */
  renderExtractedData() {
    const container = document.getElementById('kvp-data-content');

    // Determine which data to display based on current tab
    let dataToRender;
    if (this.currentTab === 'aggregated') {
      dataToRender = this.kvpData;
    } else if (this.currentTab === 'per-page') {
      const pageNumber = this.currentPageIndex + 1;
      dataToRender = this.kvpDataPerPage[pageNumber];
    }

    if (!dataToRender) {
      container.innerHTML = `
        <div class="kvp-empty-state">
          <div class="kvp-empty-state-icon">📄</div>
          <h4>No Data Extracted</h4>
          <p>No key-value pairs were found for this ${this.currentTab === 'per-page' ? 'page' : 'document'}.</p>
        </div>
      `;
      return;
    }

    // Check if this is items array format (new format from model)
    if (dataToRender.items && Array.isArray(dataToRender.items)) {
      this.renderItemsArrayOutput(dataToRender);
    }
    // Check if this is structured output (selected fields) or full extraction
    else if (dataToRender.structured || typeof dataToRender === 'object' && !dataToRender.fields) {
      this.renderStructuredOutput(dataToRender);
    } else {
      this.renderCategorizedOutput(dataToRender);
    }
  },

  /**
   * Render items array output (new format from model with key/value/confidence)
   */
  renderItemsArrayOutput(dataToRender) {
    const container = document.getElementById('kvp-data-content');
    const items = dataToRender.items;

    // Hide stats for this format
    const statsContainer = document.getElementById('kvp-stats-summary');
    statsContainer.style.display = 'none';

    // Group items by key to handle multiple values
    const groupedData = {};
    items.forEach(item => {
      const key = item.key;
      if (!groupedData[key]) {
        groupedData[key] = [];
      }
      groupedData[key].push({
        value: item.value,
        confidence: item.confidence,
        page_number: item.page_number
      });
    });

    // Render grouped fields
    let html = '';
    for (const [key, values] of Object.entries(groupedData)) {
      // Skip if all values are empty
      const hasValues = values.some(v => v.value && v.value !== '');
      if (!hasValues) continue;

      html += `
        <div class="kvp-field-item">
          <div class="kvp-field-label">
            ${this.escapeHtml(key)}
          </div>
      `;

      // If multiple values, show them as a bulleted list with page indicators
      if (values.length > 1) {
        html += '<div class="kvp-field-value-list">';
        values.forEach((item, index) => {
          if (item.value && item.value !== '') {
            html += `
              <div class="kvp-field-value found multi-value">
                <span class="value-bullet">•</span>
                <span class="value-text">${this.escapeHtml(item.value)}</span>
                ${item.page_number ? `<span class="kvp-field-page">p.${item.page_number}</span>` : ''}
              </div>
            `;
          }
        });
        html += '</div>';
      } else {
        // Single value with page indicator
        const item = values[0];
        if (item.value && item.value !== '') {
          html += `
            <div class="kvp-field-value found">
              ${this.escapeHtml(item.value)}
              ${item.page_number ? `<span class="kvp-field-page">p.${item.page_number}</span>` : ''}
            </div>
          `;
        }
      }

      html += '</div>';
    }

    container.innerHTML = html || `
      <div class="kvp-empty-state">
        <div class="kvp-empty-state-icon">📄</div>
        <h4>No Data Found</h4>
        <p>No values were extracted from the document.</p>
      </div>
    `;
  },

  /**
   * Render structured output (user-selected fields only)
   */
  renderStructuredOutput(dataToRender) {
    const container = document.getElementById('kvp-data-content');
    const data = dataToRender.structured || dataToRender;

    // Filter to only show found fields
    const foundFields = {};
    for (const [key, value] of Object.entries(data)) {
      if (value && value !== '') {
        foundFields[key] = value;
      }
    }

    // Show stats
    const statsContainer = document.getElementById('kvp-stats-summary');
    statsContainer.style.display = 'block';

    const total = Object.keys(data).length;
    const found = Object.keys(foundFields).length;
    const missing = total - found;

    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-found').textContent = found;
    document.getElementById('stat-missing').textContent = missing;

    // Render only found fields
    let html = '';
    for (const [key, value] of Object.entries(foundFields)) {
      const displayKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

      html += `
        <div class="kvp-field-item">
          <div class="kvp-field-label">
            ${displayKey}
            <span class="kvp-field-page">p.1</span>
          </div>
          <div class="kvp-field-value found">
            ${this.escapeHtml(value)}
          </div>
        </div>
      `;
    }

    container.innerHTML = html || `
      <div class="kvp-empty-state">
        <div class="kvp-empty-state-icon">📄</div>
        <h4>No Data Found</h4>
        <p>No values were extracted for the selected fields.</p>
      </div>
    `;
  },

  /**
   * Render categorized output (full extraction with categories)
   */
  renderCategorizedOutput(dataToRender) {
    const container = document.getElementById('kvp-data-content');
    const fields = dataToRender.fields || {};

    // Hide stats for full extraction
    document.getElementById('kvp-stats-summary').style.display = 'none';

    let html = '';
    const categories = ['header', 'supplier', 'customer', 'delivery', 'totals', 'payment', 'other'];

    for (const category of categories) {
      const items = fields[category] || [];
      if (items.length === 0) continue;

      html += `<div class="kvp-category-section">`;

      for (const item of items) {
        const displayKey = item.standardized_key || item.visible_key || 'Unknown';
        const value = item.value || '';
        const confidence = item.confidence || 'medium';

        html += `
          <div class="kvp-field-item">
            <div class="kvp-field-label">
              ${this.escapeHtml(displayKey)}
              <span class="kvp-field-confidence ${confidence}">${confidence}</span>
            </div>
            <div class="kvp-field-value found">
              ${this.escapeHtml(value)}
            </div>
          </div>
        `;
      }

      html += `</div>`;
    }

    container.innerHTML = html || `
      <div class="kvp-empty-state">
        <div class="kvp-empty-state-icon">📄</div>
        <h4>No Data Extracted</h4>
        <p>No key-value pairs were found in this document.</p>
      </div>
    `;
  },

  /**
   * Switch between tabs (aggregated/per-page)
   */
  async switchTab(tabName) {
    // Update active tab
    document.querySelectorAll('.data-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    this.currentTab = tabName;

    // Load appropriate data
    if (tabName === 'aggregated') {
      // Show aggregated data (already loaded)
      this.renderExtractedData();
    } else if (tabName === 'per-page') {
      // Load current page data if not cached
      await this.loadPageData(this.currentPageIndex + 1);
      this.renderExtractedData();
    }
  },

  /**
   * Reprocess current page
   */
  async reprocessPage() {
    if (!this.currentTaskId) return;

    if (confirm('Are you sure you want to reprocess this page? This will create a new extraction task.')) {
      // TODO: Implement reprocessing logic
      alert('Reprocessing not yet implemented');
    }
  },

  /**
   * Export data as JSON
   */
  exportAsJSON() {
    if (!this.kvpData) return;

    let exportData;

    // Handle items array format
    if (this.kvpData.items && Array.isArray(this.kvpData.items)) {
      // Filter out empty values
      exportData = {
        items: this.kvpData.items.filter(item => item.value && item.value !== '')
      };
    } else {
      // Handle structured format
      const data = this.kvpData.structured || this.kvpData;

      // Filter to only include found fields
      const foundFields = {};
      for (const [key, value] of Object.entries(data)) {
        if (value && value !== '') {
          foundFields[key] = value;
        }
      }
      exportData = foundFields;
    }

    const dataStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.taskData?.original_filename || 'extraction'}_kvp.json`;
    a.click();

    URL.revokeObjectURL(url);
  },

  /**
   * Export data as CSV
   */
  exportAsCSV() {
    if (!this.kvpData) return;

    let csv = 'Field,Value,Confidence\n';

    // Handle items array format
    if (this.kvpData.items && Array.isArray(this.kvpData.items)) {
      this.kvpData.items.forEach(item => {
        if (item.value && item.value !== '') {
          csv += `"${item.key}","${item.value.replace(/"/g, '""')}","${item.confidence || ''}"\n`;
        }
      });
    }
    // Handle structured output
    else if (this.kvpData.structured || typeof this.kvpData === 'object' && !this.kvpData.fields) {
      const data = this.kvpData.structured || this.kvpData;

      // Filter to only include found fields
      for (const [key, value] of Object.entries(data)) {
        if (value && value !== '') {
          csv += `"${key}","${value.replace(/"/g, '""')}",""\n`;
        }
      }
    } else {
      // Handle categorized output
      const fields = this.kvpData.fields || {};
      for (const category in fields) {
        const items = fields[category] || [];
        for (const item of items) {
          const key = item.standardized_key || item.visible_key || 'Unknown';
          const value = item.value || '';
          // Only include if value is not empty
          if (value && value !== '') {
            csv += `"${key}","${value.replace(/"/g, '""')}","${item.confidence || ''}"\n`;
          }
        }
      }
    }

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.taskData?.original_filename || 'extraction'}_kvp.csv`;
    a.click();

    URL.revokeObjectURL(url);
  },

  /**
   * Show error message
   */
  showError(message) {
    const container = document.getElementById('kvp-data-content');
    container.innerHTML = `
      <div class="kvp-empty-state">
        <div class="kvp-empty-state-icon">⚠️</div>
        <h4>Error</h4>
        <p>${this.escapeHtml(message)}</p>
      </div>
    `;
  },

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

// Don't auto-initialize - let it initialize lazily when first opened
// This prevents interfering with the main page on load
