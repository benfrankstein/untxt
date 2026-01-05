/**
 * Anonymization Routes
 * Handles PII detection and anonymization with multiple strategies
 */

const express = require('express');
const router = express.Router();
const dbService = require('../services/db.service');
const s3Service = require('../services/s3.service');
const { requireAuth } = require('../middleware/auth.middleware');

// All anon routes require authentication
router.use(requireAuth);

// ============================================================================
// SECTORS
// ============================================================================

/**
 * GET /api/anon/sectors
 * Get all available anonymization sectors (PII categories)
 */
router.get('/sectors', async (req, res) => {
  try {
    const result = await dbService.pool.query(`
      SELECT id, name, description, icon, color, display_order
      FROM anon_sectors
      ORDER BY display_order ASC, name ASC
    `);

    res.json({
      success: true,
      sectors: result.rows
    });
  } catch (error) {
    console.error('Error fetching anon sectors:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch anonymization sectors'
    });
  }
});

// ============================================================================
// STRATEGIES
// ============================================================================

/**
 * GET /api/anon/strategies
 * Get all available anonymization strategies
 */
router.get('/strategies', async (req, res) => {
  try {
    const result = await dbService.pool.query(`
      SELECT id, name, description, icon, color, recommended, display_order
      FROM anon_strategies
      ORDER BY display_order ASC
    `);

    res.json({
      success: true,
      strategies: result.rows
    });
  } catch (error) {
    console.error('Error fetching anon strategies:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch anonymization strategies'
    });
  }
});

// ============================================================================
// FIELDS (from sectors)
// ============================================================================

/**
 * POST /api/anon/sectors/fields
 * Get PII fields for selected sectors
 * Body: { sector_ids: ['healthcare', 'financial'] }
 */
router.post('/sectors/fields', async (req, res) => {
  try {
    const { sector_ids } = req.body;

    console.log('[ANON] Loading fields for sector IDs:', sector_ids);

    if (!sector_ids || !Array.isArray(sector_ids) || sector_ids.length === 0) {
      return res.json({
        success: true,
        fields: []
      });
    }

    // Join through master_kvp_sectors to map text sector codes to integer IDs
    const result = await dbService.pool.query(`
      SELECT
        mk.key_name,
        mk.key_name as display_name,
        mk.description,
        mk.aliases,
        s.sector_code as sector_id
      FROM master_kvps mk
      JOIN master_kvp_sectors s ON mk.sector_id = s.id
      WHERE s.sector_code = ANY($1::text[])
      AND mk.is_active = true
      ORDER BY s.sector_code, mk.key_name ASC
    `, [sector_ids]);

    console.log('[ANON] Loaded', result.rows.length, 'fields for sectors');

    res.json({
      success: true,
      fields: result.rows
    });
  } catch (error) {
    console.error('Error fetching anon fields:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch anonymization fields'
    });
  }
});

/**
 * POST /api/anon/fields/sectors
 * Find which sectors contain specific field names
 * Body: { field_names: ['email', 'phone_number'] }
 */
router.post('/fields/sectors', async (req, res) => {
  try {
    const { field_names } = req.body;

    console.log('[ANON] Finding sectors for field names:', field_names);

    if (!field_names || !Array.isArray(field_names) || field_names.length === 0) {
      return res.json({
        success: true,
        sectors: []
      });
    }

    // Find which sectors contain these field names
    const result = await dbService.pool.query(`
      SELECT DISTINCT
        s.sector_code as sector_id,
        mk.key_name
      FROM master_kvps mk
      JOIN master_kvp_sectors s ON mk.sector_id = s.id
      WHERE mk.key_name = ANY($1::text[])
      AND mk.is_active = true
    `, [field_names]);

    console.log('[ANON] Found sectors:', result.rows);

    const sectorIds = [...new Set(result.rows.map(r => r.sector_id))];
    console.log('[ANON] Unique sector IDs:', sectorIds);

    res.json({
      success: true,
      sector_ids: sectorIds
    });
  } catch (error) {
    console.error('Error finding sectors for fields:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to find sectors for fields'
    });
  }
});

// ============================================================================
// PRESETS
// ============================================================================

/**
 * GET /api/anon/presets
 * Get user's saved anonymization presets
 */
router.get('/presets', async (req, res) => {
  try {
    const userId = req.session.userId;

    const result = await dbService.pool.query(`
      SELECT
        p.id,
        p.preset_name,
        p.strategy_id,
        p.generate_audit,
        p.selected_fields,
        p.selected_sectors,
        p.created_at,
        p.updated_at,
        s.name as strategy_name,
        s.icon as strategy_icon
      FROM anon_presets p
      LEFT JOIN anon_strategies s ON p.strategy_id = s.id
      WHERE p.user_id = $1
      ORDER BY p.created_at DESC
    `, [userId]);

    res.json({
      success: true,
      presets: result.rows
    });
  } catch (error) {
    console.error('Error fetching anon presets:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch anonymization presets'
    });
  }
});

/**
 * POST /api/anon/presets
 * Save a new anonymization preset
 * Body: {
 *   preset_name: string,
 *   strategy_id: string,
 *   generate_audit: boolean,
 *   selected_fields: array,
 *   selected_sectors: array
 * }
 */
