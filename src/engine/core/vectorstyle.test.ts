// Vendored from 2Dope src/core/vectorstyle.test.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
import { describe, expect, it } from 'vitest';
import { PRESETS, cloneBrush } from './brush';
import type { StrokeRecord } from './stroke';
import { at, eraseVectors } from './vectorcut';
import { clipStrokeToMask } from './vectorclip';
import { canonicalPoints, insideVectorClips, prepareVectorStroke, readVectorStyle, readVectorClips, readVectorControls, transformVector, vectorDabs, vectorSelected, MAX_STAMPS } from './vectorstyle';
import { transformVectors } from './selxform';
import { readBrush } from './brushlib';

function line():StrokeRecord {
  const brush=cloneBrush(PRESETS.find(b=>b.name==='Vector Dots')!);
  brush.size=8;brush.spacing=.75;brush.taperStart=brush.taperEnd=0;brush.scatter=.2;brush.sizeDyn.control='off';brush.sizeDyn.jitter=0;
  return prepareVectorStroke({id:'material',tool:'pen',brush,color:'#123456',seed:42,points:[0,100,200].map((x,i)=>({x,y:40,pressure:.2+i*.4,tiltX:i*10,tiltY:0,t:i*100,w:1+i*.5}))});
}
describe('versioned editable vector marks',()=>{
  it('captures an independent definition and calibrated channels without changing legacy records',()=>{
    const r=line(), p=r.points[1]!;
    expect(p.u).toBe(100);expect(p.speed).toBe(.5);expect(r.style?.v).toBe(1);expect(r.brush.vectorStyle).toBeUndefined();
    const old={...r,style:undefined};expect(prepareVectorStroke(old)).toBe(old);
    expect(prepareVectorStroke(r)).toBe(r);
  });
  it('interpolates width, pressure, tilt, time, speed and absolute material phase at cut ends',()=>{
    const p=at(line().points,.25);
    expect(p).toMatchObject({x:25,y:40,w:1.125,u:25,speed:.125,tiltX:2.5,t:25});expect(p.pressure).toBeCloseTo(.3);
  });
  it('keeps stamp identities across a split at crossings, even for a sparse two-segment line',()=>{
    const r=line();
    const cross=(x:number):StrokeRecord=>({...r,id:`cross${x}`,points:[{...r.points[0]!,x,y:0},{...r.points[1]!,x,y:80}]});
    const out=eraseVectors([r,cross(60),cross(140)],[{x:100,y:40}],.1,'crossing')!;
    const fragments=out.filter(v=>v.id.startsWith('material~'));
    expect(fragments).toHaveLength(2);
    const original=new Map(vectorDabs(r).map(d=>[d.index,d]));
    for(const f of fragments)for(const dab of vectorDabs(f)){const old=original.get(dab.index)!;for(const key of ['x','y','radius','angle','alpha','index'] as const)expect(dab[key]).toBeCloseTo(old[key],10);}
    expect(fragments[0]!.points.at(-1)!.w).toBeCloseTo(1.3);
  });
  it('finds eraser hits in the middle of a sparse segment and along a sparse eraser swipe',()=>{
    const r=line();r.points=[r.points[0]!,r.points[2]!];
    expect(eraseVectors([r],[{x:100,y:0},{x:100,y:80}],1,'whole')).toEqual([]);
    expect(eraseVectors([r],[{x:100,y:100}],1,'whole')).toBeNull();
  });
  it('retains a visible-mark clip when every centre is inside, and when geometry moves later',()=>{
    const r=line(), mask=new Uint8Array(256*100);for(let y=35;y<45;y++)for(let x=0;x<256;x++)mask[y*256+x]=1;
    const clipped=clipStrokeToMask(r,mask,256,100)[0]!;
    expect(clipped.points).toBe(r.points);expect(insideVectorClips(clipped,50,40)).toBe(true);expect(insideVectorClips(clipped,50,47)).toBe(false);
    const moved=transformVector(clipped,[0,2,-.5,0,80,10]);
    expect(insideVectorClips(moved,60,110)).toBe(true);expect(insideVectorClips(moved,56,110)).toBe(false);
  });
  it('does not erase an invisible portion outside a persistent clip',()=>{
    const mask=new Uint8Array(256*100);for(let y=0;y<100;y++)for(let x=0;x<50;x++)mask[y*256+x]=1;
    const r=clipStrokeToMask(line(),mask,256,100)[0]!;
    expect(eraseVectors([r],[{x:150,y:40}],1,'whole')).toBeNull();
    expect(eraseVectors([r],[{x:20,y:40}],1,'whole')).toEqual([]);
  });
  it('copies/transforms a selected restricted mark even when its hidden centreline is outside',()=>{
    const mask=new Uint8Array(256*100);for(let y=0;y<100;y++)for(let x=0;x<50;x++)mask[y*256+x]=1;
    const r=clipStrokeToMask(line(),mask,256,100)[0]!;
    expect(vectorSelected(r,mask,256,100)).toBe(true);
    const moved=transformVectors([r],mask,256,100,[1,0,0,1,20,0],1);
    expect(moved.moved).toBe(1);expect(moved.vectors[0]!.points[2]!.x).toBe(220);
    const hole=mask.slice();hole[20*256+10]=0;expect(vectorSelected(r,hole,256,100)).toBe(false);
  });
  it('applies a full affine mark transform including reflection without re-spacing or changing seed',()=>{
    const r=line();r.controls={anchors:[0,2],modes:{0:'straight'},handles:{0:{inx:-3,iny:2,outx:4,outy:-1}}};
    const moved=transformVector(r,[-2,0,.4,.5,300,20]);
    canonicalPoints(moved).forEach((p,i)=>{expect(p.x).toBeCloseTo(r.points[i]!.x);expect(p.y).toBeCloseTo(r.points[i]!.y);});
    expect(vectorDabs(moved)).toEqual(vectorDabs(r));
    expect(moved.controls!.handles[0]).toEqual({inx:6.8,iny:1,outx:-8.4,outy:-.5});
  });
  it('has no input-batch dependency on a straight constant-speed pressure ramp',()=>{
    const r=line();r.brush.scatter=0;
    const sparse={...r,points:[r.points[0]!,r.points[2]!]};
    // Speed has its captured meaning, including the initial zero sample. Keep it constant here.
    sparse.points=sparse.points.map(p=>({...p,speed:.5}));r.points=r.points.map(p=>({...p,speed:.5}));
    const a=vectorDabs(r),b=vectorDabs(sparse);expect(a.map(d=>d.index)).toEqual(b.map(d=>d.index));
    a.forEach((d,i)=>{expect(d.x).toBeCloseTo(b[i]!.x);expect(d.radius).toBeCloseTo(b[i]!.radius);});
  });
  it('bounds work for a very long dense material line',()=>{
    const r=line();r.style=undefined;r.brush.vectorStyle={v:1,mode:'stamp',tip:'dry'};
    r.points=[{...r.points[0]!,u:undefined},{...r.points[2]!,x:1e6,u:undefined}];
    const prepared=prepareVectorStroke(r);expect(vectorDabs(prepared).length).toBeLessThanOrEqual(MAX_STAMPS);
    const over=line();over.points=Array(20001).fill(over.points[0]);expect(()=>prepareVectorStroke(over)).toThrow(/20,000/);
  });
  it('rejects unsupported, missing, oversized or malformed material data',()=>{
    for(const v of [{v:2,mode:'ink',tip:'dot'},{v:1,mode:'stamp',tip:'custom'},{v:1,mode:'stamp',tip:'custom',mask:{width:129,height:1,alpha:'ff'.repeat(129)}},{v:1,mode:'ink',tip:'dot',matrix:[0,0,0,0,0,0]}])expect(()=>readVectorStyle(v)).toThrow();
    expect(()=>readVectorClips([{runs:[0,5,2],matrix:[1,0,0,1,0,0]}])).toThrow();
    expect(()=>readVectorControls({anchors:[3],modes:{},handles:{}},3)).toThrow();
    expect(readBrush({...line().brush,name:'Bad custom',vectorStyle:{v:55}})).toBeNull();
  });
});
