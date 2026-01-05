/**
 * KVP Extraction Routes
 * API endpoints for key-value pair extraction system
 */

const express = require('express');
const router = express.Router();
const kvpService = require('../services/kvp.service');
const auditService = require('../services/audit.service');
const sessionService = require('../services/session.service');

// Middleware to check authentication
const requireAuth = (req, res, next) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }
  next();
};

// ============================================================================
// MASTER KVP SECTORS & KVPS
// ============================================================================

/**
 * GET /api/kvp/sectors
 * Get all KVP sectors
 */
router.get('/sectors', requireAuth, async (req, res) => {
  try {
    const sectors = await kvpService.getAllSectors();

    res.json({
      success: true,
      data: { sectors }
    });
  } catch (error) {
    console.error('Get sectors error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve sectors'
    });
  }
});

/**
 * GET /api/kvp/sectors/:sectorId/kvps
 * Get all KVPs for a specific sector
 */
router.get('/sectors/:sectorId/kvps', requireAuth, async (req, res) => {
  try {
    const { sectorId } = req.params;

    const kvps = await kvpService.getKVPsForSector(parseInt(sectorId));

    res.json({
      success: true,
      data: { kvps }
    });
  } catch (error) {
    console.error('Get sector KVPs error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve KVPs'
    });
  }
});

/**
 * POST /api/kvp/sectors/kvps
 * Get KVPs for multiple sectors
 * Body: { sectorIds: [1, 2, 3] }
 */
router.post('/sectors/kvps', requireAuth, async (req, res) => {
  try {
    const { sectorIds } = req.body;

    if (!Array.isArray(sectorIds) || sectorIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'sectorIds array is required'
      });
    }

    const kvpsBySector = await kvpService.getKVPsBySectors(sectorIds);

    res.json({
      success: true,
      data: { sectors: kvpsBySector }
    });
  } catch (error) {
    console.error('Get multiple sectors KVPs error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve KVPs'
    });
  }
});

// ============================================================================
// USER PRESETS
// ============================================================================

/**
 * GET /api/kvp/presets
 * Get all presets for current user
 */
router.get('/presets', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    const presets = await kvpService.getUserPresets(userId);

    res.json({
      success: true,
      data: { presets }
    });
  } catch (error) {
    console.error('Get presets error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve presets'
    });
  }
});

/**
 * GET /api/kvp/presets/:id
 * Get preset with all its KVPs
 */
router.get('/presets/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const presetId = parseInt(req.params.id);

    const preset = await kvpService.getPresetWithKVPs(presetId, userId);

    res.json({
      success: true,
      data: { preset }
    });
  } catch (error) {
    console.error('Get preset error:', error);

    if (error.message === 'Preset not found') {
      return res.status(404).json({
        success: false,
        error: 'Preset not found'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to retrieve preset'
    });
  }
});

/**
 * POST /api/kvp/presets
 * Create a new preset
 * Body: {
 *   preset_name: string,
 *   description: string,
 *   kvps: [
 *     { master_kvp_id: 123 },
 *     { custom_key_name: "My Custom Field" }
 *   ]
 * }
 */
router.post('/presets', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { preset_name, description, kvps } = req.body;

    // Validation
    if (!preset_name || !preset_name.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Preset name is required'
      });
    }

    if (!Array.isArray(kvps) || kvps.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one KVP is required'
      });
    }

    // Validate KVP format
    for (const kvp of kvps) {
      if (!kvp.master_kvp_id && !kvp.custom_key_name) {
        return res.status(400).json({
          success: false,
          error: 'Each KVP must have either master_kvp_id or custom_key_name'
        });
      }
    }

    const preset = await kvpService.createPreset(
      userId,
      preset_name.trim(),
      description?.trim() || null,
      kvps
    );

    // Audit log
    const ipAddress = sessionService.getClientIP(req);
    const userAgent = sessionService.getUserAgent(req);
    await auditService.logEvent({
      eventType: 'PRESET_CREATED',
      eventCategory: 'kvp',
      userId,
      ipAddress,
      userAgent,
      severity: 'info',
      details: {
        preset_id: preset.id,
        preset_name: preset.preset_name,
        kvp_count: kvps.length
      }
    });

    res.status(201).json({
      success: true,
      message: 'Preset created successfully',
      data: { preset }
    });
  } catch (error) {
    console.error('Create preset error:', error);

    if (error.message.includes('already exists')) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to create preset'
    });
  }
});

