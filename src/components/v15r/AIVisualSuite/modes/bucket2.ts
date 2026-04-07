// @ts-nocheck
/**
 * bucket2.ts — B2 AI V1 draw functions (modes 23-32)
 * B48 — NEXUS Visual Suite Full Deploy
 */

import type { DrawFn } from './bucket1'

// Module-level state for stateful modes
const s25 = { x: 0.1, y: 0, z: 0, trail: [] as [number,number,number][] }
const s27 = { cells: null as Uint8Array|null, history: [] as Uint8Array[], lastT: 0, gW: 0 }
const s29 = { u: null as Float32Array|null, v: null as Float32Array|null, gW: 0, gH: 0, lastF: -1, lastK: -1 }
const s30 = { particles: null as {x:number,y:number,age:number}[]|null }
const s31 = { trace: [] as [number,number][] }
const s32 = { zoom: 0.5 }
const s33 = { x: 0.1, y: 0, trail: [] as [number,number][] }

/**
 * drawQuantumFoam (mode 23 — NEXUS default)
 */
export function drawQuantumFoam(ctx,W,H,t,B,M,Hi,bh,mtz){
  ctx.fillStyle='rgba(2,4,12,0.18)';ctx.fillRect(0,0,W,H)
  const cx=W/2,cy=H/2,R=Math.min(W,H)*0.42
  const bCount=60+Math.round(B*60+mtz*80)
  for(let i=0;i<bCount;i++){
    const seed=i*1.618+t*(0.08+B*0.18)
    const theta=seed*2.399963,phi=Math.acos(1-2*(i+0.5)/bCount)
    const r=R*(0.4+0.6*Math.abs(Math.sin(seed*3.7+t)))
    const x=cx+r*Math.sin(phi)*Math.cos(theta),y=cy+r*Math.sin(phi)*Math.sin(theta)*0.6
    const radius=(2+B*6+M*3)*(0.5+Math.abs(Math.sin(seed*7.1+t*1.3)))
    const alpha=0.08+Hi*0.12+Math.abs(Math.sin(seed*2.3+t*0.7))*0.08
    const hue=(bh+i*0.5+Hi*60)%360
    const g=ctx.createRadialGradient(x,y,0,x,y,radius*2)
    g.addColorStop(0,`hsla(${hue},90%,70%,${alpha})`);g.addColorStop(1,'transparent')
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,radius*2,0,Math.PI*2);ctx.fill()
  }
  if(M>0.05){
    const depth=5+Math.round(M*4)
    for(let d=0;d<depth;d++){
      const phase=t*(0.6+d*0.18)+d,amp=R*0.3*M*(1-d/depth)
      ctx.beginPath()
      for(let j=0;j<=200;j++){
        const a=j/200*Math.PI*2
        const rr=R*0.3+amp*Math.sin(a*(3+d)+phase)*Math.cos(a*(2+d)-phase*0.7)
        const px2=cx+rr*Math.cos(a),py2=cy+rr*Math.sin(a)*0.6
        j===0?ctx.moveTo(px2,py2):ctx.lineTo(px2,py2)
      }
      ctx.closePath();ctx.strokeStyle=`hsla(${(bh+d*25)%360},80%,60%,${0.06+M*0.08})`
      ctx.lineWidth=0.6;ctx.stroke()
    }
  }
  if(mtz>0.15){
    const bursts=Math.round(mtz*8)
    for(let i=0;i<bursts;i++){
      const bx=cx+(Math.random()-0.5)*W*0.8,by=cy+(Math.random()-0.5)*H*0.8
      const bg=ctx.createRadialGradient(bx,by,0,bx,by,6+mtz*8)
      bg.addColorStop(0,`hsla(${bh+180},100%,90%,0.7)`);bg.addColorStop(1,'transparent')
      ctx.fillStyle=bg;ctx.beginPath();ctx.arc(bx,by,6+mtz*8,0,Math.PI*2);ctx.fill()
    }
  }
}

/**
 * drawStrangeAttractor (mode 24 — Lorenz)
 */
