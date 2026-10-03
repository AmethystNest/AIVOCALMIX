// Reproducible DSP quality probes (report only, nothing is asserted):
//  1. aliasing of the sample-domain saturators (sibilance-aware exciter, FX region drive)
//  2. passband gain of the export resampler (44.1 <-> 48 kHz)
// Run: node tools/dsp-quality-report.cjs
(function(){
const fs=require('fs'),vm=require('vm');
const path=require('path');const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const ctx={console,Math,Float32Array,Float64Array,performance,WebAssembly,atob,setTimeout,yieldToBrowser:async()=>{}};
vm.createContext(ctx);
vm.runInContext(read('src/analysis/spectrum-core.js')+'\n'+read('src/dsp/sample-dsp.js')+'\n'+read('src/render/fx-render.js').match(/function saturateSampleForRegion[\s\S]*?\n}\n/)[0]+'\nthis.api={applySibilanceAwareExciter,saturateSampleForRegion,fft:typeof fft!=="undefined"?fft:null,nextPow2};',ctx);
const {applySibilanceAwareExciter,saturateSampleForRegion}=ctx.api;
const N=16384,sr=48000;
function spec(x){ // hann-windowed power spectrum via naive-ish DFT using radix2
  const re=new Float64Array(N),im=new Float64Array(N);
  for(let i=0;i<N;i++)re[i]=x[i]*(0.5-0.5*Math.cos(2*Math.PI*i/N));
  // iterative FFT
  for(let i=1,j=0;i<N;i++){let b=N>>1;for(;j&b;b>>=1)j^=b;j^=b;if(i<j){[re[i],re[j]]=[re[j],re[i]];}}
  for(let len=2;len<=N;len<<=1){const a=-2*Math.PI/len;for(let i=0;i<N;i+=len)for(let k=0;k<len/2;k++){const wr=Math.cos(a*k),wi=Math.sin(a*k);const ur=re[i+k],ui=im[i+k];const vr=re[i+k+len/2]*wr-im[i+k+len/2]*wi,vi=re[i+k+len/2]*wi+im[i+k+len/2]*wr;re[i+k]=ur+vr;im[i+k]=ui+vi;re[i+k+len/2]=ur-vr;im[i+k+len/2]=ui-vi;}}
  const p=new Float64Array(N/2);for(let i=0;i<N/2;i++)p[i]=re[i]*re[i]+im[i]*im[i];return p;}
function report(name,y,m){
  const p=spec(y);let total=0;for(const v of p)total+=v;
  const legit=new Set();for(let n=1;n*m<N/2-3;n+=2)for(let d=-3;d<=3;d++)legit.add(n*m+d);
  let lp=0;for(const b of legit)if(p[b]!==undefined)lp+=p[b];
  let fund=0;for(let d=-3;d<=3;d++)fund+=p[m+d];
  const alias=total-lp;
  console.log(name.padEnd(46),'alias vs fundamental:',(10*Math.log10(Math.max(alias,1e-30)/fund)).toFixed(1),'dB   (harmonics+fund excluded)');
}
const m=1021, f0=m*sr/N; console.log('sine',f0.toFixed(0),'Hz at sr',sr);
const total=N*2; // use 2N then take last N to skip filter warmup
for(const [lvlDb,fHz] of [[-20,12000],[-20,15000],[-12,11000]]){
  const mm=Math.round(fHz*N/sr)|1; // odd-ish bin
  const x=new Float32Array(total);const A=Math.pow(10,lvlDb/20);
  for(let i=0;i<total;i++)x[i]=A*Math.sin(2*Math.PI*mm*i/N);
  const y=applySibilanceAwareExciter(x,sr,{});
  const diff=new Float32Array(N);for(let i=0;i<N;i++)diff[i]=y[N+i]-x[N+i]; // exciter contribution only
  const xx=y.slice(N);
  report(`exciter default, ${lvlDb} dBFS ${fHz} Hz (added part)`,diff,mm);
}
for(const amt of [0.3,0.6,1.0]){
  const mm=1021;const x=new Float32Array(N);for(let i=0;i<N;i++)x[i]=0.5*Math.sin(2*Math.PI*mm*i/N);
  const y=new Float32Array(N);for(let i=0;i<N;i++)y[i]=saturateSampleForRegion(x[i],amt,false);
  report(`region drive amt=${amt}, 0.5 FS ${(mm*sr/N/1000).toFixed(2)} kHz`,y,mm);
}

})();
(function(){
const fs=require('fs'),vm=require('vm');
const path=require('path');const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
function mkBuf(ch,len,sr){const d=Array.from({length:ch},()=>new Float32Array(len));return {numberOfChannels:ch,length:len,sampleRate:sr,duration:len/sr,getChannelData:i=>d[i]};}
const ctx={console,Math,Float32Array,Float64Array,Map,WebAssembly,atob,performance,setTimeout,yieldToBrowser:async()=>{},audioCtx:{createBuffer:mkBuf},state:{}};
vm.createContext(ctx);
vm.runInContext(read('src/dsp/sample-dsp.js').match(/function vmDecodeBase64Bytes[\s\S]*?\n}\n\nfunction vmWasmGlobalNumber[\s\S]*?\n}\n/)[0]+'\n'+read('src/audio/hq-resampler.js')+'\nthis.api={resampleHighQualityForExport};',ctx);
const {resampleHighQualityForExport}=ctx.api;
const N=16384;
function pspec(x,off){const re=new Float64Array(N),im=new Float64Array(N);for(let i=0;i<N;i++)re[i]=x[off+i]*(0.5-0.5*Math.cos(2*Math.PI*i/N));
 for(let i=1,j=0;i<N;i++){let b=N>>1;for(;j&b;b>>=1)j^=b;j^=b;if(i<j){[re[i],re[j]]=[re[j],re[i]];}}
 for(let len=2;len<=N;len<<=1){const a=-2*Math.PI/len;for(let i=0;i<N;i+=len)for(let k=0;k<len/2;k++){const wr=Math.cos(a*k),wi=Math.sin(a*k);const ur=re[i+k],ui=im[i+k];const vr=re[i+k+len/2]*wr-im[i+k+len/2]*wi,vi=re[i+k+len/2]*wi+im[i+k+len/2]*wr;re[i+k]=ur+vr;im[i+k]=ui+vi;re[i+k+len/2]=ur-vr;im[i+k+len/2]=ui-vi;}}
 const p=new Float64Array(N/2);for(let i=0;i<N/2;i++)p[i]=re[i]*re[i]+im[i]*im[i];return p;}
(async()=>{
 for(const [src,dst] of [[44100,48000],[48000,44100]]){
  for(const f of [1000,10000,16000,18000,19500,20500]){
   if(f>=Math.min(src,dst)/2) continue;
   const len=src*2,b=mkBuf(1,len,src),x=b.getChannelData(0);
   for(let i=0;i<len;i++)x[i]=0.5*Math.sin(2*Math.PI*f*i/src);
   const o=await resampleHighQualityForExport(b,dst);
   const y=o.getChannelData(0);const off=Math.floor(y.length/2)-N/2;
   // measure amplitude by lock-in at f and residual power
   let sr_=0,si=0,ptot=0;for(let i=0;i<N;i++){const t=(off+i)/dst;const c=Math.cos(2*Math.PI*f*t),s=Math.sin(2*Math.PI*f*t);sr_+=y[off+i]*c;si+=y[off+i]*s;ptot+=y[off+i]*y[off+i];}
   const amp=2*Math.hypot(sr_,si)/N; const fundP=amp*amp/2*N; const resid=Math.max(ptot-fundP,1e-30);
   console.log(`${src}->${dst} ${String(f).padStart(5)} Hz  gain ${(20*Math.log10(amp/0.5)).toFixed(4)} dB`);
  }}
})();

})();