/**
 * PUT /api/kvp/presets/:id
 * Update preset name, description, and optionally KVPs
 * Body: { preset_name: string, description: string, kvps?: Array }
 */
router.put('/presets/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const presetId = parseInt(req.params.id);
    const { preset_name, description, kvps } = req.body;

    if (!preset_name || !preset_name.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Preset name is required'
      });
    }

    let preset;

    // If kvps are provided, update the full preset including KVPs
    if (kvps && Array.isArray(kvps)) {
      if (kvps.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'At least one KVP is required'
        });
      }

      // Validate KVP format
      for (const kvp of kvps) {
        if (!kvp.master_kvp_id && !kvp.custom_key_name) {
          return res.status(400).json({
            success: false,
            error: 'Each KVP must have either master_kvp_id or custom_key_name'
          });
        }
      }

      preset = await kvpService.updatePresetWithKVPs(
        presetId,
        userId,
        preset_name.trim(),
        description?.trim() || null,
        kvps
      );
    } else {
      // Update only name and description
      preset = await kvpService.updatePreset(
        presetId,
        userId,
        preset_name.trim(),
        description?.trim() || null
      );
    }

    // Audit log
    const ipAddress = sessionService.getClientIP(req);
    const userAgent = sessionService.getUserAgent(req);
    await auditService.logEvent({
      eventType: 'PRESET_UPDATED',
      eventCategory: 'kvp',
      userId,
      ipAddress,
      userAgent,
      severity: 'info',
      details: {
        preset_id: preset.id,
        preset_name: preset.preset_name,
        kvps_updated: kvps ? kvps.length : 0
      }
    });

    res.json({
      success: true,
      message: 'Preset updated successfully',
      data: { preset }
    });
  } catch (error) {
    console.error('Update preset error:', error);

    if (error.message === 'Preset not found') {
      return res.status(404).json({
        success: false,
        error: 'Preset not found'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to update preset'
    });
  }
});

/**
 * DELETE /api/kvp/presets/:id
 * Delete a preset
 */
router.delete('/presets/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const presetId = parseInt(req.params.id);

    await kvpService.deletePreset(presetId, userId);

    // Audit log
    const ipAddress = sessionService.getClientIP(req);
    const userAgent = sessionService.getUserAgent(req);
    await auditService.logEvent({
      eventType: 'PRESET_DELETED',
      eventCategory: 'kvp',
      userId,
      ipAddress,
      userAgent,
      severity: 'info',
      details: {
        preset_id: presetId
      }
    });

    res.json({
      success: true,
      message: 'Preset deleted successfully'
    });
  } catch (error) {
    console.error('Delete preset error:', error);

    if (error.message === 'Preset not found') {
      return res.status(404).json({
        success: false,
        error: 'Preset not found'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to delete preset'
    });
  }
});

// ============================================================================
// USER CUSTOM KVPS
// ============================================================================

/**
 * GET /api/kvp/custom-fields
 * Get all custom fields for current user
 */
router.get('/custom-fields', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    const customKvps = await kvpService.getUserCustomKVPs(userId);

    res.json({
      success: true,
      data: { custom_kvps: customKvps }
    });
  } catch (error) {
    console.error('Get custom KVPs error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve custom fields'
    });
  }
});

/**
 * POST /api/kvp/custom-fields
 * Create a new custom field
 * Body: { custom_key_name: string }
 */
