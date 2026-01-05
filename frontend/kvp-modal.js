/**
 * KVP Extraction Modal
 * Handles key-value pair extraction modal UI and API interactions
 * Note: API_URL is defined in app.js
 */

// ============================================================================
// CUSTOM DIALOG SYSTEM (replaces browser alert/confirm/prompt)
// ============================================================================

const Dialog = {
  /**
   * Show a simple alert dialog
   * @param {string} message - Message to display
   * @param {string} title - Dialog title (optional)
   * @returns {Promise<void>}
   */
  alert(message, title = 'Notification') {
    return new Promise((resolve) => {
      const modal = document.getElementById('dialogModal');
      const titleEl = document.getElementById('dialogTitle');
      const messageEl = document.getElementById('dialogMessage');
      const inputEl = document.getElementById('dialogInput');
      const confirmBtn = document.getElementById('dialogConfirmBtn');
      const cancelBtn = document.getElementById('dialogCancelBtn');

      // Set content
      titleEl.textContent = title;
      messageEl.textContent = message;
      inputEl.style.display = 'none';
      cancelBtn.style.display = 'none';
      confirmBtn.textContent = 'OK';
      confirmBtn.className = 'dialog-btn dialog-btn-confirm';

      // Show modal
      modal.classList.add('active');

      // Handle confirm
      const handleConfirm = () => {
        modal.classList.remove('active');
        confirmBtn.removeEventListener('click', handleConfirm);
        resolve();
      };

      confirmBtn.addEventListener('click', handleConfirm);
    });
  },

  /**
   * Show a confirmation dialog
   * @param {string} message - Message to display
   * @param {string} title - Dialog title (optional)
   * @param {boolean} isDanger - Use danger styling (optional)
   * @returns {Promise<boolean>} - true if confirmed, false if cancelled
   */
  confirm(message, title = 'Confirm', isDanger = false) {
    return new Promise((resolve) => {
      const modal = document.getElementById('dialogModal');
      const titleEl = document.getElementById('dialogTitle');
      const messageEl = document.getElementById('dialogMessage');
      const inputEl = document.getElementById('dialogInput');
      const confirmBtn = document.getElementById('dialogConfirmBtn');
      const cancelBtn = document.getElementById('dialogCancelBtn');

      // Set content
      titleEl.textContent = title;
      messageEl.textContent = message;
      inputEl.style.display = 'none';
      cancelBtn.style.display = 'inline-block';
      confirmBtn.textContent = 'OK';
      confirmBtn.className = isDanger
        ? 'dialog-btn dialog-btn-confirm danger'
        : 'dialog-btn dialog-btn-confirm';

      // Show modal
      modal.classList.add('active');

      // Handle confirm/cancel
      const cleanup = () => {
        modal.classList.remove('active');
        confirmBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
      };

      const handleConfirm = () => {
        cleanup();
        resolve(true);
      };

      const handleCancel = () => {
        cleanup();
        resolve(false);
      };

      confirmBtn.addEventListener('click', handleConfirm);
      cancelBtn.addEventListener('click', handleCancel);
    });
  },

  /**
   * Show a prompt dialog for text input
   * @param {string} message - Message to display
   * @param {string} title - Dialog title (optional)
   * @param {string} defaultValue - Default input value (optional)
   * @returns {Promise<string|null>} - Input value if confirmed, null if cancelled
   */
  prompt(message, title = 'Input Required', defaultValue = '') {
    return new Promise((resolve) => {
      const modal = document.getElementById('dialogModal');
      const titleEl = document.getElementById('dialogTitle');
      const messageEl = document.getElementById('dialogMessage');
      const inputEl = document.getElementById('dialogInput');
      const confirmBtn = document.getElementById('dialogConfirmBtn');
      const cancelBtn = document.getElementById('dialogCancelBtn');

      // Set content
      titleEl.textContent = title;
      messageEl.textContent = message;
      inputEl.style.display = 'block';
      inputEl.value = defaultValue;
      cancelBtn.style.display = 'inline-block';
      confirmBtn.textContent = 'OK';
      confirmBtn.className = 'dialog-btn dialog-btn-confirm';

      // Show modal
      modal.classList.add('active');

      // Focus input
      setTimeout(() => {
        inputEl.focus();
        inputEl.select();
      }, 100);

      // Handle confirm/cancel
      const cleanup = () => {
        modal.classList.remove('active');
        confirmBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
        inputEl.removeEventListener('keypress', handleKeyPress);
      };

      const handleConfirm = () => {
        const value = inputEl.value.trim();
        cleanup();
        resolve(value || null);
      };

      const handleCancel = () => {
        cleanup();
        resolve(null);
      };

      const handleKeyPress = (e) => {
        if (e.key === 'Enter') {
          handleConfirm();
        } else if (e.key === 'Escape') {
          handleCancel();
        }
      };

      confirmBtn.addEventListener('click', handleConfirm);
      cancelBtn.addEventListener('click', handleCancel);
      inputEl.addEventListener('keypress', handleKeyPress);
    });
  }
};

// State management
const KVPModal = {
  selectedFiles: [],
  allSectors: [],
  selectedSectors: [],
  allKVPs: {},
  selectedKVPs: new Set(),
  customKVPs: [], // Array of { id, custom_key_name } from database
  presets: [],
  currentPreset: null,
  originalPresetState: null, // Track original state for change detection

  // Check if current selections differ from loaded preset
  hasChanges() {
    if (!this.currentPreset || !this.originalPresetState) {
      return false;
    }

    // Convert current selections to sorted array for comparison
    const currentKVPs = Array.from(this.selectedKVPs).sort();
    const originalKVPs = Array.from(this.originalPresetState.selectedKVPs).sort();

    // Compare lengths
    if (currentKVPs.length !== originalKVPs.length) {
      return true;
    }

    // Compare each item
    for (let i = 0; i < currentKVPs.length; i++) {
      if (currentKVPs[i] !== originalKVPs[i]) {
        return true;
      }
    }

    return false;
  },

  // Save original state when preset is loaded
  saveOriginalState() {
    this.originalPresetState = {
      selectedKVPs: new Set(this.selectedKVPs),
      currentPreset: this.currentPreset
    };
  },

  // Clear original state
  clearOriginalState() {
    this.originalPresetState = null;
  }
};

// ============================================================================
// MODAL OPEN/CLOSE
// ============================================================================

function openKVPModal(files) {
  console.log('Opening KVP modal with files:', files);

  KVPModal.selectedFiles = files || [];

  const modal = document.getElementById('kvpModal');
  modal.classList.add('active');

  // Reset KVP state
  KVPModal.selectedSectors = [];
  KVPModal.selectedKVPs = new Set();
  KVPModal.currentPreset = null;

  // Reset Anon state
  clearAnonState();

  // Switch to KVP tab by default
  switchTab('extraction');

  // Load KVP data
  loadSectors();
  loadPresets();
  loadCustomFields(); // Load user's custom fields
  renderFileList();
  updateProcessCount();
}

function closeKVPModal() {
  const modal = document.getElementById('kvpModal');
  modal.classList.remove('active');

  // Reset state completely
  KVPModal.selectedSectors = [];
  KVPModal.selectedKVPs = new Set();
  KVPModal.allKVPs = {};
  KVPModal.currentPreset = null;
  KVPModal.selectedFiles = [];
  KVPModal.clearOriginalState();

  // Clear UI
  renderSelectedSectors();
  renderKVPList();
  updatePresetSaveVisibility();
  renderActivePresetCard();

  // Clear inputs
  document.getElementById('kvpCustomField').value = '';
  document.getElementById('kvpPresetName').value = '';
  document.getElementById('kvpSectorSelect').value = '';
  document.getElementById('kvpPresetSelect').value = '';

  // Clear file input so user can re-upload
  const fileInput = document.getElementById('fileInput');
  if (fileInput) {
    fileInput.value = '';
  }
}

// ============================================================================
// RENDER FILE LIST
// ============================================================================

function renderFileList() {
  const fileList = document.getElementById('kvpFileList');
  const fileCount = document.getElementById('kvpFileCount');

  fileCount.textContent = KVPModal.selectedFiles.length;

  if (KVPModal.selectedFiles.length === 0) {
    fileList.innerHTML = `
      <label class="kvp-file-item">
        <input type="checkbox" class="kvp-file-checkbox" checked disabled>
        <span class="kvp-file-name">No files selected</span>
      </label>
    `;
    return;
  }

  fileList.innerHTML = KVPModal.selectedFiles.map((file, index) => `
    <label class="kvp-file-item">
      <input type="checkbox" class="kvp-file-checkbox" data-index="${index}" checked>
      <span class="kvp-file-name" title="${file.name}">${file.name}</span>
    </label>
  `).join('');

  // Add event listeners
  fileList.querySelectorAll('.kvp-file-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', updateProcessCount);
  });
}

