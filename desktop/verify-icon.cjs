/* Read-only PNG transparency gate for the source and iconutil-extracted ICNS. */
const fs = require('node:fs');
const zlib = require('node:zlib');
function inspectIcon(bytes, expectedSize) {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw Error('Not PNG');
  let width, height, depth, type, interlace;
  const data = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset), name = bytes.toString('ascii', offset + 4, offset + 8);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (chunk.length !== length) throw Error('Truncated PNG');
    if (name === 'IHDR') { width=chunk.readUInt32BE(0);height=chunk.readUInt32BE(4);depth=chunk[8];type=chunk[9];interlace=chunk[12]; }
    if (name === 'IDAT') data.push(chunk);
    offset += length + 12;
  }
  if (width !== expectedSize || height !== expectedSize || depth !== 8 || type !== 6 || interlace !== 0) throw Error('Expected square noninterlaced 8-bit RGBA icon');
  const stride = width * 4, raw = zlib.inflateSync(Buffer.concat(data)), pixels = Buffer.alloc(stride * height);
  if (raw.length !== (stride + 1) * height) throw Error('Invalid pixel length');
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++) {
    const filter=raw[y*(stride+1)];
    if(filter>4) throw Error('Invalid PNG filter');
    for(let x=0;x<stride;x++) {
      const i=y*stride+x,a=x>=4?pixels[i-4]:0,b=y?pixels[i-stride]:0,c=y&&x>=4?pixels[i-stride-4]:0;
      pixels[i]=(raw[y*(stride+1)+1+x]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;
    }
  }
  const alpha=(x,y)=>pixels[(y*width+x)*4+3];
  const corners=[[0,0],[width-1,0],[0,height-1],[width-1,height-1]].map(([x,y])=>alpha(x,y));
  if(corners.some(a=>a!==0)) throw Error('Icon corners must remain fully transparent');
  let opaqueInterior=0;
  for(let y=Math.floor(height/4);y<height*3/4;y++) for(let x=Math.floor(width/4);x<width*3/4;x++) if(alpha(x,y)===255) opaqueInterior++;
  if(opaqueInterior<width*height/100) throw Error('Icon must retain opaque interior artwork');
  return {width,height,corners,opaqueInterior};
}
if(require.main===module) console.log(inspectIcon(fs.readFileSync(process.argv[2]),Number(process.argv[3]||1024)));
module.exports={inspectIcon};