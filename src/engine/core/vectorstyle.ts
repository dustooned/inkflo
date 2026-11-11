// Vendored from 2Dope src/core/vectorstyle.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
import { evalDynamic } from './brush';
import { hash01 } from './rng';
import type { StrokePoint, StrokeRecord } from './stroke';
import { applyPoint, invert, type Mat } from './selxform';

/** Original, synchronous vector appearance. Image tips are bounded alpha data, never library links. */
export interface VectorStyle {
  v: 1;
  mode: 'ink' | 'flat' | 'stamp';
  tip: 'dry' | 'pencil' | 'dot' | 'dash' | 'custom';
  mask?: { width: number; height: number; alpha: string };
  /** Fixed material-domain spacing, captured when the line is made. */
  step?: number;
  matrix?: Mat;
}
export interface VectorClip { runs: number[]; matrix: Mat }
export interface VectorControls {
  anchors: number[];
  modes: Record<string, 'curve' | 'straight'>;
  handles: Record<string, { inx: number; iny: number; outx: number; outy: number }>;
}
export const UNIT: Mat = [1, 0, 0, 1, 0, 0];
export const MAX_STAMPS = 12000;
export const MAX_STYLE_POINTS = 20000;
export const VECTOR_RESOURCE_BUDGET = 64 * 1024 * 1024;
export function vectorResourceCost(rec:StrokeRecord):number {
  return (rec.shape?.path.length ?? 0)*2+(rec.style?.mask?.alpha.length ?? 0)+(rec.clips?.reduce((n,c)=>n+c.runs.length*8,0) ?? 0)+(rec.controls?.anchors.length ?? 0)*96;
}
export function assertVectorBudget(strokes:Iterable<StrokeRecord>):void {
  let cost=0;for(const rec of strokes){cost+=vectorResourceCost(rec);if(cost>VECTOR_RESOURCE_BUDGET)throw new Error('The project has reached its editable vector material/clip limit (64 MB).');}
}
export function multiply(a: Mat, b: Mat): Mat {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}
export function readVectorStyle(value: unknown): VectorStyle {
  const s = value as VectorStyle;
  if (!s || s.v !== 1 || !['ink','flat','stamp'].includes(s.mode) || !['dry','pencil','dot','dash','custom'].includes(s.tip)) throw new Error('Unsupported vector brush renderer or tip');
  if (s.step !== undefined && (!Number.isFinite(s.step) || s.step < .05 || s.step > 1e7)) throw new Error('Invalid vector spacing');
  if (s.matrix) readMatrix(s.matrix);
  if (s.mask) {
    const m = s.mask;
    if (!Number.isInteger(m.width) || !Number.isInteger(m.height) || m.width < 1 || m.height < 1 || m.width > 128 || m.height > 128 || typeof m.alpha !== 'string' || m.alpha.length !== m.width*m.height*2 || !/^[0-9a-f]+$/i.test(m.alpha)) throw new Error('Invalid vector tip: maximum 128 × 128 alpha pixels');
    if(!/[1-9a-f]/i.test(m.alpha))throw new Error('The vector tip has no visible pixels');
  }
  if (s.mode === 'stamp' && s.tip === 'custom' && !s.mask) throw new Error('The custom vector tip is missing');
  return structuredClone(s);
}
export function readMatrix(v: unknown): Mat {
  if (!Array.isArray(v) || v.length !== 6 || !v.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e7) || !invert(v as unknown as Mat)) throw new Error('Invalid vector transform');
  return v as unknown as Mat;
}
export function readVectorClips(v: unknown): VectorClip[] {
  if (!Array.isArray(v) || v.length > 16) throw new Error('Too many vector selection clips');
  return v.map(c => {
    if (!c || !Array.isArray(c.runs) || c.runs.length > 196608 || c.runs.length % 3 || !c.runs.every((n: unknown) => Number.isInteger(n) && Math.abs(n as number) <= 1e6)) throw new Error('Invalid vector selection clip');
    for (let i=0;i<c.runs.length;i+=3) {
      if (c.runs[i+2] <= c.runs[i+1] || (i && (c.runs[i]<c.runs[i-3] || (c.runs[i]===c.runs[i-3] && c.runs[i+1]<c.runs[i-1])))) throw new Error('Invalid vector selection span');
    }
    return { runs: [...c.runs], matrix: readMatrix(c.matrix) };
  });
}
export function readVectorControls(v: unknown, count: number): VectorControls {
  const c = v as VectorControls;
  const index = (k: string) => /^\d+$/.test(k) && Number(k) < count;
  if (!c || !Array.isArray(c.anchors) || c.anchors.length > count || !c.anchors.every((n,i) => Number.isInteger(n) && n >= 0 && n < count && (!i || n > c.anchors[i-1]!)) || !c.modes || !c.handles || Object.keys(c.modes).length > count || Object.keys(c.handles).length > count) throw new Error('Invalid authored vector controls');
  if (!Object.entries(c.modes).every(([k,m]) => index(k) && ['curve','straight'].includes(m))) throw new Error('Invalid vector corner mode');
  if (!Object.entries(c.handles).every(([k,h]) => index(k) && h && ['inx','iny','outx','outy'].every(n => Number.isFinite(h[n as keyof typeof h]) && Math.abs(h[n as keyof typeof h]) <= 1e6))) throw new Error('Invalid vector handle');
  return structuredClone(c);
}