function getSelectedFiles() {
  const checkboxes = document.querySelectorAll('.kvp-file-checkbox:checked');
  return Array.from(checkboxes).map(cb => {
    const index = parseInt(cb.dataset.index);
    return KVPModal.selectedFiles[index];
  }).filter(Boolean);
}

function updateProcessCount() {
  const selectedFiles = getSelectedFiles();
  const countSpan = document.getElementById('kvpProcessCount');
  countSpan.textContent = selectedFiles.length > 0 ? `${selectedFiles.length}` : '';
}

// ============================================================================
// LOAD SECTORS
// ============================================================================

async function loadSectors() {
  try {
    const response = await fetch(`${API_URL}/api/kvp/sectors`, {
      credentials: 'include'
    });

    const data = await response.json();

    if (!data.success) {
      console.error('Failed to load sectors:', data.error);
      return;
    }

    KVPModal.allSectors = data.data.sectors;
    renderSectorDropdown();

  } catch (error) {
    console.error('Error loading sectors:', error);
  }
}

function renderSectorDropdown() {
  const select = document.getElementById('kvpSectorSelect');

  select.innerHTML = '<option value="">Select sector...</option>' +
    KVPModal.allSectors.map(sector => `
      <option value="${sector.id}" data-code="${sector.sector_code}">
        ${sector.display_name} (${sector.kvp_count})
      </option>
    `).join('');
}

// ============================================================================
// SECTOR SELECTION
// ============================================================================

async function onSectorSelect(sectorId) {
  if (!sectorId) return;

  const sector = KVPModal.allSectors.find(s => s.id === parseInt(sectorId));
  if (!sector) return;

  // Check if already selected
  if (KVPModal.selectedSectors.find(s => s.id === sector.id)) {
    console.log('Sector already selected:', sector.display_name);
    return;
  }

  // Add to selected sectors
  KVPModal.selectedSectors.push(sector);

  // Load KVPs for this sector
  await loadKVPsForSectors();

  // Auto-select all KVPs from this sector
  const kvps = KVPModal.allKVPs[sector.id] || [];
  kvps.forEach(kvp => {
    KVPModal.selectedKVPs.add(`master-${kvp.kvp_id}`);
  });

  // Render UI
  renderSelectedSectors();
  renderKVPList();
  updatePresetSaveVisibility();

  // Reset dropdown
  document.getElementById('kvpSectorSelect').value = '';
}

function removeSector(sectorId) {
  KVPModal.selectedSectors = KVPModal.selectedSectors.filter(s => s.id !== sectorId);

  // Remove KVPs from this sector from selection
  if (KVPModal.allKVPs[sectorId]) {
    KVPModal.allKVPs[sectorId].forEach(kvp => {
      KVPModal.selectedKVPs.delete(`master-${kvp.kvp_id}`);
    });
  }

  renderSelectedSectors();
  renderKVPList();
  updatePresetSaveVisibility();
  renderActivePresetCard(); // Update to show changes
}

function renderSelectedSectors() {
  const container = document.getElementById('kvpSelectedSectors');

  if (KVPModal.selectedSectors.length === 0) {
    container.innerHTML = '';
    return;
  }

  const sectorsHtml = KVPModal.selectedSectors.map(sector => `
    <div class="kvp-sector-chip">
      <span>${sector.display_name}</span>
      <button onclick="removeSector(${sector.id})">×</button>
    </div>
  `).join('');

  const clearButton = KVPModal.selectedSectors.length > 0 ? `
    <button class="kvp-clear-sectors-btn" onclick="clearAllSectors()" title="Clear all sectors">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
      Clear All
    </button>
  ` : '';

  container.innerHTML = sectorsHtml + clearButton;
}

function clearAllSectors() {
  // Clear sectors
  KVPModal.selectedSectors = [];
  KVPModal.allKVPs = {};
  KVPModal.selectedKVPs = new Set();

  // Re-render
  renderSelectedSectors();
  renderKVPList();
  updatePresetSaveVisibility();
  renderActivePresetCard(); // Update to show changes
}

// ============================================================================
// LOAD KVPS
// ============================================================================

async function loadKVPsForSectors() {
  if (KVPModal.selectedSectors.length === 0) return;

  try {
    const sectorIds = KVPModal.selectedSectors.map(s => s.id);

    const response = await fetch(`${API_URL}/api/kvp/sectors/kvps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ sectorIds })
    });

    const data = await response.json();

    if (!data.success) {
      console.error('Failed to load KVPs:', data.error);
      return;
    }

    // Store KVPs by sector
    data.data.sectors.forEach(sector => {
      KVPModal.allKVPs[sector.sector_id] = sector.kvps;
    });

  } catch (error) {
    console.error('Error loading KVPs:', error);
  }
}

function renderKVPList() {
  const container = document.getElementById('kvpList');

  if (KVPModal.selectedSectors.length === 0 && KVPModal.customKVPs.length === 0) {
    container.innerHTML = '<p class="kvp-empty-message">Select a sector or add custom fields</p>';
    return;
  }

  let html = '';

  // Render custom KVPs first (always at top if user has any)
  if (KVPModal.customKVPs.length > 0) {
    html += `
      <div class="kvp-sector-group">
        <div class="kvp-sector-group-header">
          CUSTOM FIELDS
          <span class="kvp-sector-group-count">${KVPModal.customKVPs.length}</span>
        </div>
        <div class="kvp-sector-group-items">
          ${KVPModal.customKVPs.map(customKvp => `
            <label class="kvp-item">
              <input
                type="checkbox"
                data-type="custom"
                data-custom-id="${customKvp.id}"
                data-key-name="${customKvp.custom_key_name}"
                ${KVPModal.selectedKVPs.has(`custom-${customKvp.custom_key_name}`) ? 'checked' : ''}
                onchange="toggleKVP(this)"
              >
              <span class="kvp-item-label">${customKvp.custom_key_name}</span>
            </label>
          `).join('')}
        </div>
      </div>
    `;
  }

  // Render KVPs by sector
  KVPModal.selectedSectors.forEach(sector => {
    const kvps = KVPModal.allKVPs[sector.id] || [];

    if (kvps.length === 0) return;

    html += `
      <div class="kvp-sector-group">
        <div class="kvp-sector-group-header">
          ${sector.display_name}
          <span class="kvp-sector-group-count">${kvps.length}</span>
        </div>
        <div class="kvp-sector-group-items">
          ${kvps.map(kvp => `
            <label class="kvp-item">
              <input
                type="checkbox"
                data-type="master"
                data-kvp-id="${kvp.kvp_id}"
                data-key-name="${kvp.key_name}"
                ${KVPModal.selectedKVPs.has(`master-${kvp.kvp_id}`) ? 'checked' : ''}
                onchange="toggleKVP(this)"
              >
              <span class="kvp-item-label">${kvp.key_name}</span>
            </label>
          `).join('')}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function toggleKVP(checkbox) {
  const type = checkbox.dataset.type;
  const keyName = checkbox.dataset.keyName;
  const kvpId = checkbox.dataset.kvpId;

  const id = type === 'master' ? `master-${kvpId}` : `custom-${keyName}`;

  if (checkbox.checked) {
    KVPModal.selectedKVPs.add(id);
  } else {
    KVPModal.selectedKVPs.delete(id);
  }

  updatePresetSaveVisibility();
  renderActivePresetCard(); // Update to show changes
}

// ============================================================================
// CUSTOM FIELDS
// ============================================================================

async function loadCustomFields() {
  try {
    const response = await fetch(`${API_URL}/api/kvp/custom-fields`, {
      credentials: 'include'
    });

    const data = await response.json();

    if (!data.success) {
      console.error('Failed to load custom fields:', data.error);
      return;
    }

    KVPModal.customKVPs = data.data.custom_kvps;
    renderKVPList();

  } catch (error) {
    console.error('Error loading custom fields:', error);
  }
}

async function addCustomField() {
  const input = document.getElementById('kvpCustomField');
  const fieldName = input.value.trim();

  if (!fieldName) return;

  // Check if already exists
  if (KVPModal.customKVPs.find(kvp => kvp.custom_key_name === fieldName)) {
    await Dialog.alert('This custom field already exists', 'Duplicate Field');
    return;
  }

  try {
    // Save to database immediately
    const response = await fetch(`${API_URL}/api/kvp/custom-fields`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ custom_key_name: fieldName })
    });

    const data = await response.json();

    if (!data.success) {
      await Dialog.alert(data.error || 'Failed to create custom field', 'Error');
      return;
    }

    // Add to state
    KVPModal.customKVPs.push(data.data.custom_kvp);

    // Auto-select the new custom field
    KVPModal.selectedKVPs.add(`custom-${fieldName}`);

    // Clear input
    input.value = '';

    // Re-render
    renderKVPList();
    updatePresetSaveVisibility();

  } catch (error) {
    console.error('Error creating custom field:', error);
    await Dialog.alert('Network error. Please try again.', 'Connection Error');
  }
}