export function drawStrangeAttractor(ctx,W,H,t,B,M,Hi,bh,mtz){
  ctx.fillStyle='rgba(2,4,14,0.12)';ctx.fillRect(0,0,W,H)
  const cx=W/2,cy=H/2
  const sigma=10+B*4,rho=28+mtz*12,beta=8/3+M*0.8
  const dt=0.006,steps=4+Math.round(M*6)
  let {x,y,z}=s25
  for(let s=0;s<steps;s++){
    const dx=sigma*(y-x),dy=x*(rho-z)-y,dz=x*y-beta*z
    x+=dx*dt;y+=dy*dt;z+=dz*dt
  }
  s25.x=x;s25.y=y;s25.z=z
  const TRAIL=400+Math.round(M*600+mtz*400)
  s25.trail.push([x,y,z])
  if(s25.trail.length>TRAIL)s25.trail.splice(0,s25.trail.length-TRAIL)
  if(mtz>0.5&&Math.random()<mtz*0.08){s25.x+=(Math.random()-0.5)*10;s25.y+=(Math.random()-0.5)*10}
  const scale=Math.min(W,H)/55
  if(s25.trail.length>1){
    for(let i=1;i<s25.trail.length;i++){
      const [x1,y1,z1]=s25.trail[i-1],[x2,y2,z2]=s25.trail[i]
      const px1=cx+(x1-y1)*scale*0.7,py1=cy-(z1-25)*scale
      const px2=cx+(x2-y2)*scale*0.7,py2=cy-(z2-25)*scale
      const hue=(bh+i*360/TRAIL)%360
      ctx.strokeStyle=`hsla(${hue},80%,60%,${0.3+i/TRAIL*0.7})`
      ctx.lineWidth=0.8;ctx.beginPath();ctx.moveTo(px1,py1);ctx.lineTo(px2,py2);ctx.stroke()
    }
  }
}

/**
 * drawHyperbolicSpace (mode 25 — Poincaré disk)
 */
export function drawHyperbolicSpace(ctx,W,H,t,B,M,Hi,bh,mtz){
  ctx.fillStyle='rgba(0,0,0,0.2)';ctx.fillRect(0,0,W,H)
  const cx=W/2,cy=H/2,R=Math.min(W,H)*0.42
  // boundary
  ctx.strokeStyle=`hsla(${bh},50%,40%,0.5)`;ctx.lineWidth=1
  ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);ctx.stroke()
  const geodesics=20+Math.round(mtz*20)
  for(let i=0;i<geodesics;i++){
    const angle=i/geodesics*Math.PI+t*0.04
    const a=R*Math.cos(angle),b_=R*Math.sin(angle)
    // geodesic as arc perpendicular to boundary
    const d2=a*a+b_*b_
    if(d2<1)continue
    const r2=d2-R*R,gcx=cx+a*(R*R/d2),gcy=cy+b_*(R*R/d2)
    const gr=Math.sqrt(Math.abs(R*R-Math.abs(a*a+b_*b_-R*R)))
    if(gr<1||gr>R*3)continue
    ctx.strokeStyle=`hsla(${(bh+i*13)%360},70%,55%,${0.3+M*0.2})`
    ctx.lineWidth=0.8
    ctx.save()
    ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);ctx.clip()
    ctx.beginPath();ctx.arc(gcx,gcy,gr,0,Math.PI*2);ctx.stroke()
    ctx.restore()
  }
  // deeper tessellation
  if(mtz>0.4){
    for(let i=0;i<Math.round(mtz*30);i++){
      const r=R*Math.random()*0.8,a2=Math.random()*Math.PI*2
      const px=cx+r*Math.cos(a2),py=cy+r*Math.sin(a2),gr2=R*0.1+Math.random()*R*0.2
      ctx.strokeStyle=`hsla(${(bh+i*7)%360},60%,50%,0.2)`;ctx.lineWidth=0.5
      ctx.save();ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);ctx.clip()
      ctx.beginPath();ctx.arc(px,py,gr2,0,Math.PI*2);ctx.stroke();ctx.restore()
    }
  }
}

/**
 * drawCellularAutomata (mode 26 — Rule 110)
 */
