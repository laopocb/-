/* 体素网格探测：解析 point_wlbwg.voxel，测试多种坐标系变换下锚点/射线的实体性 */
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const meta = JSON.parse(readFileSync(join(ROOT, 'data', 'point_wlbwg.voxel.json'), 'utf8'));
const bin = readFileSync(join(ROOT, 'data', 'point_wlbwg.voxel.bin'));
const view = new Uint32Array(bin.buffer, bin.byteOffset, bin.byteLength >> 2);
const nodes = view.slice(0, meta.nodeCount);
const leafData = view.slice(meta.nodeCount, meta.nodeCount + meta.leafDataCount);
const gMinX = meta.gridBounds.min[0], gMinY = meta.gridBounds.min[1], gMinZ = meta.gridBounds.min[2];
const res = meta.voxelResolution;
const numX = Math.round((meta.gridBounds.max[0]-gMinX)/res);
const numY = Math.round((meta.gridBounds.max[1]-gMinY)/res);
const numZ = Math.round((meta.gridBounds.max[2]-gMinZ)/res);
const SOLID = 0xFF000000 >>> 0;
const popcount = (n) => { n -= (n>>1)&0x55555555; n=(n&0x33333333)+((n>>2)&0x33333333); return ((n+(n>>4))&0x0F0F0F0F)*0x01010101>>>24; };

function checkLeaf(node, ix, iy, iz){
    const idx = node & 0x00FFFFFF;
    const vx = ix & 3, vy = iy & 3, vz = iz & 3;
    const bit = vz*16 + vy*4 + vx;
    if (bit < 32) { const lo = leafData[idx*2]>>>0; return ((lo>>>bit)&1)===1; }
    const hi = leafData[idx*2+1]>>>0; return ((hi>>>(bit-32))&1)===1;
}
function isSolid(ix,iy,iz){
    if (nodes.length===0||ix<0||iy<0||iz<0||ix>=numX||iy>=numY||iz>=numZ) return false;
    const leafSize=meta.leafSize, treeDepth=meta.treeDepth;
    const bx=Math.floor(ix/leafSize), by=Math.floor(iy/leafSize), bz=Math.floor(iz/leafSize);
    let ni=0;
    for (let lv=treeDepth-1; lv>=0; lv--){
        const node=this?.nodes?this.nodes[ni]:nodes[ni];
        const nv=node>>>0;
        if (nv===SOLID) return true;
        const cm=(nv>>>24)&0xFF;
        if (cm===0) return checkLeaf(nv,ix,iy,iz);
        const bitX=(bx>>>lv)&1, bitY=(by>>>lv)&1, bitZ=(bz>>>lv)&1;
        const oct=(bitZ<<2)|(bitY<<1)|bitX;
        if (((cm>>oct)&1)===0) return false;
        const prefix=(1<<oct)-1;
        ni = (nv&0x00FFFFFF) + popcount(cm&prefix);
    }
    const nv=nodes[ni]>>>0;
    if (nv===SOLID) return true;
    return checkLeaf(nv,ix,iy,iz);
}
function solidAt(x,y,z){
    const ix=Math.floor((x-gMinX)/res), iy=Math.floor((y-gMinY)/res), iz=Math.floor((z-gMinZ)/res);
    return isSolid(ix,iy,iz);
}
// DDA 射线：返回第一次命中实体体素的 t（与 queryRay 语义一致）
function rayHitT(ox,oy,oz,dx,dy,dz,maxDist){
    const len=Math.hypot(dx,dy,dz); if(len<1e-10)return null;
    dx/=len; dy/=len; dz/=len;
    const EPS=1e-12;
    let tNear=0, tFar=maxDist;
    const clamp=(v)=>Math.max(0,Math.min(v,1e9));
    for (const [c0,c1,o,d,g0] of [['x','y',ox,dx,gMinX],['z','x',0,0,0]]){
        // placeholder no-op
    }
    // slab
    const slabs=[];
    const put=(o,d,g0,g1)=>{ if(Math.abs(d)>EPS){ let t1=(g0-o)/d, t2=(g1-o)/d; if(t1>t2){const tmp=t1;t1=t2;t2=tmp;} tNear=Math.max(tNear,t1); tFar=Math.min(tFar,t2); } else if(o<g0||o>=g1) return false; return true; };
    if(!put(ox,dx,gMinX,gMinX+numX*res))return null;
    if(!put(oy,dy,gMinY,gMinY+numY*res))return null;
    if(!put(oz,dz,gMinZ,gMinZ+numZ*res))return null;
    if(tNear>tFar)return null;
    let ix=Math.max(0,Math.min(Math.floor((ox+dx*tNear-gMinX)/res),numX-1));
    let iy=Math.max(0,Math.min(Math.floor((oy+dy*tNear-gMinY)/res),numY-1));
    let iz=Math.max(0,Math.min(Math.floor((oz+dz*tNear-gMinZ)/res),numZ-1));
    let sX=dx>0?1:(dx<0?-1:0), sY=dy>0?1:(dy<0?-1:0), sZ=dz>0?1:(dz<0?-1:0);
    const invX=Math.abs(dx)>EPS?1/dx:0, invY=Math.abs(dy)>EPS?1/dy:0, invZ=Math.abs(dz)>EPS?1/dz:0;
    let tMaxX=Math.abs(dx)>EPS?(gMinX+(ix+(dx>0?1:0))*res-ox)*invX:Infinity;
    let tMaxY=Math.abs(dy)>EPS?(gMinY+(iy+(dy>0?1:0))*res-oy)*invY:Infinity;
    let tMaxZ=Math.abs(dz)>EPS?(gMinZ+(iz+(dz>0?1:0))*res-oz)*invZ:Infinity;
    const tDx=Math.abs(dx)>EPS?res*Math.abs(invX):Infinity;
    const tDy=Math.abs(dy)>EPS?res*Math.abs(invY):Infinity;
    const tDz=Math.abs(dz)>EPS?res*Math.abs(invZ):Infinity;
    let cur=tNear;
    const maxSteps=numX+numY+numZ;
    for(let s=0;s<maxSteps;s++){
        if(isSolid(ix,iy,iz)) return cur;
        if(tMaxX<tMaxY){ if(tMaxX<tMaxZ){cur=tMaxX;ix+=sX;tMaxX+=tDx;} else {cur=tMaxZ;iz+=sZ;tMaxZ+=tDz;} }
        else if(tMaxY<tMaxZ){cur=tMaxY;iy+=sY;tMaxY+=tDy;}
        else {cur=tMaxZ;iz+=sZ;tMaxZ+=tDz;}
        if(ix<0||iy<0||iz<0||ix>=numX||iy>=numY||iz>=numZ||cur>maxDist) return null;
    }
    return null;
}

