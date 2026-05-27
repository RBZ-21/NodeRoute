'use strict';

/**
 * Scheduler
 * ─────────
 * Uses node-cron to fire background jobs on a schedule.
 * Started once from server.js after the server begins listening.
 *
 * Jobs:
 *   - Daily Fish Blast: 6:30 AM Eastern, Mon–Sat
 */

let cron;
try {
  cron = require('node-cron');
} catch {
  cron = null;
}

const logger = require('../services/logger');
const { runDailyFishBlast } = require('../services/daily-fish-blast');
const config = require('./config');

// 6:30 AM Eastern = 10:30 UTC (EST) / 11:30 UTC (EDT)
// Use TZ option to let node-cron handle the offset correctly.
const BLAST_CRON = process.env.DAILY_BLAST_CRON || '30 6 * * 1-6';
const BLAST_TZ   = 'America/New_York';

function startScheduler() {
  if (!cron) {
    logger.warn('node-cron is not installed — scheduled jobs will not run. Run: npm install node-cron');
    return;
  }

  if (!cron.validate(BLAST_CRON)) {
    logger.error({ cron: BLAST_CRON }, 'DAILY_BLAST_CRON is not a valid cron expression — scheduler not started');
    return;
  }

  cron.schedule(BLAST_CRON, async () => {
    try {
      const companyName = process.env.COMPANY_NAME || '';
      await runDailyFishBlast(companyName);
    } catch (err) {
      logger.error({ err }, 'Daily fish blast: unhandled error');
    }
  }, { timezone: BLAST_TZ });

  logger.info({ cron: BLAST_CRON, tz: BLAST_TZ }, 'Scheduler started — daily fish blast scheduled');
}

module.exports = { startScheduler };