export function drawCellularAutomata(ctx,W,H,t,B,M,Hi,bh,mtz){
  const cellSize=3,gW=Math.floor(W/cellSize)
  if(s27.gW!==gW||!s27.cells){
    s27.gW=gW;s27.cells=new Uint8Array(gW);s27.history=[];s27.lastT=0
    s27.cells[Math.floor(gW/2)]=1
  }
  const rule=[0,1,1,1,0,1,1,0] // Rule 110
  const speed=Math.max(0.01,0.08-mtz*0.06)
  if(t-s27.lastT>speed){
    s27.lastT=t
    const next=new Uint8Array(gW)
    for(let i=0;i<gW;i++){
      const l=s27.cells[(i-1+gW)%gW],c=s27.cells[i],r=s27.cells[(i+1)%gW]
      next[i]=rule[l*4+c*2+r]
    }
    s27.cells=next
    s27.history.unshift(next.slice())
    const maxRows=Math.floor(H/cellSize)+Math.round(mtz*20)
    if(s27.history.length>maxRows)s27.history.length=maxRows
  }
  ctx.fillStyle='#000';ctx.fillRect(0,0,W,H)
  s27.history.forEach((row,ri)=>{
    const y=ri*cellSize
    for(let i=0;i<gW;i++){
      if(row[i]){
        ctx.fillStyle=`hsla(${(bh+ri*2)%360},80%,55%,${1-ri/s27.history.length*0.5})`
        ctx.fillRect(i*cellSize,y,cellSize-1,cellSize-1)
      }
    }
  })
}

/**
 * drawFieldLines (mode 27 — EM field)
 */
export function drawFieldLines(ctx,W,H,t,B,M,Hi,bh,mtz){
  ctx.fillStyle='rgba(0,0,0,0.2)';ctx.fillRect(0,0,W,H)
  const cx=W/2,cy=H/2
  const numCharges=4+Math.round(mtz*4)
  const charges=Array.from({length:numCharges},(_,i)=>{
    const a=t*(0.2+i*0.1)+i*Math.PI*2/numCharges
    const r=Math.min(W,H)*0.25
    return{x:cx+r*Math.cos(a),y:cy+r*Math.sin(a)*0.6,q:i%2?1:-1}
  })
  // draw charges
  charges.forEach(c=>{
    ctx.fillStyle=c.q>0?`hsla(${bh},90%,60%,0.8)`:`hsla(${bh+180},90%,60%,0.8)`
    ctx.beginPath();ctx.arc(c.x,c.y,6+B*4,0,Math.PI*2);ctx.fill()
    ctx.fillStyle='#fff';ctx.font='10px monospace';ctx.textAlign='center';ctx.textBaseline='middle'
    ctx.fillText(c.q>0?'+':'−',c.x,c.y)
  })
  // field lines from positive charges
  const linesPerCharge=8
  charges.filter(c=>c.q>0).forEach(c=>{
    for(let l=0;l<linesPerCharge;l++){
      const startA=l/linesPerCharge*Math.PI*2
      let fx=c.x+Math.cos(startA)*12,fy=c.y+Math.sin(startA)*12
      ctx.beginPath();ctx.moveTo(fx,fy)
      for(let step=0;step<60;step++){
        let ex=0,ey=0
        charges.forEach(ch=>{
          const dx=fx-ch.x,dy=fy-ch.y,d2=dx*dx+dy*dy+1
          ex+=ch.q*dx/d2;ey+=ch.q*dy/d2
        })
        const len=Math.sqrt(ex*ex+ey*ey)+0.001
        fx+=ex/len*6;fy+=ey/len*6
        if(fx<0||fx>W||fy<0||fy>H)break
        ctx.lineTo(fx,fy)
      }
      ctx.strokeStyle=`hsla(${bh},70%,60%,0.5)`;ctx.lineWidth=1;ctx.stroke()
    }
  })
}

/**
 * drawReactionDiffusion (mode 28 — Gray-Scott)
 */
