/**
 * KVP Service
 * Handles key-value pair extraction system operations
 */

const dbService = require('./db.service');
const logger = require('../utils/logger');

class KVPService {
  constructor() {
    this.pool = dbService.pool;
  }

  // ============================================================================
  // MASTER KVP SECTORS & KVPS
  // ============================================================================

  /**
   * Get all active sectors with their KVP counts
   * @returns {Promise<Array>} List of sectors
   */
  async getAllSectors() {
    try {
      const result = await this.pool.query(`
        SELECT
          id,
          sector_code,
          display_name,
          description,
          document_types,
          kvp_count,
          sort_order
        FROM master_kvp_sectors
        WHERE is_active = true
        ORDER BY sort_order
      `);

      return result.rows;
    } catch (error) {
      logger.error('Failed to get sectors:', error);
      throw error;
    }
  }

  /**
   * Get KVPs for specific sectors
   * @param {Array<number>} sectorIds - Array of sector IDs
   * @returns {Promise<Object>} KVPs grouped by sector
   */
  async getKVPsBySectors(sectorIds) {
    try {
      const result = await this.pool.query(`
        SELECT
          s.id as sector_id,
          s.sector_code,
          s.display_name as sector_name,
          k.id as kvp_id,
          k.key_name,
          k.aliases,
          k.sort_order
        FROM master_kvp_sectors s
        JOIN master_kvps k ON k.sector_id = s.id
        WHERE s.id = ANY($1)
          AND s.is_active = true
          AND k.is_active = true
        ORDER BY s.sort_order, k.sort_order
      `, [sectorIds]);

      // Group by sector
      const grouped = {};
      result.rows.forEach(row => {
        if (!grouped[row.sector_id]) {
          grouped[row.sector_id] = {
            sector_id: row.sector_id,
            sector_code: row.sector_code,
            sector_name: row.sector_name,
            kvps: []
          };
        }

        grouped[row.sector_id].kvps.push({
          kvp_id: row.kvp_id,
          key_name: row.key_name,
          aliases: row.aliases,
          sort_order: row.sort_order
        });
      });

      return Object.values(grouped);
    } catch (error) {
      logger.error('Failed to get KVPs by sectors:', error);
      throw error;
    }
  }

  /**
   * Get all KVPs for a single sector
   * @param {number} sectorId - Sector ID
   * @returns {Promise<Array>} List of KVPs
   */
  async getKVPsForSector(sectorId) {
    try {
      const result = await this.pool.query(`
        SELECT
          id,
          key_name,
          aliases,
          sort_order
        FROM master_kvps
        WHERE sector_id = $1
          AND is_active = true
        ORDER BY sort_order
      `, [sectorId]);

      return result.rows;
    } catch (error) {
      logger.error('Failed to get KVPs for sector:', error);
      throw error;
    }
  }

  // ============================================================================
  // USER PRESETS
  // ============================================================================

  /**
   * Get all presets for a user
   * @param {string} userId - User UUID
   * @returns {Promise<Array>} List of presets
   */
  async getUserPresets(userId) {
    try {
      const result = await this.pool.query(`
        SELECT
          id,
          preset_name,
          description,
          created_at,
          updated_at
        FROM user_presets
        WHERE user_id = $1
        ORDER BY created_at DESC
      `, [userId]);

      return result.rows;
    } catch (error) {
      logger.error('Failed to get user presets:', error);
      throw error;
    }
  }

  /**
   * Get preset with its KVPs
   * @param {number} presetId - Preset ID
   * @param {string} userId - User UUID (for authorization)
   * @returns {Promise<Object>} Preset with KVPs
   */
  async getPresetWithKVPs(presetId, userId) {
    try {
      // Get preset details
      const presetResult = await this.pool.query(`
        SELECT
          id,
          preset_name,
          description,
          created_at,
          updated_at
        FROM user_presets
        WHERE id = $1 AND user_id = $2
      `, [presetId, userId]);

      if (presetResult.rows.length === 0) {
        throw new Error('Preset not found');
      }

      const preset = presetResult.rows[0];

      // Get KVPs in this preset
      const kvpsResult = await this.pool.query(`
        SELECT
          pk.id,
          pk.master_kvp_id,
          pk.custom_key_name,
          pk.sort_order,
          mk.key_name as master_key_name,
          mk.aliases,
          s.id as sector_id,
          s.display_name as sector_name
        FROM user_preset_kvps pk
        LEFT JOIN master_kvps mk ON mk.id = pk.master_kvp_id
        LEFT JOIN master_kvp_sectors s ON s.id = mk.sector_id
        WHERE pk.preset_id = $1
        ORDER BY pk.sort_order
      `, [presetId]);

      // Format KVPs
      preset.kvps = kvpsResult.rows.map(row => ({
        id: row.id,
        key_name: row.custom_key_name || row.master_key_name,
        is_custom: row.custom_key_name !== null,
        master_kvp_id: row.master_kvp_id,
        sector_id: row.sector_id,
        sector_name: row.sector_name,
        aliases: row.aliases,
        sort_order: row.sort_order
      }));

      return preset;
    } catch (error) {
      logger.error('Failed to get preset with KVPs:', error);
      throw error;
    }
  }

