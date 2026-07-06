'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');
const ciWorkflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');

function assertStepBefore(first, second) {
  const firstIndex = ciWorkflow.indexOf(first);
  const secondIndex = ciWorkflow.indexOf(second);
  assert.notEqual(firstIndex, -1, `missing workflow step ${first}`);
  assert.notEqual(secondIndex, -1, `missing workflow step ${second}`);
  assert.ok(firstIndex < secondIndex, `${first} must run before ${second}`);
}

test('CI jobs that both test and build run tests before builds', () => {
  assertStepBefore('- name: Test frontend-v2', '- name: Build frontend-v2');
  assertStepBefore('- name: Test driver-app', '- name: Build driver-app');
});
