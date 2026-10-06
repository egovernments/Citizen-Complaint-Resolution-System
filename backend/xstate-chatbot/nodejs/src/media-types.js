// Content types must match egov-filestore's ALLOWED_FORMATS_MAP, which validates
// the DECLARED type against a per-extension allowlist. Two entries below are not
// the standard MIME type because filestore rejects the standard one: .docx and .csv.
const FILESTORE_CONTENT_TYPES = {
  '.jpg': 'image/jpg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/x-tika-ooxml',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/plain',
  '.txt': 'text/plain'
};

const EXTENSIONS_BY_MIME_TYPE = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/x-tika-ooxml': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/csv': '.csv',
  'text/plain': '.txt'
};

function extensionForMimeType(mimeType) {
  return EXTENSIONS_BY_MIME_TYPE[String(mimeType || '').split(';')[0].trim().toLowerCase()] || '';
}

function filestoreContentType(fileName) {
  const match = String(fileName || '').match(/(\.[a-z0-9]+)$/i);
  return match ? FILESTORE_CONTENT_TYPES[match[1].toLowerCase()] : undefined;
}

function isSupportedMimeType(mimeType) {
  return Boolean(extensionForMimeType(mimeType));
}

module.exports = {
  extensionForMimeType,
  filestoreContentType,
  isSupportedMimeType
};