  /**
   * Create a new preset
   * @param {string} userId - User UUID
   * @param {string} presetName - Preset name
   * @param {string} description - Optional description
   * @param {Array} kvps - Array of KVP definitions
   * @returns {Promise<Object>} Created preset
   */
  async createPreset(userId, presetName, description, kvps) {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Check if preset name already exists for this user
      const existing = await client.query(
        'SELECT id FROM user_presets WHERE user_id = $1 AND preset_name = $2',
        [userId, presetName]
      );

      if (existing.rows.length > 0) {
        throw new Error('A preset with this name already exists');
      }

      // Create preset
      const presetResult = await client.query(`
        INSERT INTO user_presets (user_id, preset_name, description)
        VALUES ($1, $2, $3)
        RETURNING id, preset_name, description, created_at
      `, [userId, presetName, description]);

      const preset = presetResult.rows[0];

      // Insert KVPs
      for (let i = 0; i < kvps.length; i++) {
        const kvp = kvps[i];

        await client.query(`
          INSERT INTO user_preset_kvps (preset_id, master_kvp_id, custom_key_name, sort_order)
          VALUES ($1, $2, $3, $4)
        `, [
          preset.id,
          kvp.master_kvp_id || null,
          kvp.custom_key_name || null,
          i + 1
        ]);
      }

      await client.query('COMMIT');

      logger.info(`✓ Created preset "${presetName}" for user ${userId}`);

      return preset;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to create preset:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update preset name or description
   * @param {number} presetId - Preset ID
   * @param {string} userId - User UUID
   * @param {string} presetName - New preset name
   * @param {string} description - New description
   * @returns {Promise<Object>} Updated preset
   */
  async updatePreset(presetId, userId, presetName, description) {
    try {
      const result = await this.pool.query(`
        UPDATE user_presets
        SET preset_name = $1,
            description = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $3 AND user_id = $4
        RETURNING id, preset_name, description, updated_at
      `, [presetName, description, presetId, userId]);

      if (result.rows.length === 0) {
        throw new Error('Preset not found');
      }

      logger.info(`✓ Updated preset ${presetId} for user ${userId}`);

      return result.rows[0];
    } catch (error) {
      logger.error('Failed to update preset:', error);
      throw error;
    }
  }

  /**
   * Update preset including its KVPs
   * @param {number} presetId - Preset ID
   * @param {string} userId - User UUID
   * @param {string} presetName - New preset name
   * @param {string} description - New description
   * @param {Array} kvps - Array of KVP definitions
   * @returns {Promise<Object>} Updated preset
   */
  async updatePresetWithKVPs(presetId, userId, presetName, description, kvps) {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Verify preset exists and belongs to user
      const presetCheck = await client.query(
        'SELECT id FROM user_presets WHERE id = $1 AND user_id = $2',
        [presetId, userId]
      );

      if (presetCheck.rows.length === 0) {
        throw new Error('Preset not found');
      }

      // Update preset metadata
      const presetResult = await client.query(`
        UPDATE user_presets
        SET preset_name = $1,
            description = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $3 AND user_id = $4
        RETURNING id, preset_name, description, updated_at
      `, [presetName, description, presetId, userId]);

      const preset = presetResult.rows[0];

      // Delete existing KVPs for this preset
      await client.query(
        'DELETE FROM user_preset_kvps WHERE preset_id = $1',
        [presetId]
      );

      // Insert updated KVPs
      for (let i = 0; i < kvps.length; i++) {
        const kvp = kvps[i];

        await client.query(`
          INSERT INTO user_preset_kvps (preset_id, master_kvp_id, custom_key_name, sort_order)
          VALUES ($1, $2, $3, $4)
        `, [
          preset.id,
          kvp.master_kvp_id || null,
          kvp.custom_key_name || null,
          i + 1
        ]);
      }

      await client.query('COMMIT');

      logger.info(`✓ Updated preset ${presetId} with ${kvps.length} KVPs for user ${userId}`);

      return preset;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to update preset with KVPs:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Delete a preset
   * @param {number} presetId - Preset ID
   * @param {string} userId - User UUID
   * @returns {Promise<boolean>} Success
   */
  async deletePreset(presetId, userId) {
    try {
      const result = await this.pool.query(`
        DELETE FROM user_presets
        WHERE id = $1 AND user_id = $2
        RETURNING id
      `, [presetId, userId]);

      if (result.rows.length === 0) {
        throw new Error('Preset not found');
      }

      logger.info(`✓ Deleted preset ${presetId} for user ${userId}`);

      return true;
    } catch (error) {
      logger.error('Failed to delete preset:', error);
      throw error;
    }
  }

  // ============================================================================
  // USER CUSTOM KVPS
  // ============================================================================

  /**
   * Get all custom KVPs for a user
   * @param {string} userId - User UUID
   * @returns {Promise<Array>} List of custom KVPs
   */
  async getUserCustomKVPs(userId) {
    try {
      const result = await this.pool.query(`
        SELECT
          id,
          custom_key_name,
          created_at
        FROM user_custom_kvps
        WHERE user_id = $1
        ORDER BY created_at DESC
      `, [userId]);

      return result.rows;
    } catch (error) {
      logger.error('Failed to get user custom KVPs:', error);
      throw error;
    }
  }

  /**
   * Create a custom KVP
   * @param {string} userId - User UUID
   * @param {string} customKeyName - Custom field name
   * @returns {Promise<Object>} Created custom KVP
   */
  async createCustomKVP(userId, customKeyName) {
    try {
      // Check if custom field already exists for this user
      const existing = await this.pool.query(
        'SELECT id FROM user_custom_kvps WHERE user_id = $1 AND custom_key_name = $2',
        [userId, customKeyName]
      );

      if (existing.rows.length > 0) {
        throw new Error('A custom field with this name already exists');
      }

      const result = await this.pool.query(`
        INSERT INTO user_custom_kvps (user_id, custom_key_name)
        VALUES ($1, $2)
        RETURNING id, custom_key_name, created_at
      `, [userId, customKeyName]);

      logger.info(`✓ Created custom KVP "${customKeyName}" for user ${userId}`);

      return result.rows[0];
    } catch (error) {
      logger.error('Failed to create custom KVP:', error);
      throw error;
    }
  }

  /**
   * Delete a custom KVP
   * @param {number} customKvpId - Custom KVP ID
   * @param {string} userId - User UUID
   * @returns {Promise<boolean>} Success
   */
  async deleteCustomKVP(customKvpId, userId) {
    try {
      const result = await this.pool.query(`
        DELETE FROM user_custom_kvps
        WHERE id = $1 AND user_id = $2
        RETURNING id
      `, [customKvpId, userId]);

      if (result.rows.length === 0) {
        throw new Error('Custom field not found');
      }

      logger.info(`✓ Deleted custom KVP ${customKvpId} for user ${userId}`);

      return true;
    } catch (error) {
      logger.error('Failed to delete custom KVP:', error);
      throw error;
    }
  }

  // ============================================================================
  // DOCUMENT EXTRACTIONS
  // ============================================================================

  /**
   * Create extraction session
   * @param {string} fileId - File UUID
   * @param {string} userId - User UUID
   * @param {number} presetId - Optional preset ID
   * @param {Array<number>} sectorIds - Sector IDs used
   * @param {number} totalKvpsRequested - Total KVPs requested
   * @returns {Promise<Object>} Extraction session
   */
  async createExtraction(fileId, userId, presetId, sectorIds, totalKvpsRequested) {
    try {
      const result = await this.pool.query(`
        INSERT INTO document_extractions
        (file_id, user_id, preset_id, sector_ids, extraction_status, total_kvps_requested)
        VALUES ($1, $2, $3, $4, 'pending', $5)
        RETURNING id, file_id, extraction_status, created_at
      `, [fileId, userId, presetId, JSON.stringify(sectorIds), totalKvpsRequested]);

      logger.info(`✓ Created extraction session ${result.rows[0].id} for file ${fileId}`);

      return result.rows[0];
    } catch (error) {
      logger.error('Failed to create extraction:', error);
      throw error;
    }
  }

  /**
   * Update extraction status
   * @param {number} extractionId - Extraction ID
   * @param {string} status - New status
   * @param {string} errorMessage - Optional error message
   * @returns {Promise<void>}
   */
  async updateExtractionStatus(extractionId, status, errorMessage = null) {
    try {
      const updates = ['extraction_status = $1'];
      const params = [status, extractionId];

      if (status === 'completed' || status === 'failed') {
        updates.push('completed_at = CURRENT_TIMESTAMP');
      }

      if (errorMessage) {
        updates.push(`error_message = $${params.length + 1}`);
        params.splice(1, 0, errorMessage);
      }

      await this.pool.query(`
        UPDATE document_extractions
        SET ${updates.join(', ')}
        WHERE id = $${params.length}
      `, params);

      logger.info(`✓ Updated extraction ${extractionId} status to ${status}`);
    } catch (error) {
      logger.error('Failed to update extraction status:', error);
      throw error;
    }
  }

  /**
   * Store extracted KVPs
   * @param {number} extractionId - Extraction ID
   * @param {Array} kvps - Array of extracted KVPs
   * @returns {Promise<number>} Number of KVPs stored
   */
  async storeExtractedKVPs(extractionId, kvps) {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      let count = 0;

      for (const kvp of kvps) {
        await client.query(`
          INSERT INTO extracted_kvps
          (extraction_id, kvp_key, kvp_value, source_type, master_kvp_id, page_number)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          extractionId,
          kvp.key,
          kvp.value,
          kvp.source_type || 'master',
          kvp.master_kvp_id || null,
          kvp.page_number || null
        ]);

        count++;
      }

      // Update extraction stats
      await client.query(`
        UPDATE document_extractions
        SET total_kvps_extracted = $1,
            extraction_status = 'completed',
            completed_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [count, extractionId]);

      await client.query('COMMIT');

      logger.info(`✓ Stored ${count} extracted KVPs for extraction ${extractionId}`);

      return count;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to store extracted KVPs:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get extraction results
   * @param {number} extractionId - Extraction ID
   * @param {string} userId - User UUID (for authorization)
   * @returns {Promise<Object>} Extraction with KVPs
   */
  async getExtractionResults(extractionId, userId) {
    try {
      // Get extraction details
      const extractionResult = await this.pool.query(`
        SELECT
          e.id,
          e.file_id,
          e.preset_id,
          e.sector_ids,
          e.extraction_status,
          e.total_kvps_requested,
          e.total_kvps_extracted,
          e.processing_time_ms,
          e.error_message,
          e.created_at,
          e.completed_at,
          f.original_filename,
          p.preset_name
        FROM document_extractions e
        JOIN files f ON f.id = e.file_id
        LEFT JOIN user_presets p ON p.id = e.preset_id
        WHERE e.id = $1 AND e.user_id = $2
      `, [extractionId, userId]);

      if (extractionResult.rows.length === 0) {
        throw new Error('Extraction not found');
      }

      const extraction = extractionResult.rows[0];

      // Get extracted KVPs
      const kvpsResult = await this.pool.query(`
        SELECT
          kvp_key,
          kvp_value,
          source_type,
          page_number
        FROM extracted_kvps
        WHERE extraction_id = $1
        ORDER BY id
      `, [extractionId]);

      extraction.extracted_kvps = kvpsResult.rows;

      return extraction;
    } catch (error) {
      logger.error('Failed to get extraction results:', error);
      throw error;
    }
  }

  /**
   * Get extraction history for a user
   * @param {string} userId - User UUID
   * @param {number} limit - Max results
   * @returns {Promise<Array>} List of extractions
   */
  async getUserExtractionHistory(userId, limit = 50) {
    try {
      const result = await this.pool.query(`
        SELECT
          e.id,
          e.file_id,
          e.extraction_status,
          e.total_kvps_requested,
          e.total_kvps_extracted,
          e.created_at,
          e.completed_at,
          f.original_filename,
          p.preset_name
        FROM document_extractions e
        JOIN files f ON f.id = e.file_id
        LEFT JOIN user_presets p ON p.id = e.preset_id
        WHERE e.user_id = $1
        ORDER BY e.created_at DESC
        LIMIT $2
      `, [userId, limit]);

      return result.rows;
    } catch (error) {
      logger.error('Failed to get extraction history:', error);
      throw error;
    }
  }
}

module.exports = new KVPService();