router.post('/custom-fields', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { custom_key_name } = req.body;

    // Validation
    if (!custom_key_name || !custom_key_name.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Custom field name is required'
      });
    }

    const customKvp = await kvpService.createCustomKVP(userId, custom_key_name.trim());

    // Audit log
    const ipAddress = sessionService.getClientIP(req);
    const userAgent = sessionService.getUserAgent(req);
    await auditService.logEvent({
      eventType: 'CUSTOM_KVP_CREATED',
      eventCategory: 'kvp',
      userId,
      ipAddress,
      userAgent,
      severity: 'info',
      details: {
        custom_kvp_id: customKvp.id,
        custom_key_name: customKvp.custom_key_name
      }
    });

    res.status(201).json({
      success: true,
      message: 'Custom field created successfully',
      data: { custom_kvp: customKvp }
    });
  } catch (error) {
    console.error('Create custom KVP error:', error);

    if (error.message.includes('already exists')) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to create custom field'
    });
  }
});

/**
 * DELETE /api/kvp/custom-fields/:id
 * Delete a custom field
 */
router.delete('/custom-fields/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const customKvpId = parseInt(req.params.id);

    await kvpService.deleteCustomKVP(customKvpId, userId);

    // Audit log
    const ipAddress = sessionService.getClientIP(req);
    const userAgent = sessionService.getUserAgent(req);
    await auditService.logEvent({
      eventType: 'CUSTOM_KVP_DELETED',
      eventCategory: 'kvp',
      userId,
      ipAddress,
      userAgent,
      severity: 'info',
      details: {
        custom_kvp_id: customKvpId
      }
    });

    res.json({
      success: true,
      message: 'Custom field deleted successfully'
    });
  } catch (error) {
    console.error('Delete custom KVP error:', error);

    if (error.message === 'Custom field not found') {
      return res.status(404).json({
        success: false,
        error: 'Custom field not found'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to delete custom field'
    });
  }
});

// ============================================================================
// EXTRACTIONS
// ============================================================================

/**
 * POST /api/kvp/extractions
 * Create a new extraction session
 * Body: {
 *   file_id: UUID,
 *   preset_id?: number,
 *   sector_ids: [1, 2, 3],
 *   kvps: [{ master_kvp_id: 123 }, { custom_key_name: "Custom" }]
 * }
 */
router.post('/extractions', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { file_id, preset_id, sector_ids, kvps } = req.body;

    // Validation
    if (!file_id) {
      return res.status(400).json({
        success: false,
        error: 'file_id is required'
      });
    }

    if (!Array.isArray(kvps) || kvps.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one KVP is required'
      });
    }

    const extraction = await kvpService.createExtraction(
      file_id,
      userId,
      preset_id || null,
      sector_ids || [],
      kvps.length
    );

    // Audit log
    const ipAddress = sessionService.getClientIP(req);
    const userAgent = sessionService.getUserAgent(req);
    await auditService.logEvent({
      eventType: 'EXTRACTION_STARTED',
      eventCategory: 'kvp',
      userId,
      ipAddress,
      userAgent,
      severity: 'info',
      details: {
        extraction_id: extraction.id,
        file_id,
        preset_id,
        kvp_count: kvps.length
      }
    });

    res.status(201).json({
      success: true,
      message: 'Extraction session created',
      data: { extraction }
    });
  } catch (error) {
    console.error('Create extraction error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create extraction session'
    });
  }
});

/**
 * GET /api/kvp/extractions/:id
 * Get extraction results
 */
router.get('/extractions/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const extractionId = parseInt(req.params.id);

    const extraction = await kvpService.getExtractionResults(extractionId, userId);

    res.json({
      success: true,
      data: { extraction }
    });
  } catch (error) {
    console.error('Get extraction error:', error);

    if (error.message === 'Extraction not found') {
      return res.status(404).json({
        success: false,
        error: 'Extraction not found'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to retrieve extraction'
    });
  }
});

/**
 * GET /api/kvp/extractions
 * Get extraction history for current user
 */
router.get('/extractions', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const limit = parseInt(req.query.limit) || 50;

    const extractions = await kvpService.getUserExtractionHistory(userId, limit);

    res.json({
      success: true,
      data: { extractions }
    });
  } catch (error) {
    console.error('Get extraction history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve extraction history'
    });
  }
});

module.exports = router;
