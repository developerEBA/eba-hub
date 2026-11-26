/* eslint-disable @typescript-eslint/no-require-imports -- Run real source with the installed compiler and isolated browser APIs. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..');

test('Tailwind watches only application source, excluding generated snapshots and logs',async()=>{
  const {compile}=require('@tailwindcss/node'),{Scanner}=require('@tailwindcss/oxide');
  const filename=path.join(root,'src/app/globals.css'),sourceRoot=path.join(root,'src');
  const compiler=await compile(fs.readFileSync(filename,'utf8'),{from:filename,base:path.dirname(filename),onDependency(){}});
  assert.equal(compiler.root,null,'Use the explicit @source directive instead of Tailwind auto-detection');
  const scanner=new Scanner({sources:compiler.sources});
  const candidates=scanner.scan();
  const insideSource=filename=>{const relative=path.relative(sourceRoot,path.resolve(filename));return !relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)};
  assert(scanner.files.length>0);assert(scanner.files.every(insideSource));
  assert(scanner.globs.every(glob=>insideSource(glob.base)),'Root context dependencies can restart the HMR feedback loop');
  assert(scanner.files.some(file=>file.endsWith(path.join('src','app','layout.tsx'))));
  const css=compiler.build(candidates);assert(css.includes('.min-h-full'));assert(css.includes('.antialiased'));
});

test('Production Tailwind reset is emitted as valid CSS and sign-in controls keep EBA styles',async()=>{
  const {compile}=require('@tailwindcss/node');
  const filename=path.join(root,'src/app/globals.css');
  const compiler=await compile(fs.readFileSync(filename,'utf8'),{from:filename,base:path.dirname(filename),onDependency(){}});
  const css=compiler.build(['min-h-full','antialiased']);
  assert.doesNotMatch(css,/@media\s+source\(/,'Tailwind source configuration must not wrap the reset in an invalid media query');
  assert.match(css,/@layer\s+base\s*\{/,'Tailwind Preflight base rules must be emitted');
  assert.match(css,/\*,\s*::after,\s*::before,\s*::backdrop,\s*::file-selector-button\s*\{\s*box-sizing:\s*border-box/s,'Tailwind Preflight box sizing reset must be emitted');
  assert.match(css,/a\s*\{\s*color:\s*inherit/s,'Tailwind Preflight must reset link color');
  assert.match(css,/button,\s*input,\s*select,\s*optgroup,\s*textarea,\s*::file-selector-button\s*\{\s*font:\s*inherit/s,'Tailwind Preflight must reset form control typography');
  assert.match(css,/\.eba-access__form input\s*\{[^}]*box-sizing:\s*border-box/s,'Sign-in inputs must use border-box sizing');
  assert.match(css,/\.eba-access__password button\s*\{[^}]*display:\s*inline-flex/s,'Password visibility control must have scoped EBA button styling');
  assert.match(css,/\.eba-access__panel a:visited\s*\{\s*color:\s*var\(--eba-ivory\)/s,'Visited sign-in links must retain the EBA color');
});

function notificationHarness(){
  const filename=path.join(root,'src/app/dashboard/notifications/controls.tsx');
  const compiled=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const timers=new Map(),sources=[];let now=0,nextId=0,effect,cleanup,refreshes=0;
  class Source{
    constructor(url){assert.equal(url,'/dashboard/connect/events');this.listeners=new Map();this.closed=false;sources.push(this)}
    addEventListener(name,callback){this.listeners.set(name,callback)}
    emit(data){if(!this.closed)this.listeners.get('refresh')?.({data})}
    close(){this.closed=true;this.listeners.clear()}
  }
  const runtimeModule={exports:{}};
  const router={refresh(){refreshes++;cleanup();mount()}};
  const sandbox={module:runtimeModule,exports:runtimeModule.exports,EventSource:Source,
    setTimeout(fn,delay){const id=++nextId;timers.set(id,{fn,at:now+delay});return id},clearTimeout(id){timers.delete(id)},
    require(name){if(name==='react')return {useEffect(fn){effect=fn}};if(name==='next/navigation')return {useRouter:()=>router};if(name==='./actions')return {markNotification(){}};if(name==='./notification-chime')return {NotificationChime:()=>null};if(name==='react/jsx-runtime')return {jsx:()=>null};throw Error('Unexpected rendering-test dependency')},
  };
  vm.runInNewContext(compiled,sandbox,{filename});
  function mount(){runtimeModule.exports.NotificationUpdates();cleanup=effect();sources.at(-1).emit('ready')}
  mount();
  return {get refreshes(){return refreshes},get source(){return sources.at(-1)},get timers(){return timers.size},unmount(){cleanup()},tick(ms){const end=now+ms;let runs=0;for(;;){const next=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;if(++runs>100)throw Error('Refresh/remount feedback loop');now=next[1].at;timers.delete(next[0]);next[1].fn()}now=end}};
}
test('An initial realtime handshake never causes a router refresh',()=>{
  const h=notificationHarness();h.tick(5000);assert.equal(h.refreshes,0);assert.equal(h.timers,0);h.unmount();
});
test('Real notification changes debounce once without a refresh/remount loop',()=>{
  const h=notificationHarness();for(let i=0;i<20;i++)h.source.emit('changed');h.tick(149);assert.equal(h.refreshes,0);h.tick(1);assert.equal(h.refreshes,1);h.tick(5000);assert.equal(h.refreshes,1);h.unmount();
});
test('Reconnect catches missed changes and cleanup cancels pending refreshes',()=>{
  const h=notificationHarness();h.source.emit('ready');h.tick(150);assert.equal(h.refreshes,1);h.tick(5000);assert.equal(h.refreshes,1);const source=h.source;source.emit('changed');h.unmount();h.tick(1000);source.emit('changed');h.tick(1000);assert.equal(h.refreshes,1);assert.equal(h.timers,0);
});
