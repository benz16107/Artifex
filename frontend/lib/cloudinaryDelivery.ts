/**
 * Insert Cloudinary URL-API transformation chains after `/image/upload/`.
 * Stored job URLs are plain secure_url values (no transforms); we derive thumbs on the client.
 *
 * @see https://cloudinary.com/documentation/transformation_reference
 */

const UPLOAD = "/image/upload/";

function insertTransformAfterUpload(url: string, transformChain: string): string {
  const i = url.indexOf(UPLOAD);
  if (i === -1) return url;
  const rest = url.slice(i + UPLOAD.length);
  if (rest.startsWith(`${transformChain}/`)) return url;
  return url.slice(0, i + UPLOAD.length) + transformChain + "/" + rest;
}

/** Square crop, smart gravity — for nav tiles, pipeline thumbnails, mesh strip. */
export function cloudinaryThumb(url: string | undefined, size: number): string | undefined {
  if (!url) return undefined;
  if (!url.includes("res.cloudinary.com") || !url.includes(UPLOAD)) return url;
  const chain = `w_${size},h_${size},c_fill,g_auto,q_auto,f_auto`;
  return insertTransformAfterUpload(url, chain);
}

/** Max width, keep aspect — for concept art grids and style picker. */
export function cloudinaryOptimized(url: string | undefined, maxEdge: number): string | undefined {
  if (!url) return undefined;
  if (!url.includes("res.cloudinary.com") || !url.includes(UPLOAD)) return url;
  const chain = `w_${maxEdge},c_limit,q_auto,f_auto`;
  return insertTransformAfterUpload(url, chain);
}