/** Capture speed once, after input correction. u survives cuts, edits and affine transforms. */
export function prepareVectorStroke(rec: StrokeRecord): StrokeRecord {
  const source = rec.style ?? rec.brush.vectorStyle;
  if (!source) return rec;
  if(rec.points.length>MAX_STYLE_POINTS)throw new Error('This editable vector line exceeds 20,000 samples. Finish long artwork as several strokes.');
  if (rec.style && rec.points.every(p => p.u !== undefined && p.speed !== undefined)) return rec;
  const style = readVectorStyle(source);
  let u = 0;
  const points = rec.points.map((p,i) => {
    const prev = rec.points[Math.max(0,i-1)]!;
    const d = Math.hypot(p.x-prev.x,p.y-prev.y);
    u += d;
    return { ...p, u: p.u ?? u, speed: p.speed ?? Math.min(1,d/Math.max(1,p.t-prev.t)/2) };
  });
  const length = points.at(-1)?.u ?? 0;
  style.step ??= Math.max(.05, rec.brush.size * Math.max(.02,rec.brush.spacing), length/(MAX_STAMPS-1));
  const { vectorStyle: _, tipImage: _tip, grainImage: _grain, ...brush } = rec.brush;
  return { ...rec, style, brush, points };
}

export function transformVector(rec: StrokeRecord, m: Mat, scale = 1): StrokeRecord {
  const c = rec.controls;
  const handles = c && Object.fromEntries(Object.entries(c.handles).map(([k,h]) => [k,{ inx:m[0]*h.inx+m[2]*h.iny, iny:m[1]*h.inx+m[3]*h.iny, outx:m[0]*h.outx+m[2]*h.outy, outy:m[1]*h.outx+m[3]*h.outy }]));
  return { ...rec, points:rec.points.map(p => {const [x,y]=applyPoint(m,p.x,p.y);return {...p,x,y};}),
    brush: rec.style || rec.shape ? rec.brush : {...rec.brush,size:rec.brush.size*Math.abs(scale)},
    ...(rec.shape ? {shape:{...rec.shape,matrix:multiply(m,rec.shape.matrix)}} : {}),
    ...(rec.style ? {style:{...rec.style,matrix:multiply(m,rec.style.matrix ?? UNIT)}} : {}),
    ...(c ? {controls:{...c,handles:handles!}} : {}),
    ...(rec.clips ? {clips:rec.clips.map(c => ({...c,matrix:multiply(m,c.matrix)}))} : {}) };
}