// 候选变换：把 annotation 世界坐标 → 体素网格坐标
const transforms = {
    a: (p)=>[p[0],p[1],p[2]],
    b: (p)=>[p[0],p[2],-p[1]],
    c: (p)=>[p[0],-p[2],p[1]],
    d: (p)=>[-p[2],p[1],p[0]],
    e: (p)=>[p[0],p[1],-p[2]],
};
// 透明平移（无旋转）：
const offsets = {
  o0:[0,0,0],
  o1:7,   // 不可用
};
// 锚点（已知实体性）：
//  spawn(17.22,-.07,.87) 室内空处→应空; door(7.4,-.33,11.5)→空(门口); 1号墙(11.5,.55,23.5)→实(墙);
//  3号区域(-2.13,1.47,27.35)→实(北墙附近); 2号区域(3.52,.92,27.69)→按用户应空(无遮挡)
const anchors = {
    'spawn室内(应空)': [17.22,-0.07,0.87],
    '门口(应空)': [7.4,-0.33,11.5],
    '1号附近(应实=墙)': [11.52,0.55,23.48],
    '3号附近(应实=墙)': [-2.13,1.47,27.35],
    '2号附近(用户说空)': [3.52,0.92,27.69],
    '80号高位(可能网格外)': [2.41,7.7,28.76],
};
for (const [tname, tf] of Object.entries(transforms)) {
    const row = [];
    for (const [aname, p] of Object.entries(anchors)){
        const q = tf(p);
        row.push(`${aname.split('(')[0]}:${solidAt(q[0],q[1],q[2])?'实':'空'}`);
    }
    console.log(`[${tname}] ${row.join(' ')}`);
}
// 全射线 LOS 测试（用户验收场景）—— 使用浏览器实测的相机停靠位！
const cam0 = [-2.97, 0.70, 25.20];
const cases = [
    { name:'初始点→2号[应可见]',  cam:cam0,  tgt:[3.52,0.92,27.69] },
    { name:'初始点→3号[应遮挡]',  cam:cam0,  tgt:[-2.13,1.47,27.35] },
    { name:'初始点→1号[应遮挡]',  cam:cam0,  tgt:[11.52,0.55,23.48] },
    { name:'初始点→80号[应遮挡]', cam:cam0,  tgt:[2.41,7.7,28.76] },
];
console.log('\n--- 真实相机位 各变换 LOS (挡=首次实体命中>0.6m; 近=≤0.6m; 空=无命中) ---');
for (const [tname, tf] of Object.entries(transforms)) {
    const outs = [];
    for (const c of cases){
        const q = tf(c.tgt), q0 = tf(c.cam);
        const dd = Math.hypot(q[0]-q0[0],q[1]-q0[1],q[2]-q0[2]);
        if (dd < 1e-6 || dd > 500) { outs.push(' 空'); continue; }
        const t = rayHitT(q0[0],q0[1],q0[2],q[0]-q0[0],q[1]-q0[1],q[2]-q0[2],dd+0.1);
        if (t === null) { outs.push('空'); continue; }
        const hd = Math.hypot((q0[0]+(q[0]-q0[0])/dd*t)-q[0],(q0[1]+(q[1]-q0[1])/dd*t)-q[1],(q0[2]+(q[2]-q0[2])/dd*t)-q[2]);
        outs.push(hd > 0.6 ? '挡' : '近');
    }
    console.log(`[${tname}] ${cases.map((c,i)=>c.name.split('→')[1]+':'+outs[i]).join('  ')}`);
}
// 目标点所在体素是否实（点被"埋"在扫描实体里）
console.log('\n--- 目标点体素固性 ---');
for (const [tname, tf] of Object.entries(transforms)) {
    const row = [];
    for (const c of cases){ const q=tf(c.tgt); row.push(`${c.name.split('→')[1].split('[')[0]}:${solidAt(q[0],q[1],q[2])?'实':'空'}`); }
    console.log(`[${tname}] ${row.join('  ')}`);
}
// 相机所在体素（应空=人站在自由空间）
console.log('\n--- 相机点体素固性(应空) ---');
for (const [tname, tf] of Object.entries(transforms)) { const q=tf(cam0); console.log(`[${tname}] ${solidAt(q[0],q[1],q[2])?'实(相机在墙里!)':'空(自由)'}`); }

