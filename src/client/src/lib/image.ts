export type ImageBox = { width: number; height: number; crop: boolean };

export const LOGO_BOX: ImageBox = { width: 512, height: 512, crop: true };
export const BANNER_BOX: ImageBox = { width: 1500, height: 500, crop: true };
export const PHOTO_BOX: ImageBox = { width: 1600, height: 1600, crop: false };

/** Scales an image down to the box and re-encodes it as WebP. GIFs keep their animation, so they pass through. */
export async function shrinkImage(file: File, box: ImageBox): Promise<Blob> {
  if (file.type === "image/gif" || typeof createImageBitmap !== "function") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  const { width: w, height: h } = bitmap;
  const scale = box.crop ? Math.max(box.width / w, box.height / h) : Math.min(box.width / w, box.height / h);
  const k = Math.min(1, scale);
  const outW = box.crop ? Math.min(box.width, Math.round(w * k)) : Math.round(w * k);
  const outH = box.crop ? Math.min(box.height, Math.round(h * k)) : Math.round(h * k);
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.imageSmoothingQuality = "high";
  const drawW = w * k;
  const drawH = h * k;
  ctx.drawImage(bitmap, (outW - drawW) / 2, (outH - drawH) / 2, drawW, drawH);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
  return blob && blob.size < file.size ? blob : file;
}
