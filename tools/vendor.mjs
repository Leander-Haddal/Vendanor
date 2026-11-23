import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

// The import path uses the upstream browser distributions without a CDN.
const releases = [
  ["pdfjs-dist", "6.5.438", "vg8Pw1x+AFKy4AMDvhuWl5cOYV8d698UoEANoFFhc79hqXDnZQqnOXoxw3HG907WHOg1JYOvLhP756boddFxpA=="],
  ["pdf-lib", "1.17.1", "V/mpyJAoTsN4cnP31vc0wfNA1+p20evqqnap0KLoRUN0Yk/p3wN52DOEsL4oBFcLdb76hlpKPtzJIgo67j/XLw=="],
];
const target = fileURLToPath(new URL("../site/vendor/", import.meta.url));

async function archiveFor([name, version, integrity], cache) {
  const file = name + "-" + version + ".tgz";
  let bytes;
  if (cache) {
    bytes = await readFile(join(cache, "maritime-" + file));
  } else {
    const response = await fetch("https://registry.npmjs.org/" + name + "/-/" + file);
    if (!response.ok) throw new Error("Could not read " + file + ": " + response.status);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash("sha512").update(bytes).digest("base64") !== integrity) {
    throw new Error("Release integrity mismatch for " + file);
  }
  return gunzipSync(bytes);
}

function* tarFiles(bytes) {
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    if (!header[0]) return;
    const name = header.toString("utf8", 0, 100).split("\0")[0];
    const size = Number.parseInt(header.toString("ascii", 124, 136), 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > bytes.length) {
      throw new Error("Invalid archive entry " + name);
    }
    if (header[156] === 48 || header[156] === 0) {
      yield [name, bytes.subarray(offset + 512, offset + 512 + size)];
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
}

async function vendor(cache) {
  const modules = new Map([
    ["package/legacy/build/pdf.min.mjs", "pdfjs.mjs"],
    ["package/legacy/build/pdf.worker.min.mjs", "pdf.worker.mjs"],
    ["package/dist/pdf-lib.esm.min.js", "pdf-lib.mjs"],
  ]);
  const licenses = ["Third-party releases used by the local document reader."];
  const fonts = Object.create(null);
  const maps = Object.create(null);
  await mkdir(target, { recursive: true });
  for (const release of releases) {
    licenses.push(release[0] + " " + release[1] + "\nhttps://registry.npmjs.org/" + release[0] + "/-/" + release[0] + "-" + release[1] + ".tgz\nSHA-512 " + release[2]);
    for (const [name, bytes] of tarFiles(await archiveFor(release, cache))) {
      if (modules.has(name)) {
        await writeFile(join(target, modules.get(name)), bytes);
        modules.delete(name);
      } else if (/^package\/(?:cmaps\/|standard_fonts\/)?LICENSE(?:[._][A-Z0-9a-z]+)?$/.test(name)) {
        licenses.push(name + "\n" + bytes.toString("utf8"));
      } else if (/^package\/cmaps\/[\w.-]+\.bcmap$/.test(name)) {
        maps[name.split("/").at(-1)] = bytes.toString("base64");
      } else if (/^package\/standard_fonts\/[\w.-]+\.(?:pfb|ttf)$/.test(name)) {
        fonts[name.split("/").at(-1)] = bytes.toString("base64");
      }
    }
  }
  if (modules.size || !Object.keys(maps).length || !Object.keys(fonts).length) {
    throw new Error("Release files are incomplete");
  }
  await writeFile(join(target, "cmaps.json"), JSON.stringify(maps));
  await writeFile(join(target, "fonts.json"), JSON.stringify(fonts));
  await writeFile(join(target, "LICENSES.txt"), licenses.join("\n\n") + "\n");
}

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--cache-dir")) {
  throw new Error("Usage: node tools/vendor.mjs [--cache-dir directory]");
}
await vendor(args[1]);
