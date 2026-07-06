'use strict';

// Escapes PostgREST/Postgres LIKE metacharacters so user input matches
// literally in .like()/.ilike() filters instead of acting as wildcards.
// Shared helper (originally local to routes/search.js) — see scan findings
// BE-002/BE-005/BE-006.
function escapeLike(value) {
  return String(value).replace(/[%_\\]/g, (m) => `\\${m}`);
}

module.exports = { escapeLike };
