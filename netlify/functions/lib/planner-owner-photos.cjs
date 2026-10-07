'use strict';
/** Server-only projection. Never return allocation history or raw paths to the browser. */
function registeredOwnerPhotos(details, requestId, validatePath) {
  const registered=details?.photo_transport?.registered || {};
  return (Array.isArray(details?.photo_manifest) ? details.photo_manifest : []).flatMap(photo=>{
    const saved=registered[photo.client_photo_id];
    if (!saved || !validatePath(saved.object_path,requestId) ||
        !['image/jpeg','image/png','image/webp'].includes(saved.mime_type)) return [];
    return [{path:saved.object_path,clientPhotoId:photo.client_photo_id,
      category:photo.category,caption:photo.caption || '',mimeType:saved.mime_type}];
  });
}
module.exports={registeredOwnerPhotos};