export function drawReactionDiffusion(ctx,W,H,t,B,M,Hi,bh,mtz){
  const gW=Math.floor(W/3),gH=Math.floor(H/3),cs=3
  if(s29.gW!==gW||s29.gH!==gH||!s29.u){
    s29.gW=gW;s29.gH=gH
    s29.u=new Float32Array(gW*gH).fill(1)
    s29.v=new Float32Array(gW*gH)
    // seed center
    for(let py=gH/2-5;py<gH/2+5;py++)for(let px=gW/2-5;px<gW/2+5;px++){s29.u[py*gW+px]=0.5;s29.v[py*gW+px]=0.25}
  }
  const F=0.055+mtz*0.02,k=0.062+mtz*0.005
  const Du=0.16,Dv=0.08
  const u=s29.u!,v=s29.v!,nu=new Float32Array(gW*gH),nv=new Float32Array(gW*gH)
  for(let iter=0;iter<3;iter++){
    for(let py=1;py<gH-1;py++)for(let px=1;px<gW-1;px++){
      const i=py*gW+px
      const lu=u[i-1]+u[i+1]+u[i-gW]+u[i+gW]-4*u[i]
      const lv=v[i-1]+v[i+1]+v[i-gW]+v[i+gW]-4*v[i]
      const uvv=u[i]*v[i]*v[i]
      nu[i]=u[i]+Du*lu-uvv+F*(1-u[i])
      nv[i]=v[i]+Dv*lv+uvv-(F+k)*v[i]
      nu[i]=Math.max(0,Math.min(1,nu[i]));nv[i]=Math.max(0,Math.min(1,nv[i]))
    }
    nu.set(s29.u!);nv.set(s29.v!)
  }
  s29.u!.set(nu);s29.v!.set(nv)
  for(let py=0;py<gH;py++)for(let px=0;px<gW;px++){
    const cv=s29.v![py*gW+px]
    ctx.fillStyle=`hsla(${(bh+cv*120)%360},90%,${30+cv*40}%,1)`
    ctx.fillRect(px*cs,py*cs,cs,cs)
  }
}

/**
 * drawFlowField (mode 29 — curl noise)
 */
export function drawFlowField(ctx,W,H,t,B,M,Hi,bh,mtz){
  const pCount=2500+Math.round(mtz*1000)
  if(!s30.particles){
    s30.particles=Array.from({length:pCount},()=>({x:Math.random()*W,y:Math.random()*H,age:Math.random()*100}))
  }
  while(s30.particles.length<pCount)s30.particles.push({x:Math.random()*W,y:Math.random()*H,age:0})
  ctx.fillStyle='rgba(0,0,0,0.06)';ctx.fillRect(0,0,W,H)
  const speed=1.5+mtz*2
  s30.particles.forEach(p=>{
    const nx=p.x/W*3+t*0.1,ny=p.y/H*3
    const angle=Math.sin(nx)*Math.cos(ny)*Math.PI*2+Math.sin(nx*2+1)*Math.PI
    const ox=p.x,oy=p.y
    p.x+=Math.cos(angle)*speed;p.y+=Math.sin(angle)*speed;p.age++
    if(p.x<0||p.x>W||p.y<0||p.y>H||p.age>100+mtz*100){p.x=Math.random()*W;p.y=Math.random()*H;p.age=0}
    ctx.strokeStyle=`hsla(${(bh+p.age*2)%360},70%,55%,0.5)`;ctx.lineWidth=1
    ctx.beginPath();ctx.moveTo(ox,oy);ctx.lineTo(p.x,p.y);ctx.stroke()
  })
}

/**
 * drawFourierEpicycles (mode 30)
 */
export function drawFourierEpicycles(ctx,W,H,t,B,M,Hi,bh,mtz){
  ctx.fillStyle='rgba(0,0,0,0.05)';ctx.fillRect(0,0,W,H)
  const cx=W/2,cy=H/2,N=5+Math.round(mtz*15)
  let x=cx,y=cy
  for(let i=0;i<N;i++){
    const n=2*i+1,A=Math.min(W,H)*0.3/(n*1.2)
    const angle=n*t
    const nx2=x+A*Math.cos(angle),ny2=y+A*Math.sin(angle)
    ctx.strokeStyle=`hsla(${(bh+i*20)%360},60%,50%,0.3)`;ctx.lineWidth=0.8
    ctx.beginPath();ctx.arc(x,y,A,0,Math.PI*2);ctx.stroke()
    ctx.strokeStyle=`hsla(${(bh+i*20)%360},90%,70%,0.7)`;ctx.lineWidth=1.2
    ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(nx2,ny2);ctx.stroke()
    x=nx2;y=ny2
  }
  s31.trace.push([x,y])
  if(s31.trace.length>300)s31.trace.shift()
  if(s31.trace.length>1){
    ctx.strokeStyle=`hsla(${bh},90%,70%,0.8)`;ctx.lineWidth=1.5
    ctx.beginPath();s31.trace.forEach(([tx,ty],i)=>i===0?ctx.moveTo(tx,ty):ctx.lineTo(tx,ty));ctx.stroke()
  }
}

