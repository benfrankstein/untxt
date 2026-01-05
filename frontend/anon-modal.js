/**
 * Anonymization Modal
 * Handles PII anonymization with strategy selection and field management
 */

// API Configuration
const ANON_MODAL_API_URL = window.location.origin;

// State Management
const AnonModal = {
  selectedFiles: [],
  selectedStrategy: 'synthetic', // Default strategy
  selectedSectors: [],
  selectedFields: new Set(),
  allFields: {},
  currentPreset: null,
  strategies: [],
  sectors: [],
  presets: [],
  generateAudit: false,

  // Original state for comparison
  originalState: {
    strategy: null,
    sectors: [],
    fields: new Set(),
    audit: false
  },

  saveOriginalState() {
    this.originalState = {
      strategy: this.selectedStrategy,
      sectors: [...this.selectedSectors],
      fields: new Set(this.selectedFields),
      audit: this.generateAudit
    };
  },

  hasChanges() {
    if (this.originalState.strategy !== this.selectedStrategy) return true;
    if (this.originalState.audit !== this.generateAudit) return true;
    if (JSON.stringify(this.originalState.sectors) !== JSON.stringify(this.selectedSectors)) return true;
    if (this.originalState.fields.size !== this.selectedFields.size) return true;

    for (let field of this.selectedFields) {
      if (!this.originalState.fields.has(field)) return true;
    }

    return false;
  },

  clearOriginalState() {
    this.originalState = {
      strategy: null,
      sectors: [],
      fields: new Set(),
      audit: false
    };
  }
};

// ============================================================================
// MODAL OPEN/CLOSE
// ============================================================================

function openAnonModal(files) {
  console.log('Opening Anonymization modal with files:', files);

  AnonModal.selectedFiles = files || [];

  const modal = document.getElementById('anonModal');
  modal.classList.add('active');

  // Reset state
  AnonModal.selectedStrategy = 'synthetic';
  AnonModal.selectedSectors = [];
  AnonModal.selectedFields = new Set();
  AnonModal.currentPreset = null;
  AnonModal.generateAudit = false;

  // Load data
  loadStrategies();
  loadSectors();
  loadPresets();
  renderFileList();
  updateProcessCount();
}

function closeAnonModal() {
  const modal = document.getElementById('anonModal');
  modal.classList.remove('active');

  // Reset state completely
  AnonModal.selectedStrategy = 'synthetic';
  AnonModal.selectedSectors = [];
  AnonModal.selectedFields = new Set();
  AnonModal.allFields = {};
  AnonModal.currentPreset = null;
  AnonModal.selectedFiles = [];
  AnonModal.generateAudit = false;
  AnonModal.clearOriginalState();

  // Clear UI
  renderSelectedSectors();
  renderFieldList();
  updatePresetSaveVisibility();
  renderActivePresetCard();

  // Clear inputs
  document.getElementById('anonPresetName').value = '';
  document.getElementById('anonSectorSelect').value = '';
  document.getElementById('anonPresetSelect').value = '';

  // Clear file input so user can re-upload
  const fileInput = document.getElementById('fileInput');
  if (fileInput) {
    fileInput.value = '';
  }
}

// ============================================================================
// LOAD DATA
// ============================================================================

async function loadStrategies() {
  try {
    const response = await fetch(`${ANON_MODAL_API_URL}/api/anon/strategies`, {
      credentials: 'include',
      headers: { 'x-user-id': localStorage.getItem('user_id') }
    });

    const data = await response.json();

    if (data.success) {
      AnonModal.strategies = data.strategies;
      console.log(`✓ Loaded ${AnonModal.strategies.length} anonymization strategies`);
      renderStrategies();
    }
  } catch (error) {
    console.error('Error loading strategies:', error);
  }
}