/** Run-length pixel clip; a rectangle selection costs three numbers per row. */
export function selectionClip(mask: Uint8Array, w: number, h: number, outside = false): VectorClip {
  const runs: number[] = [];
  for (let y=0;y<h;y++) {
    let start=-1;
    for(let x=0;x<=w;x++) {
      const keep=x<w && (!!mask[y*w+x] !== outside);
      if(keep && start<0) start=x;
      if(!keep && start>=0) { runs.push(y,start,x);start=-1; }
    }
    if(runs.length>196608) throw new Error('This selection is too complex for editable vector clips. Simplify the selection first.');
  }
  return {runs,matrix:UNIT};
}

/** Test saved clip pixels, used to avoid erasing a hidden part of a restricted line. */
export function insideVectorClips(rec:StrokeRecord,x:number,y:number):boolean {
  return (rec.clips ?? []).every(c=>{
    const inv=invert(c.matrix);if(!inv)return false;
    const [px,py]=applyPoint(inv,x,y), row=Math.floor(py);
    let lo=0,hi=c.runs.length/3;
    while(lo<hi){const mid=(lo+hi)>>>1;if(c.runs[mid*3]!<row)lo=mid+1;else hi=mid;}
    for(let i=lo*3;i<c.runs.length && c.runs[i]===row;i+=3)if(px>=c.runs[i+1]! && px<c.runs[i+2]!)return true;
    return false;
  });
}

/** Existing whole-path selection, extended to a clipped mark whose entire restriction is
 * selected. Its hidden centreline may legitimately extend beyond the active stencil. */
export function vectorSelected(rec:StrokeRecord,mask:Uint8Array,w:number,h:number):boolean {
  const inside=(x:number,y:number)=>{const px=Math.floor(x),py=Math.floor(y);return px>=0 && py>=0 && px<w && py<h && mask[py*w+px]===1;};
  if(!rec.points.length)return false;
  if(rec.points.every(p=>inside(p.x,p.y)))return true;
  return (rec.clips ?? []).some(clip=>{
    if(clip.matrix.every((n,i)=>n===UNIT[i])) {
      let any=false;
      for(let i=0;i<clip.runs.length;i+=3) {
        const y=clip.runs[i]!;if(y<0 || y>=h)continue;
        for(let x=Math.max(0,clip.runs[i+1]!);x<Math.min(w,clip.runs[i+2]!);x++){any=true;if(!mask[y*w+x])return false;}
      }
      return any;
    }
    // Conservative transformed-clip test. Checking its whole pixel envelope also avoids
    // sampling over holes when a nonuniform stretch magnifies source pixels.
    let x0=w,y0=h,x1=0,y1=0;
    for(let i=0;i<clip.runs.length;i+=3)for(const [x,y] of [[clip.runs[i+1]!,clip.runs[i]!],[clip.runs[i+2]!,clip.runs[i]!],[clip.runs[i+1]!,clip.runs[i]!+1],[clip.runs[i+2]!,clip.runs[i]!+1]]) {
      const [tx,ty]=applyPoint(clip.matrix,x!,y!);x0=Math.min(x0,Math.floor(tx));y0=Math.min(y0,Math.floor(ty));x1=Math.max(x1,Math.ceil(tx));y1=Math.max(y1,Math.ceil(ty));
    }
    const restricted={...rec,clips:[clip]};let any=false;
    for(let y=Math.max(0,y0);y<Math.min(h,y1);y++)for(let x=Math.max(0,x0);x<Math.min(w,x1);x++) {
      if(!insideVectorClips(restricted,x+.5,y+.5))continue;any=true;if(!mask[y*w+x])return false;
    }
    return any;
  });
}