// ============================================================================
// PRESET SAVE VISIBILITY
// ============================================================================

function updatePresetSaveVisibility() {
  const presetNameGroup = document.getElementById('kvpPresetNameGroup');

  // Show preset save section if any KVPs are selected
  if (KVPModal.selectedKVPs.size > 0) {
    presetNameGroup.style.display = 'flex';
  } else {
    presetNameGroup.style.display = 'none';
  }

  // Update save button state
  updateSaveButtonState();
}

// ============================================================================
// PRESETS
// ============================================================================

async function loadPresets() {
  try {
    const response = await fetch(`${API_URL}/api/kvp/presets`, {
      credentials: 'include'
    });

    const data = await response.json();

    if (!data.success) {
      console.error('Failed to load presets:', data.error);
      return;
    }

    KVPModal.presets = data.data.presets;
    renderPresetDropdown();

  } catch (error) {
    console.error('Error loading presets:', error);
  }
}

function renderPresetDropdown() {
  const select = document.getElementById('kvpPresetSelect');

  let options = '<option value="">Select preset...</option>';

  // Add "All Fields" option if there are sectors with KVPs
  if (KVPModal.allSectors && KVPModal.allSectors.length > 0) {
    options += '<option value="__ALL_FIELDS__">All Fields</option>';
  }

  // Add user presets
  options += KVPModal.presets.map(preset => `
    <option value="${preset.id}">${preset.preset_name}</option>
  `).join('');

  select.innerHTML = options;
}

async function onPresetSelect(presetId) {
  // If empty selection, clear everything
  if (!presetId || presetId === '') {
    clearAllSelections();
    return;
  }

  // Handle "All Fields" special option
  if (presetId === '__ALL_FIELDS__') {
    await applyAllFieldsPreset();
    return;
  }

  try {
    const response = await fetch(`${API_URL}/api/kvp/presets/${presetId}`, {
      credentials: 'include'
    });

    const data = await response.json();

    if (!data.success) {
      console.error('Failed to load preset:', data.error);
      return;
    }

    const preset = data.data.preset;
    applyPreset(preset);

  } catch (error) {
    console.error('Error loading preset:', error);
  }
}

function clearAllSelections() {
  // Clear all state
  KVPModal.selectedSectors = [];
  KVPModal.selectedKVPs = new Set();
  KVPModal.allKVPs = {};
  KVPModal.currentPreset = null;
  KVPModal.clearOriginalState();

  // Re-render UI
  renderSelectedSectors();
  renderKVPList();
  updatePresetSaveVisibility();
  renderActivePresetCard();
}

async function applyAllFieldsPreset() {
  console.log('Applying All Fields preset');

  // Clear current selections
  KVPModal.selectedSectors = [...KVPModal.allSectors];
  KVPModal.selectedKVPs = new Set();
  KVPModal.allKVPs = {};

  // Load KVPs for all sectors
  await loadKVPsForSectors();

  // Select all KVPs
  KVPModal.selectedSectors.forEach(sector => {
    const kvps = KVPModal.allKVPs[sector.id] || [];
    kvps.forEach(kvp => {
      KVPModal.selectedKVPs.add(`master-${kvp.kvp_id}`);
    });
  });

  // Select all custom KVPs
  KVPModal.customKVPs.forEach(customKvp => {
    KVPModal.selectedKVPs.add(`custom-${customKvp.custom_key_name}`);
  });

  // Render UI
  renderSelectedSectors();
  renderKVPList();
  updatePresetSaveVisibility();

  KVPModal.currentPreset = null;
  KVPModal.clearOriginalState();
  renderActivePresetCard();
}

function applyPreset(preset) {
  // Clear current selections
  KVPModal.selectedSectors = [];
  KVPModal.selectedKVPs = new Set();
  KVPModal.allKVPs = {};

  // Group KVPs by sector
  const sectorMap = {};

  preset.kvps.forEach(kvp => {
    if (kvp.is_custom) {
      // Select custom field if it exists
      KVPModal.selectedKVPs.add(`custom-${kvp.key_name}`);
    } else {
      KVPModal.selectedKVPs.add(`master-${kvp.master_kvp_id}`);

      if (kvp.sector_id && !sectorMap[kvp.sector_id]) {
        const sector = KVPModal.allSectors.find(s => s.id === kvp.sector_id);
        if (sector) {
          sectorMap[kvp.sector_id] = sector;
        }
      }
    }
  });

  // Set selected sectors
  KVPModal.selectedSectors = Object.values(sectorMap);

  // Set current preset
  KVPModal.currentPreset = preset;

  // Load KVPs for these sectors
  loadKVPsForSectors().then(() => {
    renderSelectedSectors();
    renderKVPList();
    updatePresetSaveVisibility();

    // Save original state AFTER everything is loaded
    KVPModal.saveOriginalState();
    renderActivePresetCard();
  });
}

// ============================================================================
// ACTIVE PRESET CARD
// ============================================================================

function renderActivePresetCard() {
  const container = document.getElementById('kvpActivePresetCard');

  if (!container) return;

  if (!KVPModal.currentPreset) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  const hasChanges = KVPModal.hasChanges();
  const statusClass = hasChanges ? 'modified' : 'loaded';
  const statusText = hasChanges ? 'Modified' : 'Loaded';
  const statusIcon = hasChanges ? '●' : '✓';

  container.style.display = 'block';
  container.innerHTML = `
    <div class="kvp-active-preset-card ${statusClass}">
      <div class="kvp-active-preset-info">
        <span class="kvp-active-preset-status">${statusIcon} ${statusText}</span>
        <span class="kvp-active-preset-name">${KVPModal.currentPreset.preset_name}</span>
      </div>
      <div class="kvp-active-preset-actions">
        ${hasChanges ? `
          <button class="kvp-preset-update-btn" onclick="updateCurrentPreset()" title="Update this preset with changes">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
            Update
          </button>
        ` : ''}
        <button class="kvp-preset-action-btn" onclick="renamePresetDialog()" title="Rename preset">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </button>
        <button class="kvp-preset-action-btn" onclick="deletePresetDialog()" title="Delete preset">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
        <button class="kvp-preset-action-btn" onclick="clearActivePreset()" title="Clear preset">
          ×
        </button>
      </div>
    </div>
  `;
}

function clearActivePreset() {
  // Clear all state
  KVPModal.selectedSectors = [];
  KVPModal.selectedKVPs = new Set();
  KVPModal.allKVPs = {};
  KVPModal.currentPreset = null;
  KVPModal.clearOriginalState();

  // Reset preset dropdown to "Select preset..."
  document.getElementById('kvpPresetSelect').value = '';

  // Re-render UI
  renderSelectedSectors();
  renderKVPList();
  updatePresetSaveVisibility();
  renderActivePresetCard();
  updateSaveButtonState();
}

async function updateCurrentPreset() {
  if (!KVPModal.currentPreset) return;
  await updatePresetContents(KVPModal.currentPreset.id);
}

// ============================================================================
// RENAME PRESET
// ============================================================================

async function renamePresetDialog() {
  if (!KVPModal.currentPreset) return;

  const newName = await Dialog.prompt(
    'Enter a new name for the preset:',
    'Rename Preset',
    KVPModal.currentPreset.preset_name
  );

  if (!newName || newName === '') {
    return;
  }

  if (newName === KVPModal.currentPreset.preset_name) {
    return; // No change
  }

  await renamePreset(KVPModal.currentPreset.id, newName);
}