router.post('/presets', async (req, res) => {
  try {
    const userId = req.session.userId;
    const { preset_name, strategy_id, generate_audit, selected_fields, selected_sectors } = req.body;

    if (!preset_name || !strategy_id || !selected_fields) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: preset_name, strategy_id, selected_fields'
      });
    }

    console.log('[ANON] Saving preset with sectors:', selected_sectors);

    const result = await dbService.pool.query(`
      INSERT INTO anon_presets (user_id, preset_name, strategy_id, generate_audit, selected_fields, selected_sectors)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id, preset_name) DO UPDATE
      SET strategy_id = EXCLUDED.strategy_id,
          generate_audit = EXCLUDED.generate_audit,
          selected_fields = EXCLUDED.selected_fields,
          selected_sectors = EXCLUDED.selected_sectors,
          updated_at = NOW()
      RETURNING id, preset_name, strategy_id, generate_audit, selected_fields, selected_sectors, created_at, updated_at
    `, [userId, preset_name, strategy_id, generate_audit || false, JSON.stringify(selected_fields), JSON.stringify(selected_sectors || [])]);

    res.json({
      success: true,
      preset: result.rows[0]
    });
  } catch (error) {
    console.error('Error saving anon preset:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save anonymization preset'
    });
  }
});

/**
 * PUT /api/anon/presets/:presetId
 * Update an anonymization preset (rename or update contents)
 * Body: {
 *   preset_name: string,
 *   strategy_id: string,
 *   generate_audit: boolean,
 *   selected_fields: array
 * }
 */
router.put('/presets/:presetId', async (req, res) => {
  try {
    const userId = req.session.userId;
    const { presetId } = req.params;
    const { preset_name, strategy_id, generate_audit, selected_fields, selected_sectors } = req.body;

    if (!preset_name || !strategy_id || !selected_fields) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: preset_name, strategy_id, selected_fields'
      });
    }

    console.log('[ANON] Updating preset with sectors:', selected_sectors);

    // Check if preset exists and belongs to user
    const checkResult = await dbService.pool.query(`
      SELECT id FROM anon_presets
      WHERE id = $1 AND user_id = $2
    `, [presetId, userId]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Preset not found or access denied'
      });
    }

    // Check if new name conflicts with another preset (if name is being changed)
    const conflictResult = await dbService.pool.query(`
      SELECT id FROM anon_presets
      WHERE user_id = $1 AND preset_name = $2 AND id != $3
    `, [userId, preset_name, presetId]);

    if (conflictResult.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'A preset with this name already exists'
      });
    }

    // Update the preset
    const result = await dbService.pool.query(`
      UPDATE anon_presets
      SET preset_name = $1,
          strategy_id = $2,
          generate_audit = $3,
          selected_fields = $4,
          selected_sectors = $5,
          updated_at = NOW()
      WHERE id = $6 AND user_id = $7
      RETURNING id, preset_name, strategy_id, generate_audit, selected_fields, selected_sectors, created_at, updated_at
    `, [preset_name, strategy_id, generate_audit || false, JSON.stringify(selected_fields), JSON.stringify(selected_sectors || []), presetId, userId]);

    res.json({
      success: true,
      preset: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating anon preset:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update preset'
    });
  }
});

/**
 * DELETE /api/anon/presets/:presetId
 * Delete an anonymization preset
 */
router.delete('/presets/:presetId', async (req, res) => {
  try {
    const userId = req.session.userId;
    const { presetId } = req.params;

    await dbService.pool.query(`
      DELETE FROM anon_presets
      WHERE id = $1 AND user_id = $2
    `, [presetId, userId]);

    res.json({
      success: true,
      message: 'Preset deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting anon preset:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete preset'
    });
  }
});

// ============================================================================
// CUSTOM ENTITIES
// ============================================================================

/**
 * GET /api/anon/custom-entities
 * Get all custom anonymization entities for current user
 */
router.get('/custom-entities', async (req, res) => {
  try {
    const userId = req.session.userId;

    const result = await dbService.pool.query(`
      SELECT
        id,
        custom_entity_name,
        created_at,
        updated_at
      FROM user_custom_anon_entities
      WHERE user_id = $1
      ORDER BY created_at DESC
    `, [userId]);

    res.json({
      success: true,
      entities: result.rows
    });
  } catch (error) {
    console.error('Error fetching custom anon entities:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch custom entities'
    });
  }
});

/**
 * POST /api/anon/custom-entities
 * Create a new custom anonymization entity
 * Body: { custom_entity_name: string }
 */
router.post('/custom-entities', async (req, res) => {
  try {
    const userId = req.session.userId;
    const { custom_entity_name } = req.body;

    // Validation
    if (!custom_entity_name || !custom_entity_name.trim()) {
      return res.status(400).json({
        success: false,
        error: 'custom_entity_name is required'
      });
    }

    // Insert custom entity (will fail if duplicate due to UNIQUE constraint)
    const result = await dbService.pool.query(`
      INSERT INTO user_custom_anon_entities (user_id, custom_entity_name)
      VALUES ($1, $2)
      ON CONFLICT (user_id, custom_entity_name) DO NOTHING
      RETURNING id, custom_entity_name, created_at, updated_at
    `, [userId, custom_entity_name.trim()]);

    if (result.rows.length === 0) {
      return res.status(409).json({
        success: false,
        error: 'Custom entity already exists'
      });
    }

    res.json({
      success: true,
      entity: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating custom anon entity:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create custom entity'
    });
  }
});

/**
 * DELETE /api/anon/custom-entities/:entityId
 * Delete a custom anonymization entity
 */
router.delete('/custom-entities/:entityId', async (req, res) => {
  try {
    const userId = req.session.userId;
    const { entityId } = req.params;

    await dbService.pool.query(`
      DELETE FROM user_custom_anon_entities
      WHERE id = $1 AND user_id = $2
    `, [entityId, userId]);

    res.json({
      success: true,
      message: 'Custom entity deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting custom anon entity:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete custom entity'
    });
  }
});

module.exports = router;
