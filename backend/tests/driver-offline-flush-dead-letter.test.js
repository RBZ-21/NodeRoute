'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');
const driverAppSource = fs.readFileSync(path.join(repoRoot, 'driver-app', 'src', 'hooks', 'useDriverApp.tsx'), 'utf8');
const driverStorageSource = fs.readFileSync(path.join(repoRoot, 'driver-app', 'src', 'lib', 'storage.ts'), 'utf8');
const offlineQueueSource = fs.readFileSync(path.join(repoRoot, 'driver-app', 'src', 'hooks', 'useOfflineQueue.ts'), 'utf8');

test('temperature and stop-note offline flushes dead-letter poison entries and continue', () => {
  for (const marker of [
    'deadLetterQueuedTemperatureLog(entry, error);',
    'deadLetterQueuedStopNoteUpdate(entry, error);',
    'deadLetteredCount += 1;',
    'continue;',
    'could not sync and was moved aside.',
  ]) {
    assert.ok(driverAppSource.includes(marker), `driver app flush missing marker ${marker}`);
  }

  assert.ok(!driverAppSource.includes('remaining.push(...queuedLogs.slice(index));\n        break;'));
  assert.ok(!driverAppSource.includes('remaining.push(...queuedUpdates.slice(index));\n        break;'));
  assert.ok(driverStorageSource.includes('TEMPERATURE_LOG_DEAD_LETTER_KEY'));
  assert.ok(driverStorageSource.includes('STOP_NOTE_DEAD_LETTER_KEY'));
  assert.ok(driverStorageSource.includes('failedAt: new Date().toISOString()'));
  assert.ok(driverStorageSource.includes('errorMessage: getQueueErrorMessage(error)'));
  assert.ok(driverStorageSource.includes('clearDeadLetteredTemperatureLogs();'));
  assert.ok(driverStorageSource.includes('clearDeadLetteredStopNoteUpdates();'));
});

test('status queue already uses continue-past-conflict behavior as the pattern', () => {
  assert.ok(offlineQueueSource.includes('if (status === 409) {'));
  assert.ok(offlineQueueSource.includes('recordConflict(entry, error);'));
  assert.ok(offlineQueueSource.includes('remaining.push(...queued.slice(index + 1));'));
  assert.ok(offlineQueueSource.includes('continue;'));
});