async function renamePreset(presetId, newName) {
  try {
    const response = await fetch(`${API_URL}/api/kvp/presets/${presetId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        preset_name: newName,
        description: KVPModal.currentPreset.description || ''
      })
    });

    const data = await response.json();

    if (!data.success) {
      await Dialog.alert(data.error || 'Failed to rename preset', 'Error');
      return;
    }

    // Update current preset name
    KVPModal.currentPreset.preset_name = newName;

    // Reload presets dropdown
    await loadPresets();

    // Update active preset card
    renderActivePresetCard();

    await Dialog.alert(`Preset renamed to "${newName}"`, 'Success');

  } catch (error) {
    console.error('Error renaming preset:', error);
    await Dialog.alert('Error renaming preset: ' + error.message, 'Error');
  }
}

// ============================================================================
// DELETE PRESET
// ============================================================================

async function deletePresetDialog() {
  if (!KVPModal.currentPreset) return;

  const confirmed = await Dialog.confirm(
    `Are you sure you want to delete the preset "${KVPModal.currentPreset.preset_name}"?\n\nThis action cannot be undone.`,
    'Delete Preset',
    true // isDanger
  );

  if (confirmed) {
    await deletePreset(KVPModal.currentPreset.id);
  }
}

async function deletePreset(presetId) {
  try {
    const response = await fetch(`${API_URL}/api/kvp/presets/${presetId}`, {
      method: 'DELETE',
      credentials: 'include'
    });

    const data = await response.json();

    if (!data.success) {
      await Dialog.alert(data.error || 'Failed to delete preset', 'Error');
      return;
    }

    await Dialog.alert('Preset deleted successfully', 'Success');

    // Clear current preset
    clearActivePreset();

    // Reload presets dropdown
    await loadPresets();

    // Reset dropdown to default
    document.getElementById('kvpPresetSelect').value = '';

  } catch (error) {
    console.error('Error deleting preset:', error);
    await Dialog.alert('Error deleting preset: ' + error.message, 'Error');
  }
}

// ============================================================================
// SAVE/UPDATE PRESET
// ============================================================================

// Save preset as new - always creates a new preset
KVPModal.savePreset = async function() {
  try {
    await saveAsNewPreset();
  } catch (error) {
    console.error('Error saving preset:', error);
    await Dialog.alert('Error saving preset: ' + error.message, 'Error');
  }
};

async function saveAsNewPreset() {
  const presetName = document.getElementById('kvpPresetName').value.trim();

  if (!presetName) {
    await Dialog.alert('Please enter a preset name', 'Preset Name Required');
    return;
  }

  // Collect selected KVPs
  const kvps = [];
  KVPModal.selectedKVPs.forEach(id => {
    if (id.startsWith('master-')) {
      const kvpId = parseInt(id.replace('master-', ''));
      kvps.push({ master_kvp_id: kvpId });
    } else if (id.startsWith('custom-')) {
      const keyName = id.replace('custom-', '');
      kvps.push({ custom_key_name: keyName });
    }
  });

  if (kvps.length === 0) {
    await Dialog.alert('Please select at least one field', 'No Fields Selected');
    return;
  }

  const response = await fetch(`${API_URL}/api/kvp/presets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      preset_name: presetName,
      description: '',
      kvps
    })
  });

  const data = await response.json();

  if (!data.success) {
    await Dialog.alert(data.error || 'Failed to save preset', 'Error');
    return;
  }

  await Dialog.alert(`Preset "${presetName}" saved successfully!`, 'Success');

  // Clear input
  document.getElementById('kvpPresetName').value = '';

  // Reload presets dropdown
  await loadPresets();

  // Fetch the full preset with KVPs and apply it
  const fullPresetResponse = await fetch(`${API_URL}/api/kvp/presets/${data.data.preset.id}`, {
    credentials: 'include'
  });

  const fullPresetData = await fullPresetResponse.json();

  if (fullPresetData.success) {
    applyPreset(fullPresetData.data.preset);
  }
}

