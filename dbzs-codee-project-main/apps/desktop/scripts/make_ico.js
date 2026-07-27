import fs from "fs/promises";
import path from "path";
import sharp from "sharp";

async function main() {
  const inputPath = "assets/icons/dbzs-256.png";
  const outputPath = "build/icon.ico";
  
  const width = 256;
  const height = 256;
  
  console.log(`Loading image ${inputPath}...`);
  // Get raw RGBA pixels
  const { data, info } = await sharp(inputPath)
    .resize(width, height)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
    
  console.log("Extracting and converting pixels to BGRA (bottom-to-top)...");
  // Convert RGBA (top-to-bottom) to BGRA (bottom-to-top)
  const xorSize = width * height * 4;
  const xorMask = Buffer.alloc(xorSize);
  
  for (let y = 0; y < height; y++) {
    const srcRowOffset = y * width * 4;
    const destRowOffset = (height - 1 - y) * width * 4;
    for (let x = 0; x < width; x++) {
      const srcPixel = srcRowOffset + x * 4;
      const destPixel = destRowOffset + x * 4;
      
      const r = data[srcPixel];
      const g = data[srcPixel + 1];
      const b = data[srcPixel + 2];
      const a = data[srcPixel + 3];
      
      xorMask[destPixel] = b;
      xorMask[destPixel + 1] = g;
      xorMask[destPixel + 2] = r;
      xorMask[destPixel + 3] = a;
    }
  }
  
  console.log("Creating AND mask...");
  // Create AND mask (1 bit per pixel, bottom-to-top)
  // 32 bytes * 256 rows = 8192 bytes.
  const andSize = (width * height) / 8;
  const andMask = Buffer.alloc(andSize, 0); // all zeros
  
  // BitmapInfo Header (40 bytes)
  const bih = Buffer.alloc(40);
  bih.writeUInt32LE(40, 0);         // biSize
  bih.writeInt32LE(width, 4);       // biWidth
  bih.writeInt32LE(height * 2, 8);  // biHeight (XOR + AND mask height, so doubled!)
  bih.writeUInt16LE(1, 12);         // biPlanes
  bih.writeUInt16LE(32, 14);        // biBitCount
  bih.writeUInt32LE(0, 16);         // biCompression (BI_RGB = 0)
  bih.writeUInt32LE(xorSize + andSize, 20); // biSizeImage
  bih.writeInt32LE(0, 24);          // biXPelsPerMeter
  bih.writeInt32LE(0, 28);          // biYPelsPerMeter
  bih.writeUInt32LE(0, 32);         // biClrUsed
  bih.writeUInt32LE(0, 36);         // biClrImportant
  
  const dibSize = bih.length + xorMask.length + andMask.length;
  
  // ICO Header (6 bytes)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type = 1 (ICO)
  header.writeUInt16LE(1, 4); // Count = 1
  
  // Directory Entry (16 bytes)
  const dirEntry = Buffer.alloc(16);
  dirEntry.writeUInt8(width === 256 ? 0 : width, 0);   // Width
  dirEntry.writeUInt8(height === 256 ? 0 : height, 1); // Height
  dirEntry.writeUInt8(0, 2);  // Color count (0 for 32bpp)
  dirEntry.writeUInt8(0, 3);  // Reserved
  dirEntry.writeUInt16LE(1, 4); // Planes
  dirEntry.writeUInt16LE(32, 6); // BitCount
  dirEntry.writeUInt32LE(dibSize, 8); // Size of DIB
  dirEntry.writeUInt32LE(22, 12); // Offset of DIB (header + dirEntry = 22)
  
  const finalBuffer = Buffer.concat([header, dirEntry, bih, xorMask, andMask]);
  
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, finalBuffer);
  console.log(`Successfully created standard DIB icon at ${outputPath}`);
}

main().catch(console.error);