export interface VectorDab { x:number; y:number; radius:number; angle:number; alpha:number; index:number }
export function canonicalPoints(rec: StrokeRecord): StrokePoint[] {
  const inv = rec.style?.matrix && invert(rec.style.matrix);
  return inv ? rec.points.map(p => {const [x,y]=applyPoint(inv,p.x,p.y);return {...p,x,y};}) : rec.points;
}
export function styledRadius(rec: StrokeRecord,p:StrokePoint,index:number):number {
  const b=rec.brush;
  const signal={pressure:p.pressure,tilt:Math.min(1,Math.hypot(p.tiltX,p.tiltY)/90),speed:p.speed ?? 0};
  let taper=1;
  const start=rec.points[0]?.u ?? 0, end=rec.points.at(-1)?.u ?? start, u=p.u ?? start;
  if(b.taperStart>0) taper=Math.min(taper,Math.sqrt(Math.max(0,(u-start)/b.taperStart)));
  if(b.taperEnd>0) taper=Math.min(taper,Math.sqrt(Math.max(0,(end-u)/b.taperEnd)));
  return Math.max(.05,b.size/2*evalDynamic(b.sizeDyn,signal,hash01(rec.seed,index,1))*(p.w ?? 1)*Math.max(.05,taper));
}
/** Absolute material coordinates make fragments keep their original stamp identity and phase. */
export function vectorDabs(input: StrokeRecord): VectorDab[] {
  const rec=prepareVectorStroke(input), pts=canonicalPoints(rec), style=rec.style!;
  if(!pts.length) return [];
  const step=style.step!, out:VectorDab[]=[];
  const first=pts[0]!.u!, last=pts.at(-1)!.u!;
  let segment=1;
  const begin=Math.ceil((first-1e-8)/step), end=Math.floor((last+1e-8)/step);
  for(let k=begin;k<=end && out.length<MAX_STAMPS;k++) {
    const u=k*step;
    while(segment<pts.length-1 && pts[segment]!.u!<u) segment++;
    const a=pts[Math.max(0,segment-1)]!, b=pts[Math.min(segment,pts.length-1)]!;
    const t=b.u===a.u ? 0 : Math.max(0,Math.min(1,(u-a.u!)/(b.u!-a.u!)));
    const p={...a,u,x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,pressure:a.pressure+(b.pressure-a.pressure)*t,w:(a.w ?? 1)+((b.w ?? 1)-(a.w ?? 1))*t,tiltX:a.tiltX+(b.tiltX-a.tiltX)*t,tiltY:a.tiltY+(b.tiltY-a.tiltY)*t,speed:(a.speed ?? 0)+((b.speed ?? 0)-(a.speed ?? 0))*t};
    const signal={pressure:p.pressure,tilt:Math.min(1,Math.hypot(p.tiltX,p.tiltY)/90),speed:p.speed};
    const scatter=rec.brush.scatter*rec.brush.size;
    out.push({x:p.x+(hash01(rec.seed,k,8)-.5)*scatter,y:p.y+(hash01(rec.seed,k,9)-.5)*scatter,radius:styledRadius(rec,p,k),angle:rec.brush.angle*Math.PI/180+(rec.brush.followDirection?Math.atan2(b.y-a.y,b.x-a.x):0),alpha:rec.brush.flow*evalDynamic(rec.brush.flowDyn,signal,hash01(rec.seed,k,3))*evalDynamic(rec.brush.opacityDyn,signal,hash01(rec.seed,k,4)),index:k});
  }
  return out;
}

/** Conservative mark envelope for erasing, including scatter, width edits and affine stretch. */
export function vectorReach(rec:StrokeRecord):number {
  let width=1;for(const p of rec.points)width=Math.max(width,p.w ?? 1);
  const m=rec.style?.matrix ?? UNIT;
  return rec.brush.size*(.75*width+(rec.style?.mode==='stamp'?rec.brush.scatter:0))*Math.max(Math.hypot(m[0],m[1])+Math.hypot(m[2],m[3]),1);
}

export function vectorBounds(rec:StrokeRecord):{x0:number;y0:number;x1:number;y1:number} {
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const p of rec.points){x0=Math.min(x0,p.x);y0=Math.min(y0,p.y);x1=Math.max(x1,p.x);y1=Math.max(y1,p.y);}
  const r=vectorReach(rec)+2;
  return {x0:Math.floor(x0-r),y0:Math.floor(y0-r),x1:Math.ceil(x1+r),y1:Math.ceil(y1+r)};
}