async function loadSectors() {
  try {
    const response = await fetch(`${ANON_MODAL_API_URL}/api/anon/sectors`, {
      credentials: 'include',
      headers: { 'x-user-id': localStorage.getItem('user_id') }
    });

    const data = await response.json();

    if (data.success) {
      AnonModal.sectors = data.sectors;
      console.log(`✓ Loaded ${AnonModal.sectors.length} PII sectors`);
      renderSectorDropdown();
    }
  } catch (error) {
    console.error('Error loading sectors:', error);
  }
}

async function loadPresets() {
  try {
    const response = await fetch(`${ANON_MODAL_API_URL}/api/anon/presets`, {
      credentials: 'include',
      headers: { 'x-user-id': localStorage.getItem('user_id') }
    });

    const data = await response.json();

    if (data.success) {
      AnonModal.presets = data.presets;
      console.log(`✓ Loaded ${AnonModal.presets.length} anonymization presets`);
      renderPresetDropdown();
    }
  } catch (error) {
    console.error('Error loading presets:', error);
  }
}

async function loadFieldsForSectors(sectorIds) {
  try {
    const response = await fetch(`${ANON_MODAL_API_URL}/api/anon/sectors/fields`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': localStorage.getItem('user_id')
      },
      body: JSON.stringify({ sector_ids: sectorIds })
    });

    const data = await response.json();

    if (data.success) {
      const fields = data.fields || [];
      console.log(`✓ Loaded ${fields.length} fields for selected sectors`);

      // Organize fields by sector
      AnonModal.allFields = {};
      fields.forEach(field => {
        if (!AnonModal.allFields[field.sector_id]) {
          AnonModal.allFields[field.sector_id] = [];
        }
        AnonModal.allFields[field.sector_id].push(field);
      });

      renderFieldList();
    }
  } catch (error) {
    console.error('Error loading fields:', error);
  }
}

// ============================================================================
// RENDER STRATEGIES
// ============================================================================

function renderStrategies() {
  const container = document.getElementById('anonStrategyCards');
  container.innerHTML = '';

  AnonModal.strategies.forEach(strategy => {
    const card = document.createElement('div');
    card.className = 'anon-strategy-card';
    if (strategy.id === AnonModal.selectedStrategy) {
      card.classList.add('selected');
    }
    if (strategy.recommended) {
      card.classList.add('recommended');
    }

    card.innerHTML = `
      <div class="strategy-icon">${strategy.icon}</div>
      <div class="strategy-info">
        <div class="strategy-name">
          ${strategy.name}
          ${strategy.recommended ? '<span class="recommended-badge">Recommended</span>' : ''}
        </div>
        <div class="strategy-description">${strategy.description}</div>
      </div>
      <div class="strategy-select-icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </div>
    `;

    card.addEventListener('click', () => {
      AnonModal.selectedStrategy = strategy.id;
      renderStrategies();
      updatePresetSaveVisibility();
    });

    container.appendChild(card);
  });
}

// ============================================================================
// RENDER SECTORS
// ============================================================================

function renderSectorDropdown() {
  const select = document.getElementById('anonSectorSelect');
  select.innerHTML = '<option value="">Select PII sector...</option>';

  AnonModal.sectors.forEach(sector => {
    const option = document.createElement('option');
    option.value = sector.id;
    option.textContent = sector.name;
    select.appendChild(option);
  });
}

