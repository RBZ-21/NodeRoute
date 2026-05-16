'use strict';

function getErrorMessage(error) {
  return String(error && error.message ? error.message : error || '');
}

function isAiConfigError(error) {
  const message = getErrorMessage(error).toLowerCase();
  const status = Number(error && (error.status || error.statusCode || error.code));

  return (
    message.includes('openai_api_key') ||
    message.includes('incorrect api key') ||
    message.includes('invalid api key') ||
    message.includes('invalid_api_key') ||
    message.includes('authentication') ||
    status === 401
  );
}

function createAiConfigError() {
  const error = new Error('AI service is not configured.');
  error.code = 'AI_CONFIG_ERROR';
  return error;
}

function getAiScanErrorResponse(error, genericMessage) {
  if (isAiConfigError(error)) {
    return {
      status: 503,
      body: { error: 'AI service is not configured. Update OPENAI_API_KEY and restart the server.' },
    };
  }

  return {
    status: 502,
    body: { error: genericMessage },
  };
}

module.exports = {
  createAiConfigError,
  getAiScanErrorResponse,
  isAiConfigError,
};
