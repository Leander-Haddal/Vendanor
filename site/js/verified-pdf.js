const bytesByHash=new Map();

async function sourceBytes(original) {
  if(bytesByHash.has(original.sha256))return bytesByHash.get(original.sha256);
  if(!/^pdf\/(?:archive\/[a-zA-Z0-9_-]+|\d{4}-\d{2}-\d{2}-\d+)\.pdf$/.test(original.asset))throw new Error('Invalid archived PDF path.');
  const response=await fetch(new URL('../'+original.asset,import.meta.url));
  if(!response.ok)throw new Error('The original PDF could not be loaded.');
  const bytes=new Uint8Array(await response.arrayBuffer());
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  const hex=Array.from(digest,v=>v.toString(16).padStart(2,'0')).join('');
  if(hex!==original.sha256)throw new Error('The original PDF has changed. Its excerpt cannot be verified.');
  if(bytesByHash.size>=2)bytesByHash.delete(bytesByHash.keys().next().value);
  bytesByHash.set(hex,bytes);
  return bytes;
}

export async function archiveExcerpt(original,bands) {
  if(!bands?.length)throw new Error('No verified section boundaries are recorded.');
  const {PDFDocument}=await import('../vendor/pdf-lib.mjs');
  const source=await PDFDocument.load(await sourceBytes(original));
  const excerpt=await PDFDocument.create();
  for(const band of bands){
    if(!Number.isInteger(band.page)||band.page<1||band.page>source.getPageCount() || !(band.top>=0&&band.bottom<=1&&band.top<band.bottom))throw new Error('Invalid source bounds.');
    const [page]=await excerpt.copyPages(source,[band.page-1]);
    const box=page.getCropBox();
    if(page.getRotation().angle%360!==0)throw new Error('This page orientation has no verified clipping transform.');
    page.setCropBox(box.x,box.y+box.height*(1-band.bottom),box.width,box.height*(band.bottom-band.top));
    excerpt.addPage(page);
  }
  const bytes=await excerpt.save();
  return URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
}
