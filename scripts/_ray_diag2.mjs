/* 解析 data/1.collision.glb（viewer 实际用于碰撞的网格），直接测射线 */
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buf = readFileSync(join(ROOT, 'data', '1.collision.glb'));
const jsonLen = buf.readUInt32LE(12);
const jsonStr = buf.toString('utf8', 20, 20 + jsonLen);
const json = JSON.parse(jsonStr);
const binOff = 20 + jsonLen + 8;
const dv = new DataView(buf.buffer, buf.byteOffset + binOff);

const posAcc = json.accessors[0];
const idxAcc = json.accessors[1];
const pv = json.bufferViews[0];
const iv = json.bufferViews[1];
const positions = new Float32Array(posAcc.count * 3);
for (let i = 0; i < positions.length; i++) positions[i] = dv.getFloat32(pv.byteOffset + i * 4, true);
const indices = new Uint32Array(idxAcc.count);
for (let i = 0; i < indices.length; i++) indices[i] = dv.getUint32(iv.byteOffset + i * 4, true);

console.log(`GLB: 顶点 ${posAcc.count}, 三角形 ${indices.length/3}`);
console.log(`min=(${posAcc.min.map(v=>v.toFixed(2))}) max=(${posAcc.max.map(v=>v.toFixed(2))})`);

function raycast(ox,oy,oz,dx0,dy0,dz0,maxDist){
    let best=null;
    const len=Math.hypot(dx0,dy0,dz0); if(len<1e-10)return null;
    const dx=dx0/len, dy=dy0/len, dz=dz0/len;
    const triN = indices.length/3;
    for(let t=0;t<triN;t++){
        const i0=indices[t*3],i1=indices[t*3+1],i2=indices[t*3+2];
        const ax=positions[i0*3],ay=positions[i0*3+1],az=positions[i0*3+2];
        const bx=positions[i1*3]-ax,by=positions[i1*3+1]-ay,bz=positions[i1*3+2]-az;
        const cx=positions[i2*3]-ax,cy=positions[i2*3+1]-ay,cz=positions[i2*3+2]-az;
        const rx=dy*cz-dz*cy, ry=dz*cx-dx*cz, rz=dx*cy-dy*cx;
        const det=bx*rx+by*ry+bz*rz; if(Math.abs(det)<1e-12)continue;
        const inv=1/det;
        const sx=ox-ax, sy=oy-ay, sz=oz-az;
        const u=(sx*rx+sy*ry+sz*rz)*inv; if(u<0||u>1)continue;
        const qx=sy*bz-sz*by, qy=sz*bx-sx*bz, qz=sx*by-sy*bx;
        const v=(dx*qx+dy*qy+dz*qz)*inv; if(v<0||u+v>1)continue;
        const tt=(cx*qx+cy*qy+cz*qz)*inv;
        if(tt>1e-6&&tt<=maxDist&&(best===null||tt<best.t)) best={t:tt,hit:[ox+dx*tt,oy+dy*tt,oz+dz*tt]};
    }
    return best;
}
function distt(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);}

const camIn=[17.22,-0.07,0.87];
const camDoor1=[7.40,-0.33,11.50];
const camDoor2=[8.13,-0.92,11.35];
const ann1=[11.52,0.55,23.48];
const ann3=[-2.13,1.47,27.35];

const rays=[
    [`向上@室内`, camIn,[camIn[0],camIn[1]+40,camIn[2]]],
    [`向上@1号`, ann1,[ann1[0],ann1[1]+40,ann1[2]]],
    [`向上@3号`, ann3,[ann3[0],ann3[1]+40,ann3[2]]],
    [`门口→1号`, camDoor1,ann1],
    [`门口→3号`, camDoor1,ann3],
    [`门口2→1号`, camDoor2,ann1],
    [`门口2→3号`, camDoor2,ann3],
    [`室内→3号`, camIn,ann3],
    [`3号→1号`, ann3,ann1],
    [`向上@门口`, camDoor2,[camDoor2[0],camDoor2[1]+40,camDoor2[2]]],
];
for(const[label,o,tgt]of rays){
    const dd=distt(o,tgt);
    const r=raycast(o[0],o[1],o[2],tgt[0]-o[0],tgt[1]-o[1],tgt[2]-o[2],dd+0.01);
    if(r){const hd=distt(r.hit,tgt);console.log(`${label}: 命中 dist=${r.t.toFixed(2)} hit(${r.hit.map(v=>v.toFixed(2))}) 距目标${hd.toFixed(2)}m ${hd>0.5?'→遮挡':'→放行'}`);}
    else console.log(`${label}: 无命中 → 放行`);
}