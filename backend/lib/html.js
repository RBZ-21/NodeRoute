'use strict';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function textToHtml(value) {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

module.exports = { escapeHtml, textToHtml };