/**
 * drawMandelbrot (mode 31)
 */
export function drawMandelbrot(ctx,W,H,t,B,M,Hi,bh,mtz){
  const gW=120,gH=67,cs=W/gW
  const zoom=0.5*Math.pow(1.5,t*0.3+mtz*t*0.2)
  const tcx=-0.7453,tcy=0.1127
  const maxIter=60+Math.round(mtz*40)
  for(let py=0;py<gH;py++){
    for(let px=0;px<gW;px++){
      const cr=tcx+(px/gW-0.5)*4/zoom,ci=tcy+(py/gH-0.5)*4/zoom
      let zr=0,zi=0,iter=0
      while(zr*zr+zi*zi<4&&iter<maxIter){const nzr=zr*zr-zi*zi+cr;zi=2*zr*zi+ci;zr=nzr;iter++}
      if(iter<maxIter){
        const smooth=iter+1-Math.log2(Math.log2(zr*zr+zi*zi))
        ctx.fillStyle=`hsla(${(bh+smooth*5)%360},90%,${30+smooth*0.5}%,1)`
      } else ctx.fillStyle='#000'
      ctx.fillRect(Math.floor(px*cs),Math.floor(py*(H/gH)),Math.ceil(cs)+1,Math.ceil(H/gH)+1)
    }
  }
}

/**
 * drawTopologyMorph (mode 32 — torus->Klein)
 */
export function drawTopologyMorph(ctx,W,H,t,B,M,Hi,bh,mtz){
  ctx.fillStyle='rgba(0,0,0,0.12)';ctx.fillRect(0,0,W,H)
  const cx=W/2,cy=H/2
  const morph=(Math.sin(t*(0.2+mtz*0.3))*0.5+0.5)
  const R=Math.min(W,H)*0.18,r=R*0.45
  const segs=24,rx=t*0.2,ry=t*0.15
  function project(x:number,y:number,z:number){
    const x1=x*Math.cos(ry)-z*Math.sin(ry)
    const z1=x*Math.sin(ry)+z*Math.cos(ry)
    const y1=y*Math.cos(rx)-z1*Math.sin(rx)
    return{px:cx+x1*Math.min(W,H)*0.35,py:cy+y1*Math.min(W,H)*0.35}
  }
  for(let ui=0;ui<segs;ui++){
    ctx.beginPath()
    for(let vi=0;vi<=segs;vi++){
      const u=ui/segs*Math.PI*2,v=vi/segs*Math.PI*2
      const tv=v+morph*Math.PI
      const x=(R+r*Math.cos(tv))*Math.cos(u)
      const y=(R+r*Math.cos(tv))*Math.sin(u)*(1-morph*0.5)+r*Math.sin(tv)*morph*0.5
      const z=r*Math.sin(tv)*(1-morph)+r*Math.sin(v)*morph
      const p=project(x,y,z)
      vi===0?ctx.moveTo(p.px,p.py):ctx.lineTo(p.px,p.py)
    }
    ctx.strokeStyle=`hsla(${(bh+ui*15)%360},80%,55%,0.5)`;ctx.lineWidth=0.8;ctx.stroke()
  }
}

/**
 * Registry of all draw functions (modes 23-32)
 */
export const B2_DRAWS: DrawFn[] = [
  drawQuantumFoam, drawStrangeAttractor, drawHyperbolicSpace, drawCellularAutomata,
  drawFieldLines, drawReactionDiffusion, drawFlowField, drawFourierEpicycles,
  drawMandelbrot, drawTopologyMorph,
]