async function updatePresetContents(presetId) {
  // Collect selected KVPs
  const kvps = [];
  KVPModal.selectedKVPs.forEach(id => {
    if (id.startsWith('master-')) {
      const kvpId = parseInt(id.replace('master-', ''));
      kvps.push({ master_kvp_id: kvpId });
    } else if (id.startsWith('custom-')) {
      const keyName = id.replace('custom-', '');
      kvps.push({ custom_key_name: keyName });
    }
  });

  if (kvps.length === 0) {
    await Dialog.alert('Please select at least one field', 'No Fields Selected');
    return;
  }

  const response = await fetch(`${API_URL}/api/kvp/presets/${presetId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      preset_name: KVPModal.currentPreset.preset_name,
      description: KVPModal.currentPreset.description || '',
      kvps // Send the updated KVPs
    })
  });

  const data = await response.json();

  if (!data.success) {
    await Dialog.alert(data.error || 'Failed to update preset', 'Error');
    return;
  }

  await Dialog.alert(`Preset "${KVPModal.currentPreset.preset_name}" updated successfully!`, 'Success');

  // Reload presets dropdown
  await loadPresets();

  // Reload the preset to sync state
  const refreshResponse = await fetch(`${API_URL}/api/kvp/presets/${presetId}`, {
    credentials: 'include'
  });

  const refreshData = await refreshResponse.json();

  if (refreshData.success) {
    applyPreset(refreshData.data.preset);
  }
}

function updateSaveButtonState() {
  const saveBtn = document.getElementById('kvpSavePresetBtn');
  const presetNameInput = document.getElementById('kvpPresetName');

  if (!saveBtn) return;

  const hasPreset = KVPModal.currentPreset !== null;

  // Update button text - always "Save as New" if preset loaded, otherwise "Save Preset"
  if (hasPreset) {
    saveBtn.textContent = 'Save as New';
    saveBtn.disabled = false;
    saveBtn.title = 'Save as a new preset';
  } else {
    saveBtn.textContent = 'Save Preset';
    saveBtn.disabled = KVPModal.selectedKVPs.size === 0;
    saveBtn.title = KVPModal.selectedKVPs.size === 0 ? 'Select fields to save preset' : 'Save as new preset';
  }
}

// ============================================================================
// SELECT ALL
// ============================================================================

function toggleSelectAllKVPs(checked) {
  if (checked) {
    // Select all visible KVPs
    KVPModal.selectedSectors.forEach(sector => {
      const kvps = KVPModal.allKVPs[sector.id] || [];
      kvps.forEach(kvp => {
        KVPModal.selectedKVPs.add(`master-${kvp.kvp_id}`);
      });
    });

    // Select all custom KVPs
    KVPModal.customKVPs.forEach(customKvp => {
      KVPModal.selectedKVPs.add(`custom-${customKvp.custom_key_name}`);
    });
  } else {
    KVPModal.selectedKVPs.clear();
  }

  renderKVPList();
  updatePresetSaveVisibility();
}

function toggleSelectAllFiles(checked) {
  document.querySelectorAll('.kvp-file-checkbox').forEach(cb => {
    cb.checked = checked;
  });
  updateProcessCount();
}

// ============================================================================
// PROCESS EXTRACTION
// ============================================================================

// ============================================================================
// UNIFIED PROCESSING
// ============================================================================

async function processFiles() {
  const selectedFiles = getSelectedFiles();

  if (selectedFiles.length === 0) {
    await Dialog.alert('Please select at least one file', 'No Files Selected');
    return;
  }

  // Check which features are enabled
  const kvpEnabled = document.getElementById('kvpEnableToggle')?.checked || false;
  const anonEnabled = document.getElementById('anonEnableToggle')?.checked || false;

  if (!kvpEnabled && !anonEnabled) {
    await Dialog.alert('Please enable at least one processing option (KVP Extraction or Anonymization)', 'No Processing Enabled');
    return;
  }

  // Validate KVP selection if enabled
  if (kvpEnabled && KVPModal.selectedKVPs.size === 0) {
    await Dialog.alert('KVP Extraction is enabled but no fields are selected', 'No KVP Fields Selected');
    return;
  }

  // Validate Anon selection if enabled
  if (anonEnabled && AnonModal.selectedEntities.size === 0) {
    await Dialog.alert('Anonymization is enabled but no entities are selected', 'No Entities Selected');
    return;
  }

  // Prepare KVP data if enabled
  let kvps = [];
  if (kvpEnabled) {
    KVPModal.selectedKVPs.forEach(id => {
      if (id.startsWith('master-')) {
        const kvpId = parseInt(id.replace('master-', ''));
        let kvpData = null;
        for (const sectorId in KVPModal.allKVPs) {
          const foundKvp = KVPModal.allKVPs[sectorId].find(k => k.kvp_id === kvpId);
          if (foundKvp) {
            kvpData = foundKvp;
            break;
          }
        }
        kvps.push({
          master_kvp_id: kvpId,
          key_name: kvpData ? kvpData.key_name : `kvp_${kvpId}`
        });
      } else if (id.startsWith('custom-')) {
        const keyName = id.replace('custom-', '');
        kvps.push({
          custom_key_name: keyName,
          key_name: keyName
        });
      }
    });
  }

  // Prepare Anon data if enabled
  let anonEntities = [];
  if (anonEnabled) {
    anonEntities = Array.from(AnonModal.selectedEntities);
  }

  console.log('Processing files:', {
    files: selectedFiles.length,
    kvpEnabled,
    anonEnabled,
    kvps: kvps.length,
    anonEntities: anonEntities.length
  });

  // Close modal
  closeKVPModal();

  // Process each file
  if (typeof window.uploadFileWithProcessing === 'function') {
    for (const file of selectedFiles) {
      await window.uploadFileWithProcessing(file, {
        kvpEnabled,
        anonEnabled,
        kvps,
        anonEntities,
        anonSectors: AnonModal.selectedSectors.map(s => s.id)
      });
    }
  } else {
    console.error('uploadFileWithProcessing function not found');
    await Dialog.alert('Upload system not ready. Please refresh the page.', 'Error');
  }
}

async function processKVPExtraction() {
  const selectedFiles = getSelectedFiles();

  if (selectedFiles.length === 0) {
    await Dialog.alert('Please select at least one file', 'No Files Selected');
    return;
  }

  if (KVPModal.selectedKVPs.size === 0) {
    await Dialog.alert('Please select at least one field to extract', 'No Fields Selected');
    return;
  }

  // Collect KVPs to extract with key names
  const kvps = [];
  KVPModal.selectedKVPs.forEach(id => {
    if (id.startsWith('master-')) {
      const kvpId = parseInt(id.replace('master-', ''));

      // Find the KVP data to get key_name
      let kvpData = null;
      for (const sectorId in KVPModal.allKVPs) {
        const foundKvp = KVPModal.allKVPs[sectorId].find(k => k.kvp_id === kvpId);
        if (foundKvp) {
          kvpData = foundKvp;
          break;
        }
      }

      kvps.push({
        master_kvp_id: kvpId,
        key_name: kvpData ? kvpData.key_name : `kvp_${kvpId}` // Fallback if not found
      });
    } else if (id.startsWith('custom-')) {
      const keyName = id.replace('custom-', '');
      kvps.push({
        custom_key_name: keyName,
        key_name: keyName  // For custom fields, key_name is the same
      });
    }
  });

  console.log('Processing KVP extraction:', {
    files: selectedFiles.length,
    kvps: kvps.length,
    sectors: KVPModal.selectedSectors.map(s => s.id)
  });

  // Close modal
  closeKVPModal();

  // Process each file with KVP extraction
  if (typeof window.uploadFileWithKVP === 'function') {
    for (const file of selectedFiles) {
      await window.uploadFileWithKVP(file, kvps);
    }
  } else {
    console.error('uploadFileWithKVP function not found');
    await Dialog.alert('Upload system not ready. Please refresh the page.', 'Error');
  }
}

// ============================================================================
// TAB SWITCHING
// ============================================================================

function switchTab(tabName) {
  // Update tab buttons
  document.querySelectorAll('.kvp-tab').forEach(tab => {
    if (tab.dataset.tab === tabName) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  // Update tab content
  document.querySelectorAll('.kvp-tab-content').forEach(content => {
    content.classList.remove('active');
  });

  const targetTab = document.getElementById(`${tabName}Tab`);
  if (targetTab) {
    targetTab.classList.add('active');

    // Load anonymization data when switching to anon tab
    if (tabName === 'anonymization') {
      loadAnonData();
    }
  }
}

function loadAnonData() {
  // Don't clear state - persist selections when switching tabs
  // State is only cleared when modal is opened (in openKVPModal)

  // Update file list for anon tab
  renderAnonFileList();

  // Load sectors (categories) for anonymization (if not already loaded)
  if (AnonModal.allSectors.length === 0) {
    loadAnonSectors();
  }

  // Load presets (if not already loaded)
  if (AnonModal.presets.length === 0) {
    loadAnonPresets();
  }

  // Load custom entities from database (if not already loaded)
  if (AnonModal.customEntities.length === 0) {
    loadAnonCustomEntities();
  }

  // Re-render with current state
  renderAnonSelectedCategories();
  renderAnonEntityList();
  renderAnonActivePresetCard();
  updateAnonPresetSaveVisibility();
}

function clearAnonState() {
  AnonModal.selectedSectors = [];
  AnonModal.selectedEntities.clear();
  AnonModal.customEntities = [];
  AnonModal.allEntities = {};
  AnonModal.currentPreset = null;

  // Clear UI
  renderAnonSelectedCategories();
  renderAnonEntityList();
  renderAnonActivePresetCard();
  updateAnonPresetSaveVisibility();

  // Clear inputs
  const categorySelect = document.getElementById('anonCategorySelect');
  const presetSelect = document.getElementById('anonPresetSelect');
  const customEntityInput = document.getElementById('anonCustomEntity');
  const presetNameInput = document.getElementById('anonPresetName');

  if (categorySelect) categorySelect.value = '';
  if (presetSelect) presetSelect.value = '';
  if (customEntityInput) customEntityInput.value = '';
  if (presetNameInput) presetNameInput.value = '';
}

async function loadAnonCustomEntities() {
  try {
    const response = await fetch(`${API_URL}/api/anon/custom-entities`, {
      credentials: 'include',
      headers: { 'x-user-id': localStorage.getItem('user_id') }
    });

    const data = await response.json();
    if (data.success && data.entities) {
      // Load custom entities into state (but don't select them)
      AnonModal.customEntities = data.entities.map(e => ({
        id: e.id,
        name: e.custom_entity_name
      }));
      renderAnonEntityList();
    }
  } catch (error) {
    console.error('Error loading custom anon entities:', error);
  }
}

async function loadAnonSectors() {
  try {
    const response = await fetch(`${API_URL}/api/anon/sectors`, {
      credentials: 'include',
      headers: { 'x-user-id': localStorage.getItem('user_id') }
    });

    const data = await response.json();
    if (data.success && data.sectors) {
      AnonModal.allSectors = data.sectors;
      const select = document.getElementById('anonCategorySelect');
      if (select) {
        select.innerHTML = '<option value="">Select category...</option>';
        data.sectors.forEach(sector => {
          const option = document.createElement('option');
          option.value = sector.id;
          option.textContent = sector.name;
          select.appendChild(option);
        });
      }
    }
  } catch (error) {
    console.error('Error loading anon sectors:', error);
  }
}

async function loadAnonPresets() {
  try {
    const response = await fetch(`${API_URL}/api/anon/presets`, {
      credentials: 'include',
      headers: { 'x-user-id': localStorage.getItem('user_id') }
    });

    const data = await response.json();
    if (data.success && data.presets) {
      AnonModal.presets = data.presets;
      const select = document.getElementById('anonPresetSelect');
      if (select) {
        select.innerHTML = '<option value="">Select preset...</option>';
        data.presets.forEach(preset => {
          const option = document.createElement('option');
          option.value = preset.id;
          option.textContent = preset.preset_name;
          select.appendChild(option);
        });
      }
    }
  } catch (error) {
    console.error('Error loading anon presets:', error);
  }
}

function renderAnonFileList() {
  const container = document.getElementById('anonFileList');
  const countSpan = document.getElementById('anonFileCount');

  if (!container) return;

  container.innerHTML = '';
  countSpan.textContent = KVPModal.selectedFiles.length;

  if (KVPModal.selectedFiles.length === 0) {
    container.innerHTML = `
      <label class="kvp-file-item">
        <input type="checkbox" class="kvp-file-checkbox" checked disabled>
        <span class="kvp-file-name">No files selected</span>
      </label>
    `;
    return;
  }

  KVPModal.selectedFiles.forEach((file, index) => {
    const fileItem = document.createElement('label');
    fileItem.className = 'kvp-file-item';
    fileItem.innerHTML = `
      <input type="checkbox" class="kvp-file-checkbox" id="anonFile${index}" checked>
      <span class="kvp-file-name">${file.name}</span>
    `;
    container.appendChild(fileItem);
  });
}

// ============================================================================
// ANON STATE & FUNCTIONALITY
// ============================================================================

const AnonModal = {
  allSectors: [],
  selectedSectors: [],
  allEntities: {}, // { sectorId: [entities...] }
  selectedEntities: new Set(),
  customEntities: [],
  presets: [],
  currentPreset: null,
  originalPresetState: null, // Track original state for change detection

  // Check if current selections differ from original preset
  hasChanges() {
    if (!this.currentPreset || !this.originalPresetState) {
      return false;
    }

    // Compare selected entities
    const currentEntities = Array.from(this.selectedEntities).sort();
    const originalEntities = Array.from(this.originalPresetState.selectedEntities).sort();

    if (currentEntities.length !== originalEntities.length) {
      return true;
    }

    for (let i = 0; i < currentEntities.length; i++) {
      if (currentEntities[i] !== originalEntities[i]) {
        return true;
      }
    }

    return false;
  },

  // Save current state as original (for change detection)
  saveOriginalState() {
    this.originalPresetState = {
      selectedEntities: new Set(this.selectedEntities),
      selectedSectors: [...this.selectedSectors]
    };
  },

  // Clear original state
  clearOriginalState() {
    this.originalPresetState = null;
  }
};

async function onAnonCategorySelect(sectorId) {
  if (!sectorId) return;

  console.log('Selected sector ID:', sectorId, 'Type:', typeof sectorId);
  console.log('Available sectors:', AnonModal.allSectors);

  // Use loose equality to handle string/number mismatch
  const sector = AnonModal.allSectors.find(s => s.id == sectorId);
  if (!sector) {
    console.error('Sector not found for ID:', sectorId);
    return;
  }

  console.log('Found sector:', sector);

  // Check if already selected
  if (AnonModal.selectedSectors.find(s => s.id == sector.id)) {
    console.log('Sector already selected:', sector.name);
    return;
  }

  // Add to selected sectors
  AnonModal.selectedSectors.push(sector);
  console.log('Added sector to selected:', sector.name);

  // Load entities for selected sectors
  console.log('Loading entities for sectors...');
  await loadAnonEntitiesForSectors();
  console.log('Entities loaded:', AnonModal.allEntities);

  // Auto-select all entities from this sector
  const entities = AnonModal.allEntities[sector.id] || [];
  console.log('Entities for sector', sector.id, ':', entities);
  entities.forEach(entity => {
    AnonModal.selectedEntities.add(entity.key_name);
  });

  // Render UI
  renderAnonSelectedCategories();
  renderAnonEntityList();
  renderAnonActivePresetCard();
  updateAnonPresetSaveVisibility();

  // Reset dropdown
  document.getElementById('anonCategorySelect').value = '';
}

function removeAnonCategory(sectorId) {
  console.log('Removing sector:', sectorId);
  AnonModal.selectedSectors = AnonModal.selectedSectors.filter(s => s.id != sectorId);

  // Remove entities from this sector from selection
  if (AnonModal.allEntities[sectorId]) {
    AnonModal.allEntities[sectorId].forEach(entity => {
      AnonModal.selectedEntities.delete(entity.key_name);
    });
  }

  renderAnonSelectedCategories();
  renderAnonEntityList();
  renderAnonActivePresetCard();
  updateAnonPresetSaveVisibility();
}

async function loadAnonEntitiesForSectors() {
  if (AnonModal.selectedSectors.length === 0) return;

  try {
    const sectorIds = AnonModal.selectedSectors.map(s => s.id);
    console.log('Fetching entities for sector IDs:', sectorIds);

    const response = await fetch(`${API_URL}/api/anon/sectors/fields`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': localStorage.getItem('user_id')
      },
      body: JSON.stringify({ sector_ids: sectorIds })
    });

    const data = await response.json();
    console.log('API response for entities:', data);

    if (data.success && data.fields) {
      console.log('Fields received:', data.fields.length);
      // Group by sector
      data.fields.forEach(field => {
        if (!AnonModal.allEntities[field.sector_id]) {
          AnonModal.allEntities[field.sector_id] = [];
        }
        AnonModal.allEntities[field.sector_id].push(field);
      });
    } else {
      console.error('Failed to load entities:', data.error || 'Unknown error');
    }
  } catch (error) {
    console.error('Error loading anon entities:', error);
  }
}

function renderAnonSelectedCategories() {
  const container = document.getElementById('anonSelectedCategories');
  if (!container) return;

  if (AnonModal.selectedSectors.length === 0) {
    container.innerHTML = '';
    return;
  }

  const sectorsHtml = AnonModal.selectedSectors.map(sector => `
    <div class="kvp-sector-chip">
      <span>${sector.name}</span>
      <button onclick="removeAnonCategory('${sector.id}')">×</button>
    </div>
  `).join('');

  const clearButton = AnonModal.selectedSectors.length > 0 ? `
    <button class="kvp-clear-sectors-btn" onclick="clearAllAnonCategories()" title="Clear all categories">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
      Clear All
    </button>
  ` : '';

  container.innerHTML = sectorsHtml + clearButton;
}

function clearAllAnonCategories() {
  // Clear categories
  AnonModal.selectedSectors = [];
  AnonModal.allEntities = {};
  AnonModal.selectedEntities.clear();

  // Re-render
  renderAnonSelectedCategories();
  renderAnonEntityList();
  updateAnonPresetSaveVisibility();
  renderAnonActivePresetCard();
}

function renderAnonEntityList() {
  const container = document.getElementById('anonEntityList');
  if (!container) return;

  // Check if we have any data to display
  const hasCustomEntities = AnonModal.customEntities.length > 0;
  const hasSectors = AnonModal.selectedSectors.length > 0;

  let html = '';

  // Custom entities section (always visible if user has any custom entities)
  if (hasCustomEntities) {
    const customCount = AnonModal.customEntities.length;
    html += `
      <div class="kvp-sector-group">
        <div class="kvp-sector-group-header">CUSTOM FIELDS <span class="kvp-sector-group-count">${customCount}</span></div>
        <div class="kvp-sector-group-items">
          ${AnonModal.customEntities.map(entity => {
            const entityName = entity.name || entity;
            const entityId = entity.id || entity;
            const isChecked = AnonModal.selectedEntities.has(entityName);
            return `
              <label class="kvp-item">
                <input
                  type="checkbox"
                  class="kvp-checkbox"
                  value="${entityName}"
                  ${isChecked ? 'checked' : ''}
                  onchange="toggleAnonEntity('${entityName}', this.checked)"
                >
                <span class="kvp-item-label">${entityName}</span>
              </label>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // Track which entities we've shown
  const shownEntities = new Set();

  // Add custom entity names to shown set
  AnonModal.customEntities.forEach(entity => {
    const entityName = entity.name || entity;
    shownEntities.add(entityName);
  });

  // Sector groups
  AnonModal.selectedSectors.forEach(sector => {
    const entities = AnonModal.allEntities[sector.id] || [];
    if (entities.length === 0) return;

    const sectorName = sector.name.toUpperCase();
    const entityCount = entities.length;

    // Sort entities by key_name
    entities.sort((a, b) => a.key_name.localeCompare(b.key_name));

    html += `
      <div class="kvp-sector-group">
        <div class="kvp-sector-group-header">${sectorName} <span class="kvp-sector-group-count">${entityCount}</span></div>
        <div class="kvp-sector-group-items">
          ${entities.map(entity => {
            shownEntities.add(entity.key_name);
            const isChecked = AnonModal.selectedEntities.has(entity.key_name);
            const displayName = entity.display_name || entity.key_name;
            return `
              <label class="kvp-item">
                <input
                  type="checkbox"
                  class="kvp-checkbox"
                  value="${entity.key_name}"
                  ${isChecked ? 'checked' : ''}
                  onchange="toggleAnonEntity('${entity.key_name}', this.checked)"
                >
                <span class="kvp-item-label">${displayName}</span>
              </label>
            `;
          }).join('')}
        </div>
      </div>
    `;
  });

  // Show selected entities that aren't in any loaded sector (from presets)
  const orphanedEntities = Array.from(AnonModal.selectedEntities).filter(e => !shownEntities.has(e));
  if (orphanedEntities.length > 0) {
    html += `
      <div class="kvp-sector-group">
        <div class="kvp-sector-group-header">SELECTED FIELDS <span class="kvp-sector-group-count">${orphanedEntities.length}</span></div>
        <div class="kvp-sector-group-items">
          ${orphanedEntities.map(entityName => {
            return `
              <label class="kvp-item">
                <input
                  type="checkbox"
                  class="kvp-checkbox"
                  value="${entityName}"
                  checked
                  onchange="toggleAnonEntity('${entityName}', this.checked)"
                >
                <span class="kvp-item-label">${entityName}</span>
              </label>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // Show empty message only if no custom entities AND no sectors AND no orphaned entities
  if (!hasCustomEntities && !hasSectors && orphanedEntities.length === 0) {
    html = '<p class="kvp-empty-message">Select a category or add custom entities to begin</p>';
  }

  container.innerHTML = html;

  // Update select all checkbox
  const selectAllCheckbox = document.getElementById('anonSelectAllEntities');
  if (selectAllCheckbox) {
    const totalEntities = AnonModal.customEntities.length +
      AnonModal.selectedSectors.reduce((sum, s) => sum + (AnonModal.allEntities[s.id] || []).length, 0);
    selectAllCheckbox.checked = totalEntities > 0 && AnonModal.selectedEntities.size === totalEntities;
  }
}

function toggleAnonEntity(entityName, checked) {
  if (checked) {
    AnonModal.selectedEntities.add(entityName);
  } else {
    AnonModal.selectedEntities.delete(entityName);
  }
  updateAnonPresetSaveVisibility();
  renderAnonActivePresetCard(); // Re-render to show Modified status
}

function toggleAnonSelectAllEntities(checked) {
  if (checked) {
    // Select all entities from sectors
    AnonModal.selectedSectors.forEach(sector => {
      const entities = AnonModal.allEntities[sector.id] || [];
      entities.forEach(entity => AnonModal.selectedEntities.add(entity.key_name));
    });

    // Select all custom entities
    AnonModal.customEntities.forEach(entity => {
      const entityName = entity.name || entity;
      AnonModal.selectedEntities.add(entityName);
    });
  } else {
    // Deselect all
    AnonModal.selectedEntities.clear();
  }
  renderAnonEntityList();
  updateAnonPresetSaveVisibility();
  renderAnonActivePresetCard(); // Re-render to show Modified status
}

async function addAnonCustomEntity() {
  const input = document.getElementById('anonCustomEntity');
  const entityName = input.value.trim();

  if (!entityName) return;

  // Check if already exists
  const exists = AnonModal.customEntities.some(e => (e.name || e) === entityName);
  if (exists) {
    await Dialog.alert('This entity already exists', 'Duplicate Entity');
    return;
  }

  try {
    // Save to database
    const response = await fetch(`${API_URL}/api/anon/custom-entities`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': localStorage.getItem('user_id')
      },
      body: JSON.stringify({ custom_entity_name: entityName })
    });

    const data = await response.json();
    if (data.success) {
      // Add to custom entities (but don't auto-select - user must check it)
      AnonModal.customEntities.push({
        id: data.entity.id,
        name: data.entity.custom_entity_name
      });
      // NOTE: NOT adding to selectedEntities - it should be unchecked by default

      // Clear input
      input.value = '';

      // Render UI
      renderAnonEntityList();
      updateAnonPresetSaveVisibility();
    } else {
      await Dialog.alert(data.error || 'Failed to add custom entity', 'Error');
    }
  } catch (error) {
    console.error('Error adding custom anon entity:', error);
    await Dialog.alert('Error adding custom entity: ' + error.message, 'Error');
  }
}

async function removeAnonCustomEntity(entityId) {
  try {
    // Delete from database
    const response = await fetch(`${API_URL}/api/anon/custom-entities/${entityId}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'x-user-id': localStorage.getItem('user_id') }
    });

    const data = await response.json();
    if (data.success) {
      // Remove from state
      const entity = AnonModal.customEntities.find(e => e.id == entityId);
      if (entity) {
        const entityName = entity.name || entity;
        AnonModal.customEntities = AnonModal.customEntities.filter(e => e.id != entityId);
        AnonModal.selectedEntities.delete(entityName);
      }

      renderAnonEntityList();
      updateAnonPresetSaveVisibility();
    } else {
      await Dialog.alert(data.error || 'Failed to remove custom entity', 'Error');
    }
  } catch (error) {
    console.error('Error removing custom anon entity:', error);
    await Dialog.alert('Error removing custom entity: ' + error.message, 'Error');
  }
}

function updateAnonPresetSaveVisibility() {
  const presetNameGroup = document.getElementById('anonPresetNameGroup');
  const saveBtn = document.getElementById('anonSavePresetBtn');
  const presetNameInput = document.getElementById('anonPresetName');

  if (!presetNameGroup || !saveBtn) return;

  const hasPreset = AnonModal.currentPreset !== null;
  const hasSelections = AnonModal.selectedEntities.size > 0;

  // Show preset name input if user has made selections
  if (hasSelections) {
    presetNameGroup.style.display = 'block';
  } else {
    presetNameGroup.style.display = 'none';
  }

  // Update button text and state
  if (hasPreset) {
    saveBtn.textContent = 'Save as New';
    saveBtn.disabled = false;
    saveBtn.title = 'Save as a new preset';
  } else {
    saveBtn.textContent = 'Save';
    saveBtn.disabled = !hasSelections;
    saveBtn.title = hasSelections ? 'Save as new preset' : 'Select entities to save preset';
  }
}

async function onAnonPresetSelect(presetId) {
  if (!presetId || presetId === '') {
    clearAnonSelections();
    return;
  }

  try {
    const preset = AnonModal.presets.find(p => p.id === parseInt(presetId));
    if (!preset) return;

    // Clear current selections
    clearAnonSelections();

    // Reload custom entities (they were cleared by clearAnonSelections)
    await loadAnonCustomEntities();

    // Parse selected_fields
    const selectedFields = typeof preset.selected_fields === 'string'
      ? JSON.parse(preset.selected_fields)
      : preset.selected_fields;

    console.log('Loading preset with fields:', selectedFields);

    // Add all fields to selection immediately
    selectedFields.forEach(field => {
      AnonModal.selectedEntities.add(field);
    });

    // Load all sectors first if not already loaded
    if (AnonModal.allSectors.length === 0) {
      await loadAnonSectors();
    }

    // Parse selected_sectors
    const selectedSectorIds = typeof preset.selected_sectors === 'string'
      ? JSON.parse(preset.selected_sectors)
      : (preset.selected_sectors || []);

    console.log('Loading preset with sectors:', selectedSectorIds);

    // Convert sector IDs to sector objects
    const sectorsToLoad = selectedSectorIds
      .map(sectorId => AnonModal.allSectors.find(s => s.id === sectorId))
      .filter(s => s);

    console.log('Sectors to load:', sectorsToLoad.map(s => s.name));

    // Add sectors to selected list
    AnonModal.selectedSectors = sectorsToLoad;

    // Set current preset
    AnonModal.currentPreset = preset;

    // Load entities for these sectors
    if (sectorsToLoad.length > 0) {
      await loadAnonEntitiesForSectors();
    }

    // Log detailed info about what was loaded
    console.log('=== PRESET LOADING DEBUG ===');
    console.log('Selected entities:', Array.from(AnonModal.selectedEntities));
    console.log('Loaded sectors:', Object.keys(AnonModal.allEntities));

    // Check which entities are in loaded sectors
    const entitiesInSectors = new Set();
    Object.values(AnonModal.allEntities).forEach(entities => {
      entities.forEach(e => entitiesInSectors.add(e.key_name));
    });

    const customEntityNames = AnonModal.customEntities.map(e => e.name || e);
    const entitiesNotInSectors = Array.from(AnonModal.selectedEntities).filter(
      e => !entitiesInSectors.has(e) && !customEntityNames.includes(e)
    );

    console.log('Entities in loaded sectors:', Array.from(entitiesInSectors));
    console.log('Custom entities:', customEntityNames);
    console.log('Entities NOT in any loaded sector:', entitiesNotInSectors);
    console.log('=== END DEBUG ===');

    // Render UI
    renderAnonSelectedCategories();
    renderAnonEntityList();
    renderAnonActivePresetCard();
    updateAnonPresetSaveVisibility();

    // Save original state AFTER everything is loaded
    AnonModal.saveOriginalState();

    // Reset dropdown
    document.getElementById('anonPresetSelect').value = '';
  } catch (error) {
    console.error('Error loading anon preset:', error);
  }
}

function renderAnonActivePresetCard() {
  const container = document.getElementById('anonActivePresetCard');

  if (!container) return;

  if (!AnonModal.currentPreset) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  const hasChanges = AnonModal.hasChanges();
  const statusClass = hasChanges ? 'modified' : 'loaded';
  const statusText = hasChanges ? 'Modified' : 'Loaded';
  const statusIcon = hasChanges ? '●' : '✓';

  container.style.display = 'block';
  container.innerHTML = `
    <div class="kvp-active-preset-card ${statusClass}">
      <div class="kvp-active-preset-info">
        <span class="kvp-active-preset-status">${statusIcon} ${statusText}</span>
        <span class="kvp-active-preset-name">${AnonModal.currentPreset.preset_name}</span>
      </div>
      <div class="kvp-active-preset-actions">
        ${hasChanges ? `
          <button class="kvp-preset-update-btn" onclick="updateCurrentAnonPreset()" title="Update this preset with changes">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
            Update
          </button>
        ` : ''}
        <button class="kvp-preset-action-btn" onclick="renameAnonPresetDialog()" title="Rename preset">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </button>
        <button class="kvp-preset-action-btn" onclick="deleteAnonPresetDialog()" title="Delete preset">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
        <button class="kvp-preset-action-btn" onclick="clearAnonActivePreset()" title="Clear preset">
          ×
        </button>
      </div>
    </div>
  `;
}

function clearAnonActivePreset() {
  // Clear all state
  AnonModal.selectedSectors = [];
  AnonModal.selectedEntities.clear();
  AnonModal.allEntities = {};
  AnonModal.currentPreset = null;
  AnonModal.clearOriginalState();

  // Reset preset dropdown
  document.getElementById('anonPresetSelect').value = '';

  // Re-render UI
  renderAnonSelectedCategories();
  renderAnonEntityList();
  renderAnonActivePresetCard();
  updateAnonPresetSaveVisibility();
}

// ============================================================================
// RENAME PRESET
// ============================================================================

async function renameAnonPresetDialog() {
  if (!AnonModal.currentPreset) return;

  const newName = await Dialog.prompt(
    'Enter a new name for the preset:',
    'Rename Preset',
    AnonModal.currentPreset.preset_name
  );

  if (!newName || newName === '') {
    return;
  }

  if (newName === AnonModal.currentPreset.preset_name) {
    return; // No change
  }

  await renameAnonPreset(AnonModal.currentPreset.id, newName);
}

async function renameAnonPreset(presetId, newName) {
  try {
    const response = await fetch(`${API_URL}/api/anon/presets/${presetId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': localStorage.getItem('user_id')
      },
      credentials: 'include',
      body: JSON.stringify({
        preset_name: newName,
        strategy_id: AnonModal.currentPreset.strategy_id || 'redact',
        generate_audit: AnonModal.currentPreset.generate_audit || false,
        selected_fields: AnonModal.currentPreset.selected_fields,
        selected_sectors: AnonModal.currentPreset.selected_sectors || []
      })
    });

    const data = await response.json();

    if (!data.success) {
      await Dialog.alert(data.error || 'Failed to rename preset', 'Error');
      return;
    }

    // Update current preset name
    AnonModal.currentPreset.preset_name = newName;

    // Reload presets dropdown
    await loadAnonPresets();

    // Update active preset card
    renderAnonActivePresetCard();

    await Dialog.alert(`Preset renamed to "${newName}"`, 'Success');

  } catch (error) {
    console.error('Error renaming anon preset:', error);
    await Dialog.alert('Error renaming preset: ' + error.message, 'Error');
  }
}

// ============================================================================
// DELETE PRESET
// ============================================================================

async function deleteAnonPresetDialog() {
  if (!AnonModal.currentPreset) return;

  const confirmed = await Dialog.confirm(
    `Are you sure you want to delete the preset "${AnonModal.currentPreset.preset_name}"?\n\nThis action cannot be undone.`,
    'Delete Preset',
    true // isDanger
  );

  if (confirmed) {
    await deleteAnonPreset(AnonModal.currentPreset.id);
  }
}

async function deleteAnonPreset(presetId) {
  try {
    const response = await fetch(`${API_URL}/api/anon/presets/${presetId}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'x-user-id': localStorage.getItem('user_id') }
    });

    const data = await response.json();

    if (!data.success) {
      await Dialog.alert(data.error || 'Failed to delete preset', 'Error');
      return;
    }

    await Dialog.alert('Preset deleted successfully', 'Success');

    // Clear current preset
    clearAnonActivePreset();

    // Reload presets dropdown
    await loadAnonPresets();

    // Reset dropdown to default
    document.getElementById('anonPresetSelect').value = '';

  } catch (error) {
    console.error('Error deleting anon preset:', error);
    await Dialog.alert('Error deleting preset: ' + error.message, 'Error');
  }
}

// ============================================================================
// UPDATE PRESET
// ============================================================================

async function updateCurrentAnonPreset() {
  if (!AnonModal.currentPreset) return;
  await updateAnonPresetContents(AnonModal.currentPreset.id);
}

async function updateAnonPresetContents(presetId) {
  if (AnonModal.selectedEntities.size === 0) {
    await Dialog.alert('Please select at least one entity', 'No Entities Selected');
    return;
  }

  try {
    const response = await fetch(`${API_URL}/api/anon/presets/${presetId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': localStorage.getItem('user_id')
      },
      credentials: 'include',
      body: JSON.stringify({
        preset_name: AnonModal.currentPreset.preset_name,
        strategy_id: AnonModal.currentPreset.strategy_id || 'redact',
        generate_audit: AnonModal.currentPreset.generate_audit || false,
        selected_fields: Array.from(AnonModal.selectedEntities),
        selected_sectors: AnonModal.selectedSectors.map(s => s.id)
      })
    });

    const data = await response.json();

    if (!data.success) {
      await Dialog.alert(data.error || 'Failed to update preset', 'Error');
      return;
    }

    await Dialog.alert(`Preset "${AnonModal.currentPreset.preset_name}" updated successfully!`, 'Success');

    // Update the preset in state
    AnonModal.currentPreset.selected_fields = Array.from(AnonModal.selectedEntities);
    AnonModal.saveOriginalState();

    // Reload presets dropdown
    await loadAnonPresets();

    // Re-render
    renderAnonActivePresetCard();
    updateAnonPresetSaveVisibility();

  } catch (error) {
    console.error('Error updating anon preset:', error);
    await Dialog.alert('Error updating preset: ' + error.message, 'Error');
  }
}

function clearAnonSelections() {
  AnonModal.selectedSectors = [];
  AnonModal.selectedEntities.clear();
  AnonModal.customEntities = [];
  AnonModal.allEntities = {};
  AnonModal.currentPreset = null;

  renderAnonSelectedCategories();
  renderAnonEntityList();
  renderAnonActivePresetCard();
  updateAnonPresetSaveVisibility();
}

async function saveAnonPreset() {
  const presetNameInput = document.getElementById('anonPresetName');
  const presetName = presetNameInput.value.trim();

  if (!presetName) {
    await Dialog.alert('Please enter a preset name', 'Preset Name Required');
    return;
  }

  if (AnonModal.selectedEntities.size === 0) {
    await Dialog.alert('Please select at least one entity', 'No Entities Selected');
    return;
  }

  try {
    const response = await fetch(`${API_URL}/api/anon/presets`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': localStorage.getItem('user_id')
      },
      body: JSON.stringify({
        preset_name: presetName,
        strategy_id: 'redact', // Default strategy
        generate_audit: false,
        selected_fields: Array.from(AnonModal.selectedEntities),
        selected_sectors: AnonModal.selectedSectors.map(s => s.id)
      })
    });

    const data = await response.json();
    if (data.success) {
      await Dialog.alert(`Preset "${presetName}" saved successfully!`, 'Success');
      presetNameInput.value = '';
      await loadAnonPresets();

      // Apply the newly created preset
      const preset = data.preset || data.data?.preset;
      if (preset) {
        AnonModal.currentPreset = preset;
        AnonModal.saveOriginalState();
        renderAnonActivePresetCard();
        updateAnonPresetSaveVisibility();
      }
    } else {
      await Dialog.alert(data.error || 'Failed to save preset', 'Error');
    }
  } catch (error) {
    console.error('Error saving anon preset:', error);
    await Dialog.alert('Error saving preset: ' + error.message, 'Error');
  }
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  // Tab switching
  document.querySelectorAll('.kvp-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const tabName = tab.dataset.tab;
      switchTab(tabName);
    });
  });

  // Close modal
  document.getElementById('closeKvpModal')?.addEventListener('click', closeKVPModal);
  document.getElementById('modalCancelBtn')?.addEventListener('click', closeKVPModal);

  // Sector selection
  document.getElementById('kvpSectorSelect')?.addEventListener('change', (e) => {
    onSectorSelect(e.target.value);
  });

  // Preset selection
  document.getElementById('kvpPresetSelect')?.addEventListener('change', (e) => {
    onPresetSelect(e.target.value);
  });

  // Custom field
  document.getElementById('kvpAddCustomFieldBtn')?.addEventListener('click', addCustomField);
  document.getElementById('kvpCustomField')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCustomField();
    }
  });

  // Save preset
  document.getElementById('kvpSavePresetBtn')?.addEventListener('click', async () => {
    await KVPModal.savePreset();
  });

  // Select all
  document.getElementById('kvpSelectAllKvps')?.addEventListener('change', (e) => {
    toggleSelectAllKVPs(e.target.checked);
  });

  document.getElementById('kvpSelectAllFiles')?.addEventListener('click', () => {
    toggleSelectAllFiles(true);
  });

  // Process - unified button that handles both KVP and Anon based on toggles
  document.getElementById('modalProcessBtn')?.addEventListener('click', processFiles);

  // Close on overlay click
  document.getElementById('kvpModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'kvpModal') {
      closeKVPModal();
    }
  });

  // ============================================================================
  // ANON EVENT LISTENERS
  // ============================================================================

  // Category selection
  document.getElementById('anonCategorySelect')?.addEventListener('change', (e) => {
    onAnonCategorySelect(e.target.value);
  });

  // Preset selection
  document.getElementById('anonPresetSelect')?.addEventListener('change', (e) => {
    onAnonPresetSelect(e.target.value);
  });

  // Custom entity
  document.getElementById('anonAddCustomEntityBtn')?.addEventListener('click', addAnonCustomEntity);
  document.getElementById('anonCustomEntity')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addAnonCustomEntity();
    }
  });

  // Save preset
  document.getElementById('anonSavePresetBtn')?.addEventListener('click', saveAnonPreset);

  // Select all entities
  document.getElementById('anonSelectAllEntities')?.addEventListener('change', (e) => {
    toggleAnonSelectAllEntities(e.target.checked);
  });

  // Select all files
  document.getElementById('anonSelectAllFiles')?.addEventListener('click', () => {
    const checkboxes = document.querySelectorAll('#anonFileList .kvp-file-checkbox');
    checkboxes.forEach(cb => cb.checked = true);
  });
});

// Expose functions and state globally
window.openKVPModal = openKVPModal;
window.closeKVPModal = closeKVPModal;
window.removeSector = removeSector;
window.toggleKVP = toggleKVP;
window.renamePresetDialog = renamePresetDialog;
window.KVPModal = KVPModal; // Expose state for anon modal integration
window.deletePresetDialog = deletePresetDialog;
window.clearActivePreset = clearActivePreset;
window.updateCurrentPreset = updateCurrentPreset;
window.clearAllSectors = clearAllSectors;
window.clearAllSelections = clearAllSelections;

// Expose anon functions globally
window.removeAnonCategory = removeAnonCategory;
window.toggleAnonEntity = toggleAnonEntity;
window.removeAnonCustomEntity = removeAnonCustomEntity;
window.clearAnonActivePreset = clearAnonActivePreset;
window.clearAllAnonCategories = clearAllAnonCategories;
window.renameAnonPresetDialog = renameAnonPresetDialog;
window.deleteAnonPresetDialog = deleteAnonPresetDialog;
window.updateCurrentAnonPreset = updateCurrentAnonPreset;
window.AnonModal = AnonModal;
