/**
 * Seed Master KVP List
 * Populates master_kvp_sectors and master_kvps tables from master_kvps.json
 */

const fs = require('fs');
const path = require('path');
const dbService = require('../services/db.service');
const logger = require('../utils/logger');

const MASTER_KVP_FILE = path.join(__dirname, '../utils/master_kvps.json');

async function seedMasterKVPs() {
  const client = await dbService.pool.connect();

  try {
    logger.info('📋 Starting master KVP seed process...');

    // Read the JSON file
    logger.info('📂 Reading master_kvps.json...');
    const masterData = JSON.parse(fs.readFileSync(MASTER_KVP_FILE, 'utf8'));

    logger.info(`✓ Loaded version ${masterData.version}`);
    logger.info(`  - Total sectors: ${Object.keys(masterData.sectors).length}`);
    logger.info(`  - Total canonical keys: ${masterData.total_canonical_keys}`);
    logger.info(`  - Total aliases: ${masterData.total_aliases}`);

    await client.query('BEGIN');

    // Clear existing data (for re-seeding)
    logger.info('🗑️  Clearing existing master data...');
    await client.query('DELETE FROM master_kvps');
    await client.query('DELETE FROM master_kvp_sectors');

    let totalKVPs = 0;
    let sortOrder = 1;

    // Insert sectors and their KVPs
    for (const [sectorCode, sectorData] of Object.entries(masterData.sectors)) {
      logger.info(`📌 Processing sector: ${sectorData.name}`);

      // Insert sector
      const sectorResult = await client.query(
        `INSERT INTO master_kvp_sectors
         (sector_code, display_name, description, document_types, kvp_count, sort_order, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          sectorCode,
          sectorData.name,
          `${sectorData.name} sector`,
          JSON.stringify(sectorData.document_types || []),
          sectorData.kvps.length,
          sortOrder++,
          masterData.version
        ]
      );

      const sectorId = sectorResult.rows[0].id;
      logger.info(`  ✓ Sector ID: ${sectorId}`);

      // Insert KVPs for this sector
      for (let i = 0; i < sectorData.kvps.length; i++) {
        const kvp = sectorData.kvps[i];

        await client.query(
          `INSERT INTO master_kvps
           (sector_id, key_name, aliases, sort_order, version)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            sectorId,
            kvp.key,
            JSON.stringify(kvp.aliases || []),
            i + 1,
            masterData.version
          ]
        );

        totalKVPs++;
      }

      logger.info(`  ✓ Inserted ${sectorData.kvps.length} KVPs`);
    }

    await client.query('COMMIT');

    logger.info('');
    logger.info('═══════════════════════════════════════════════════════');
    logger.info('✅ Master KVP seed completed successfully!');
    logger.info(`   - Sectors created: ${Object.keys(masterData.sectors).length}`);
    logger.info(`   - Total KVPs inserted: ${totalKVPs}`);
    logger.info(`   - Version: ${masterData.version}`);
    logger.info('═══════════════════════════════════════════════════════');
    logger.info('');

    // Verify counts
    const sectorCount = await client.query('SELECT COUNT(*) FROM master_kvp_sectors');
    const kvpCount = await client.query('SELECT COUNT(*) FROM master_kvps');

    logger.info('📊 Database verification:');
    logger.info(`   - master_kvp_sectors: ${sectorCount.rows[0].count} rows`);
    logger.info(`   - master_kvps: ${kvpCount.rows[0].count} rows`);

    return {
      sectors: Object.keys(masterData.sectors).length,
      kvps: totalKVPs,
      version: masterData.version
    };

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('❌ Seed failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run if called directly
if (require.main === module) {
  seedMasterKVPs()
    .then(() => {
      logger.info('✓ Seed process complete');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('✗ Seed process failed:', error);
      process.exit(1);
    });
}

module.exports = { seedMasterKVPs };