function renderSelectedSectors() {
  const container = document.getElementById('anonSelectedSectors');
  container.innerHTML = '';

  if (AnonModal.selectedSectors.length === 0) {
    container.innerHTML = '<div class="anon-empty-state">No sectors selected. Select from dropdown above.</div>';
    return;
  }

  AnonModal.selectedSectors.forEach(sectorId => {
    const sector = AnonModal.sectors.find(s => s.id === sectorId);
    if (!sector) return;

    const chip = document.createElement('div');
    chip.className = 'anon-sector-chip';
    chip.innerHTML = `
      <span class="sector-icon">${sector.icon || '📄'}</span>
      <span class="sector-name">${sector.name}</span>
      <button class="sector-remove-btn" title="Remove sector">×</button>
    `;

    chip.querySelector('.sector-remove-btn').addEventListener('click', () => {
      AnonModal.selectedSectors = AnonModal.selectedSectors.filter(id => id !== sectorId);

      // Remove fields from this sector
      const fieldsToRemove = AnonModal.allFields[sectorId] || [];
      fieldsToRemove.forEach(field => {
        AnonModal.selectedFields.delete(field.key_name);
      });

      // Clear fields for this sector
      delete AnonModal.allFields[sectorId];

      renderSelectedSectors();
      renderFieldList();
      updatePresetSaveVisibility();
      loadFieldsForSectors(AnonModal.selectedSectors);
    });

    container.appendChild(chip);
  });
}

// ============================================================================
// RENDER FIELDS
// ============================================================================

function renderFieldList() {
  const container = document.getElementById('anonFieldList');
  container.innerHTML = '';

  if (AnonModal.selectedSectors.length === 0) {
    container.innerHTML = '<div class="anon-empty-state">Select a PII sector to see available fields</div>';
    return;
  }

  if (Object.keys(AnonModal.allFields).length === 0) {
    container.innerHTML = '<div class="anon-loading">Loading fields...</div>';
    return;
  }

  // Count selected fields
  let totalFields = 0;
  let selectedCount = 0;

  // Render by sector
  AnonModal.selectedSectors.forEach(sectorId => {
    const sector = AnonModal.sectors.find(s => s.id === sectorId);
    const fields = AnonModal.allFields[sectorId] || [];

    if (fields.length === 0) return;

    totalFields += fields.length;
    const selectedInSector = fields.filter(f => AnonModal.selectedFields.has(f.key_name)).length;
    selectedCount += selectedInSector;

    const sectorSection = document.createElement('div');
    sectorSection.className = 'anon-field-sector-section';

    const sectorHeader = document.createElement('div');
    sectorHeader.className = 'anon-field-sector-header';
    sectorHeader.innerHTML = `
      <span class="sector-icon">${sector.icon || '📄'}</span>
      <span class="sector-name">${sector.name}</span>
      <span class="sector-field-count">${selectedInSector}/${fields.length}</span>
    `;
    sectorSection.appendChild(sectorHeader);

    const fieldGrid = document.createElement('div');
    fieldGrid.className = 'anon-field-grid';

    fields.forEach(field => {
      const fieldCard = document.createElement('div');
      fieldCard.className = 'anon-field-card';
      if (AnonModal.selectedFields.has(field.key_name)) {
        fieldCard.classList.add('selected');
      }

      fieldCard.innerHTML = `
        <div class="field-checkbox">
          <input type="checkbox"
                 id="field_${field.key_name}"
                 ${AnonModal.selectedFields.has(field.key_name) ? 'checked' : ''}>
        </div>
        <div class="field-info">
          <div class="field-name">${field.display_name || field.key_name}</div>
          ${field.description ? `<div class="field-description">${field.description}</div>` : ''}
        </div>
      `;

      const checkbox = fieldCard.querySelector('input');
      checkbox.addEventListener('change', (e) => {
        if (e.target.checked) {
          AnonModal.selectedFields.add(field.key_name);
        } else {
          AnonModal.selectedFields.delete(field.key_name);
        }
        renderFieldList();
        updatePresetSaveVisibility();
      });

      fieldCard.addEventListener('click', (e) => {
        if (e.target.type !== 'checkbox') {
          checkbox.checked = !checkbox.checked;
          checkbox.dispatchEvent(new Event('change'));
        }
      });

      fieldGrid.appendChild(fieldCard);
    });

    sectorSection.appendChild(fieldGrid);
    container.appendChild(sectorSection);
  });

  // Update "Select All" checkbox state
  const selectAllCheckbox = document.getElementById('anonSelectAllFields');
  if (selectAllCheckbox) {
    selectAllCheckbox.checked = totalFields > 0 && selectedCount === totalFields;
    selectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < totalFields;
  }
}

