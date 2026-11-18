export const attachmentLimit = 4_000_000;
export const captionLimit = 1000;
export const photoTypes = ["image/jpeg", "image/png", "image/webp"];
export const documentType = "application/pdf";

export function formatAttachmentSize(bytes: number) {
  return bytes < 1000 ? bytes + " B"
    : bytes < 1_000_000 ? Math.round(bytes / 1000) + " KB"
    : (bytes / 1_000_000).toFixed(1) + " MB";
}
