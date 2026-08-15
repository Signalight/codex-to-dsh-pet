/* 验证构建产物 lib/client.js 能在模拟 DSH 加载器下加载、注册、挂载。
 * 前置：先运行 `node build.js` 生成 lib/client.js。 */
'use strict';

function makeEl() {
  return {
    style: { setProperty(k, v) { this[k] = v; }, removeProperty() {} },
    className: '', dataset: {}, listeners: {}, children: null,
    setAttribute() {}, removeAttribute() {},
    appendChild(c) { (this.children ??= []).push(c); },
    remove() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; },
    setPointerCapture() {},
    addEventListener(t, f) { (this.listeners[t] ??= []).push(f); },
  };
}
const createdEls = [];
global.document = {
  createElement: () => { const e = makeEl(); createdEls.push(e); return e; },
  getElementById: () => null,
  head: { appendChild() {} },
};
global.window = { addEventListener() {}, removeEventListener() {}, innerWidth: 1000, innerHeight: 700 };
let rafCb = null;
global.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
global.cancelAnimationFrame = () => {};

let loadedEntry = null;
global.window.__ModuleLoader__ = { load(entry) { loadedEntry = entry; } };

let refStore = [], effectStore = [], refIdx = 0, effectIdx = 0;
const reactStub = {
  useRef(init) { const i = refIdx++; if (!(i in refStore)) refStore[i] = { current: init }; return refStore[i]; },
  useEffect(fn) { effectStore[effectIdx++] = fn; },
  useSyncExternalStore(_s, get) { return get(); },
  createElement(type, props) { return { type, props }; },
};
const req = (id) => { if (id === 'react') return reactStub; throw new Error('unexpected require: ' + id); };

require('./lib/client.js');
if (!loadedEntry) throw new Error('bundle did not register via __ModuleLoader__');
console.log('module id:', loadedEntry.id);
const mod = loadedEntry.factory(req);

// 纯函数
console.log('deriveActivity(tool) ->', mod.deriveActivity({ running: true, runningCalls: [{ name: 'Write' }], pending: [] }), '(expect running)');
console.log('deriveActivity(streaming) ->', mod.deriveActivity({ running: true, runningCalls: [], pending: [] }), '(expect review)');
console.log('deriveActivity(idle) ->', mod.deriveActivity({ running: false, runningCalls: [], pending: [] }), '(expect idle)');

// apply 注册
let registerArgs = null;
const sessionSnap = { running: false, runningCalls: [], partial: null, pending: [] };
const ctx = {
  slots: {
    register(o, c) { registerArgs = { options: o, component: c }; return () => {}; },
    inject(name, cb) { cb(); },
  },
  sessions: {
    currentProvideInfo: {
      getSnapshot: () => ({ hooks: { session: { getSnapshot: () => sessionSnap, subscribe: () => () => {} } } }),
      subscribe: () => () => {},
    },
  },
};
mod.apply(ctx);
if (!registerArgs) throw new Error('apply did not register');
console.log('registered:', registerArgs.options.name, '/', registerArgs.options.id, '/', registerArgs.options.label);

// 挂载（render + mount effect）
function beginRender() { refIdx = 0; effectIdx = 0; effectStore = []; }
function render() {
  beginRender();
  const wrapped = registerArgs.component({ sessions: ctx.sessions });
  return wrapped.type(wrapped.props);
}
const el = render();
console.log('component:', el.type, '/', el.props.className);
const petBefore = createdEls.length;
if (refStore[0]) refStore[0].current = makeEl();
effectStore[0](); effectStore[1](); effectStore[2]();
const petEl = createdEls[petBefore];
console.log('pet mounted:', !!petEl, '| debug handle:', !!global.window.__pet);

console.log('\nVERIFY OK');