// ============================================================================
// FILE LIST
// ============================================================================

function renderFileList() {
  const fileList = document.getElementById('anonFileList');
  fileList.innerHTML = '';

  if (!AnonModal.selectedFiles || AnonModal.selectedFiles.length === 0) {
    fileList.innerHTML = '<div class="anon-empty-state">No files selected</div>';
    return;
  }

  AnonModal.selectedFiles.forEach((file, index) => {
    const fileItem = document.createElement('div');
    fileItem.className = 'anon-file-item';
    fileItem.innerHTML = `
      <div class="file-icon">📄</div>
      <div class="file-info">
        <div class="file-name">${file.name}</div>
        <div class="file-size">${formatFileSize(file.size)}</div>
      </div>
      <div class="file-check">✓</div>
    `;
    fileList.appendChild(fileItem);
  });

  updateProcessCount();
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// ============================================================================
// PRESETS
// ============================================================================

function renderPresetDropdown() {
  const select = document.getElementById('anonPresetSelect');
  select.innerHTML = '<option value="">Select preset...</option>';

  AnonModal.presets.forEach(preset => {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = `${preset.preset_name} (${preset.strategy_name})`;
    select.appendChild(option);
  });
}

function renderActivePresetCard() {
  const container = document.getElementById('anonActivePresetCard');

  if (!AnonModal.currentPreset) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  container.innerHTML = `
    <div class="preset-card-header">
      <span class="preset-icon">${AnonModal.currentPreset.strategy_icon || '🎭'}</span>
      <div class="preset-info">
        <div class="preset-name">${AnonModal.currentPreset.preset_name}</div>
        <div class="preset-meta">${AnonModal.currentPreset.strategy_name} • ${AnonModal.selectedFields.size} fields</div>
      </div>
      <button class="preset-clear-btn" title="Clear preset">×</button>
    </div>
  `;

  container.querySelector('.preset-clear-btn').addEventListener('click', () => {
    AnonModal.currentPreset = null;
    renderActivePresetCard();
    updatePresetSaveVisibility();
  });
}

function updatePresetSaveVisibility() {
  const saveSection = document.getElementById('anonPresetSaveSection');
  const hasSelections = AnonModal.selectedFields.size > 0;
  const hasChanges = AnonModal.hasChanges();

  if (hasSelections && (hasChanges || !AnonModal.currentPreset)) {
    saveSection.style.display = 'flex';
  } else {
    saveSection.style.display = 'none';
  }
}

async function loadPreset(presetId) {
  const preset = AnonModal.presets.find(p => p.id === parseInt(presetId));
  if (!preset) return;

  console.log('Loading preset:', preset);

  // Set current preset
  AnonModal.currentPreset = preset;

  // Set strategy
  AnonModal.selectedStrategy = preset.strategy_id;

  // Set audit flag
  AnonModal.generateAudit = preset.generate_audit || false;
  document.getElementById('anonGenerateAudit').checked = AnonModal.generateAudit;

  // Parse selected fields
  const selectedFields = preset.selected_fields || [];

  // Extract unique sectors from selected fields
  const sectorsSet = new Set();
  selectedFields.forEach(field => {
    // Fields can have sector_id in their structure
    if (field.sector_id) {
      sectorsSet.add(field.sector_id);
    }
  });

  AnonModal.selectedSectors = Array.from(sectorsSet);

  // Load fields for these sectors
  if (AnonModal.selectedSectors.length > 0) {
    await loadFieldsForSectors(AnonModal.selectedSectors);
  }

  // Select the fields
  AnonModal.selectedFields = new Set();
  selectedFields.forEach(field => {
    const keyName = field.key_name || field.custom_key_name;
    if (keyName) {
      AnonModal.selectedFields.add(keyName);
    }
  });

  // Save original state
  AnonModal.saveOriginalState();

  // Re-render everything
  renderStrategies();
  renderSelectedSectors();
  renderFieldList();
  renderActivePresetCard();
  updatePresetSaveVisibility();

  console.log(`✓ Loaded preset: ${preset.preset_name} (${AnonModal.selectedFields.size} fields)`);
}

async function savePreset() {
  const presetName = document.getElementById('anonPresetName').value.trim();

  if (!presetName) {
    alert('Please enter a preset name');
    return;
  }

  if (AnonModal.selectedFields.size === 0) {
    alert('Please select at least one field');
    return;
  }

  // Build selected_fields array
  const selectedFields = [];
  AnonModal.selectedSectors.forEach(sectorId => {
    const fields = AnonModal.allFields[sectorId] || [];
    fields.forEach(field => {
      if (AnonModal.selectedFields.has(field.key_name)) {
        selectedFields.push({
          key_name: field.key_name,
          sector_id: sectorId
        });
      }
    });
  });

  try {
    const response = await fetch(`${ANON_MODAL_API_URL}/api/anon/presets`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': localStorage.getItem('user_id')
      },
      body: JSON.stringify({
        preset_name: presetName,
        strategy_id: AnonModal.selectedStrategy,
        generate_audit: AnonModal.generateAudit,
        selected_fields: selectedFields
      })
    });

    const data = await response.json();

    if (data.success) {
      console.log('✓ Preset saved successfully');

      // Reload presets
      await loadPresets();

      // Set as current preset
      AnonModal.currentPreset = data.preset;
      AnonModal.saveOriginalState();

      // Clear preset name input
      document.getElementById('anonPresetName').value = '';

      // Re-render
      renderActivePresetCard();
      updatePresetSaveVisibility();

      alert(`Preset "${presetName}" saved successfully!`);
    } else {
      alert('Failed to save preset: ' + (data.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('Error saving preset:', error);
    alert('Failed to save preset');
  }
}

// ============================================================================
// PROCESS FILES
// ============================================================================

function updateProcessCount() {
  const btn = document.getElementById('anonProcessBtn');
  const count = AnonModal.selectedFiles.length;

  if (count > 0) {
    btn.textContent = `Process ${count} File${count > 1 ? 's' : ''}`;
    btn.disabled = false;
  } else {
    btn.textContent = 'Process Files';
    btn.disabled = true;
  }
}

async function processAnonFiles() {
  if (AnonModal.selectedFiles.length === 0) {
    alert('No files selected');
    return;
  }

  if (AnonModal.selectedFields.size === 0) {
    alert('Please select at least one field to anonymize');
    return;
  }

  // Build selected fields array
  const selectedFields = [];
  AnonModal.selectedSectors.forEach(sectorId => {
    const fields = AnonModal.allFields[sectorId] || [];
    fields.forEach(field => {
      if (AnonModal.selectedFields.has(field.key_name)) {
        selectedFields.push({
          key_name: field.key_name,
          sector_id: sectorId
        });
      }
    });
  });

  console.log('Processing files for anonymization:', {
    files: AnonModal.selectedFiles.length,
    strategy: AnonModal.selectedStrategy,
    fields: selectedFields.length,
    generateAudit: AnonModal.generateAudit
  });

  // Close modal before processing
  closeAnonModal();

  // Process each file
  for (const file of AnonModal.selectedFiles) {
    try {
      await uploadFileWithAnon(file, {
        strategy: AnonModal.selectedStrategy,
        selectedFields: selectedFields,
        generateAudit: AnonModal.generateAudit
      });
    } catch (error) {
      console.error('Anonymization upload failed:', error);
      showNotification?.(`Failed to process ${file.name}: ${error.message}`, 'error');
    }
  }
}

// Upload file with anonymization
async function uploadFileWithAnon(file, anonConfig) {
  const API_URL = window.location.origin;
  const USER_ID = localStorage.getItem('user_id');

  // Check credits if function exists
  if (window.checkCreditsBeforeUpload) {
    const hasCredits = await window.checkCreditsBeforeUpload();
    if (!hasCredits) {
      return;
    }
  }

  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('userId', USER_ID);
    formData.append('formatType', 'anon'); // Anonymization format
    formData.append('anonStrategy', anonConfig.strategy);
    formData.append('anonGenerateAudit', anonConfig.generateAudit.toString());
    formData.append('anonSelectedFields', JSON.stringify(anonConfig.selectedFields));

    console.log(`📤 Uploading ${file.name} for anonymization with strategy: ${anonConfig.strategy}`);

    const response = await fetch(`${API_URL}/api/tasks`, {
      method: 'POST',
      credentials: 'include',
      body: formData
    });

    const data = await response.json();

    if (data.success) {
      const taskId = data.data.taskId;
      console.log(`✓ Anonymization task created: ${taskId}`);

      // Update credit balance if provided
      if (data.data.creditsRemaining !== null && data.data.creditsRemaining !== undefined) {
        console.log(`✓ Credits deducted. Remaining balance: ${data.data.creditsRemaining}`);

        // Update credit displays if function exists
        if (window.updateCreditDisplay) {
          window.updateCreditDisplay(data.data.creditsRemaining);
        }
      }

      // Show success notification
      if (window.showNotification) {
        window.showNotification(`Started anonymizing ${file.name}`, 'success');
      }

      // Reload tasks to show new file
      if (window.loadTasks) {
        setTimeout(() => window.loadTasks(), 500);
      }
    } else {
      throw new Error(data.message || 'Upload failed');
    }
  } catch (error) {
    console.error('Anonymization upload error:', error);
    throw error;
  }
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  // NOTE: Anonymization is now integrated into KVP modal as a tab
  // This separate modal code is kept for future standalone use if needed

  // Close modal
  document.getElementById('closeAnonModal')?.addEventListener('click', closeAnonModal);
  document.getElementById('anonCancelBtn')?.addEventListener('click', closeAnonModal);

  // Sector selection
  document.getElementById('anonSectorSelect')?.addEventListener('change', async (e) => {
    const sectorId = e.target.value;
    if (!sectorId) return;

    if (!AnonModal.selectedSectors.includes(sectorId)) {
      AnonModal.selectedSectors.push(sectorId);
      await loadFieldsForSectors(AnonModal.selectedSectors);
      renderSelectedSectors();
      updatePresetSaveVisibility();
    }

    e.target.value = '';
  });

  // Preset selection
  document.getElementById('anonPresetSelect')?.addEventListener('change', (e) => {
    const presetId = e.target.value;
    if (presetId) {
      loadPreset(presetId);
    }
    e.target.value = '';
  });

  // Save preset
  document.getElementById('anonSavePresetBtn')?.addEventListener('click', savePreset);

  // Select all fields
  document.getElementById('anonSelectAllFields')?.addEventListener('change', (e) => {
    if (e.target.checked) {
      // Select all fields from all sectors
      AnonModal.selectedSectors.forEach(sectorId => {
        const fields = AnonModal.allFields[sectorId] || [];
        fields.forEach(field => AnonModal.selectedFields.add(field.key_name));
      });
    } else {
      // Deselect all
      AnonModal.selectedFields.clear();
    }
    renderFieldList();
    updatePresetSaveVisibility();
  });

  // Generate audit checkbox
  document.getElementById('anonGenerateAudit')?.addEventListener('change', (e) => {
    AnonModal.generateAudit = e.target.checked;
    updatePresetSaveVisibility();
  });

  // Process button
  document.getElementById('anonProcessBtn')?.addEventListener('click', processAnonFiles);

  // Click outside to close
  document.getElementById('anonModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'anonModal') {
      closeAnonModal();
    }
  });
});

// Export functions
window.openAnonModal = openAnonModal;
window.closeAnonModal = closeAnonModal;
