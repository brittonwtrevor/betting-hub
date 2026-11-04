const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

function messageImage(message) {
  const photos = (message?.photo || []).filter(photo => typeof photo.file_id === 'string');
  if (photos.length) {
    const photo = [...photos].sort((a, b) => (b.width * b.height || 0) - (a.width * a.height || 0))[0];
    return { fileId: photo.file_id, fileSize: photo.file_size };
  }
  const document = message?.document;
  if (document?.file_id && imageTypes.has(document.mime_type)) {
    return { fileId: document.file_id, fileSize: document.file_size };
  }
  return null;
}

function imageMime(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

module.exports = { MAX_IMAGE_BYTES, messageImage, imageMime };
