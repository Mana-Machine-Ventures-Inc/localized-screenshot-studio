// Generates the Tauri app icons from a simple SVG mark using sharp.
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../src-tauri/icons");
fs.mkdirSync(outDir, { recursive: true });

const svg = (size) => `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#5b8cff"/>
      <stop offset="100%" stop-color="#8a6bff"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${size * 0.22}" fill="url(#g)"/>
  <rect x="${size * 0.26}" y="${size * 0.3}" width="${size * 0.48}" height="${size * 0.4}"
    rx="${size * 0.06}" fill="#fff" opacity="0.95"/>
  <circle cx="${size * 0.5}" cy="${size * 0.5}" r="${size * 0.1}" fill="#5b8cff"/>
</svg>`;

const sizes = [
  { name: "32x32.png", size: 32 },
  { name: "128x128.png", size: 128 },
  { name: "128x128@2x.png", size: 256 },
  { name: "icon.png", size: 512 },
];

for (const { name, size } of sizes) {
  await sharp(Buffer.from(svg(size)))
    .png()
    .toFile(path.join(outDir, name));
  console.log("wrote", name);
}