// ===== 决定性测试：浏览器实测停靠相机位 + 体素 identity（=viewer 内部同一映射）=====
console.log('\n=== identity 映射 + (-2.97,0.70,25.20) 停靠点（与浏览器内 queryRay 一致） ===');
const CAM = [-2.97, 0.70, 25.20];
const dots = {
  '2号':[3.52,0.92,27.69], '3号':[-2.13,1.47,27.35],
  '1号':[11.52,0.55,23.48], '80号':[2.41,7.7,28.76]
};
for (const [k,p] of Object.entries(dots)){
  const ox=CAM[0],oy=CAM[1],oz=CAM[2];
  const dd=Math.hypot(p[0]-ox,p[1]-oy,p[2]-oz);
  const t=rayHitT(ox,oy,oz,p[0]-ox,p[1]-oy,p[2]-oz,dd+0.05);
  if(t===null){ console.log(`${k}(距离${dd.toFixed(1)}m): ╳ 无实体命中 → 判定【可见】${solidAt(p[0],p[1],p[2])?'(但目标点体素=实)':''}`); continue; }
  const hx=ox+(p[0]-ox)/dd*t, hy=oy+(p[1]-oy)/dd*t, hz=oz+(p[2]-oz)/dd*t;
  const hd=Math.hypot(hx-p[0],hy-p[1],hz-p[2]);
  // 目标身后探测（沿背离相机方向 1.2m）
  const r2=rayHitT(p[0],p[1],p[2], p[0]-ox,p[1]-oy,p[2]-oz, 1.2);
  console.log(`${k}(距离${dd.toFixed(1)}m): 命中${hd.toFixed(2)}m(命中点(${hx.toFixed(2)},${hy.toFixed(2)},${hz.toFixed(2)})) 后方${r2!==null?'有实体':'无'} → ${hd>0.6?'【遮挡-拦截】':'贴面'}`);
}