#!/usr/bin/env node

/**
 * Logo Icon Generator für DBZS Codee
 * Konvertiert ein Input-Image zu verschiedenen Icon-Größen
 * 
 * Verwendung:
 *   node scripts/generate-icons.mjs <input-image> [--color #RRGGBB]
 * 
 * Beispiele:
 *   node scripts/generate-icons.mjs dbzs-logo.png
 *   node scripts/generate-icons.mjs dbzs-logo.png --color #00F0FF
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const assetsDir = path.join(projectRoot, "assets", "icons");

// Icon-Größen für verschiedene Use-Cases
const ICON_SIZES = [
  { size: 16, name: "dbzs-16.png", use: "Taskbar" },
  { size: 32, name: "dbzs-32.png", use: "Taskbar@2x / Dock" },
  { size: 48, name: "dbzs-48.png", use: "Windows" },
  { size: 64, name: "dbzs-64.png", use: "Windows Alt" },
  { size: 128, name: "dbzs-128.png", use: "macOS" },
  { size: 256, name: "dbzs-256.png", use: "macOS@2x / Windows" },
  { size: 512, name: "dbzs-512.png", use: "Linux / macOS@2x" },
  { size: 1024, name: "dbzs-1024.png", use: "App Store / DMG" }
];

const ICO_SIZES = [16, 32, 48, 64, 128, 256];

function buildIcoFromPngBuffers(buffers, sizes) {
  const count = buffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(count, 4);

  const directory = Buffer.alloc(count * 16);
  let offset = header.length + directory.length;

  buffers.forEach((buffer, index) => {
    const size = sizes[index];
    const entryOffset = index * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, entryOffset + 0);
    directory.writeUInt8(size >= 256 ? 0 : size, entryOffset + 1);
    directory.writeUInt8(0, entryOffset + 2); // palette colors
    directory.writeUInt8(0, entryOffset + 3); // reserved
    directory.writeUInt16LE(1, entryOffset + 4); // color planes
    directory.writeUInt16LE(32, entryOffset + 6); // bits per pixel
    directory.writeUInt32LE(buffer.length, entryOffset + 8);
    directory.writeUInt32LE(offset, entryOffset + 12);
    offset += buffer.length;
  });

  return Buffer.concat([header, directory, ...buffers]);
}

async function parseArgs() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error("❌ Fehler: Input-Image erforderlich");
    console.log("\nVerwendung: node scripts/generate-icons.mjs <input-image> [--color #RRGGBB]");
    console.log("Beispiele:");
    console.log("  node scripts/generate-icons.mjs dbzs-logo.png");
    console.log("  node scripts/generate-icons.mjs dbzs-logo.png --color #00F0FF");
    process.exit(1);
  }

  const inputImage = args[0];
  const colorIndex = args.indexOf("--color");
  const colorHex = colorIndex !== -1 ? args[colorIndex + 1] : null;

  return { inputImage, colorHex };
}

async function validateInput(inputPath) {
  try {
    await fs.access(inputPath);
    return true;
  } catch {
    console.error(`❌ Fehler: Input-Image nicht gefunden: ${inputPath}`);
    process.exit(1);
  }
}

async function generatePNGIcons(inputPath, outputDir, colorHex) {
  console.log("\n🎨 Generiere PNG Icons...");
  
  for (const { size, name, use } of ICON_SIZES) {
    try {
      let pipeline = sharp(inputPath).resize(size, size, {
        fit: "contain",
        background: { r: 7, g: 11, b: 16, alpha: 0 } // DBZS Dark background
      });

      if (colorHex) {
        // Color-Overlay für Custom-Farben
        pipeline = pipeline.tint(colorHex);
      }

      const outputPath = path.join(outputDir, name);
      await pipeline.png().toFile(outputPath);
      
      console.log(`  ✓ ${name.padEnd(20)} (${size}x${size}) - ${use}`);
    } catch (error) {
      console.error(`  ✗ Fehler bei ${name}: ${error.message}`);
    }
  }
}

async function generateICO(inputPath, outputDir) {
  console.log("\n🪟 Generiere Windows .ico...");
  
  try {
    // Generiere mehrere Größen für ICO
    const buffers = [];
    for (const size of ICO_SIZES) {
      const buffer = await sharp(inputPath)
        .resize(size, size, {
          fit: "contain",
          background: { r: 7, g: 11, b: 16, alpha: 0 }
        })
        .png()
        .toBuffer();
      buffers.push(buffer);
    }

    const icoPath = path.join(outputDir, "dbzs.ico");
    const icoBuffer = buildIcoFromPngBuffers(buffers, ICO_SIZES);
    await fs.writeFile(icoPath, icoBuffer);
    
    console.log(`  ✓ dbzs.ico (${ICO_SIZES.join(", ")} embedded PNG sizes)`);
  } catch (error) {
    console.error(`  ✗ Fehler bei ICO-Generierung: ${error.message}`);
  }
}

async function generateSVG(inputPath, outputDir) {
  console.log("\n📐 Erstelle SVG Version...");
  
  try {
    // Für SVG empfehlen wir, das Original manuell als SVG zu exportieren
    const svgTemplatePath = path.join(outputDir, "dbzs-logo.svg");
    
    const svgTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <!-- DBZS Logo SVG - Bitte manuell von der PNG-Version konvertieren -->
  <!-- Verwende: https://www.cloudconvert.com/ oder Adobe Illustrator -->
  <!-- Oder nutze: https://potrace.sourceforge.net/ für Bitmap-zu-Vector -->
  <defs>
    <style>
      .logo-bg { fill: #070b10; }
      .logo-fill { fill: #00f0ff; stroke: #00f0ff; stroke-width: 2; }
    </style>
  </defs>
  <rect class="logo-bg" width="256" height="256" rx="32"/>
  <g transform="translate(128, 128)">
    <!-- Platzhalter für Llama-Logo -->
    <circle class="logo-fill" r="40" opacity="0.3"/>
  </g>
</svg>`;

    await fs.writeFile(svgTemplatePath, svgTemplate);
    console.log(`  ℹ SVG-Template erstellt: ${svgTemplatePath}`);
    console.log(`    → Bitte manuell konvertieren oder verwenden Sie Potrace\n`);
  } catch (error) {
    console.error(`  ✗ Fehler bei SVG-Erstellung: ${error.message}`);
  }
}

async function main() {
  const { inputImage, colorHex } = await parseArgs();
  const inputPath = path.resolve(inputImage);

  console.log("🚀 DBZS Logo Icon Generator\n");
  console.log(`📁 Input:  ${inputPath}`);
  console.log(`📁 Output: ${assetsDir}`);
  if (colorHex) console.log(`🎨 Color:  ${colorHex}`);

  // Validierung
  await validateInput(inputPath);

  // Erstelle Output-Verzeichnis
  await fs.mkdir(assetsDir, { recursive: true });

  // Generiere Icons
  await generatePNGIcons(inputPath, assetsDir, colorHex);
  await generateICO(inputPath, assetsDir);
  await generateSVG(inputPath, assetsDir);

  console.log("\n✅ Icon-Generierung abgeschlossen!");
  console.log(`\n📦 Icons verfügbar in: ${assetsDir}`);
  console.log("\n🔧 Nächste Schritte:");
  console.log("  1. Icons in Electron main.ts konfigurieren");
  console.log("  2. Assets in App.tsx UI integrieren");
  console.log("  3. Testen mit: pnpm dev\n");
}

main().catch(error => {
  console.error("❌ Fehler:", error.message);
  process.exit(1);
});
