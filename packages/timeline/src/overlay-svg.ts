export interface AnnotationSvg {
  svg: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Build the annotation label as SVG markup plus its bottom-center placement.
 * Shared by the Node/sharp renderer and the in-browser canvas compositor so
 * both produce the same label geometry.
 */
export function buildAnnotationSvg(
  text: string,
  frameWidth: number,
  frameHeight: number
): AnnotationSvg {
  // Escape XML special characters
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const fontSize = Math.max(14, Math.round(frameWidth / 60));
  const paddingX = fontSize;
  const paddingY = Math.round(fontSize * 0.6);
  // Rough estimate: ~0.6em per char
  const textWidth = Math.round(escaped.length * fontSize * 0.6);
  const boxWidth = textWidth + paddingX * 2;
  const boxHeight = fontSize + paddingY * 2;

  const svgWidth = Math.min(boxWidth, frameWidth - 40);
  const svgHeight = boxHeight;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}">
    <rect x="0" y="0" width="${svgWidth}" height="${svgHeight}" rx="6" ry="6" fill="rgba(0,0,0,0.75)"/>
    <text x="${svgWidth / 2}" y="${svgHeight / 2 + fontSize * 0.35}" font-family="system-ui, -apple-system, sans-serif" font-size="${fontSize}" fill="white" text-anchor="middle">${escaped}</text>
  </svg>`;

  return {
    svg,
    left: Math.round((frameWidth - svgWidth) / 2),
    top: frameHeight - svgHeight - 20,
    width: svgWidth,
    height: svgHeight,
  };
}
