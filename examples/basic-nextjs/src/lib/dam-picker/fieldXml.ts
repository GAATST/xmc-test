/**
 * Raw field value builders for standard Sitecore field types.
 *
 * IMPORTANT (discovered in POC testing, 2026-09-12): XM Cloud only treats an
 * external image/link value as a valid DAM asset when it carries the Content
 * Hub-style attributes:
 *   - Image fields REQUIRE stylelabs-content-type="Image", width and height;
 *     thumbnailsrc is optional but enables thumbnails in the editor UI.
 *   - General Link fields need stylelabs-content-type set to the asset's
 *     content type (e.g. "pdf").
 * Without these, Page Builder rejects the value as an invalid image.
 */

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function buildImageFieldXml(options: {
  src: string;
  alt?: string;
  width: number;
  height: number;
  thumbnailSrc?: string;
  /** XM Cloud's DAM marker attribute; "Image" for images. */
  stylelabsContentType?: string;
}): string {
  const { src, alt, width, height, thumbnailSrc, stylelabsContentType = 'Image' } = options;
  const attributes = [
    `src="${escapeXmlAttribute(src)}"`,
    `stylelabs-content-type="${escapeXmlAttribute(stylelabsContentType)}"`,
    `width="${width}"`,
    `height="${height}"`,
  ];
  if (alt) {
    attributes.push(`alt="${escapeXmlAttribute(alt)}"`);
  }
  if (thumbnailSrc) {
    attributes.push(`thumbnailsrc="${escapeXmlAttribute(thumbnailSrc)}"`);
  }
  return `<image ${attributes.join(' ')} />`;
}

export function buildExternalLinkXml(options: {
  url: string;
  text?: string;
  target?: string;
  title?: string;
  /** XM Cloud's DAM marker attribute; the asset's content type, e.g. "pdf". */
  stylelabsContentType?: string;
}): string {
  const { url, text, target, title, stylelabsContentType } = options;
  const attributes = [`linktype="external"`, `url="${escapeXmlAttribute(url)}"`];
  if (stylelabsContentType) {
    attributes.push(`stylelabs-content-type="${escapeXmlAttribute(stylelabsContentType)}"`);
  }
  if (text) {
    attributes.push(`text="${escapeXmlAttribute(text)}"`);
  }
  if (title) {
    attributes.push(`title="${escapeXmlAttribute(title)}"`);
  }
  if (target) {
    attributes.push(`target="${escapeXmlAttribute(target)}"`);
  }
  return `<link ${attributes.join(' ')} />`;
}
