import init, * as bindings from './pdfcraft-web-4269ac80f6ecb5ce.js';
const wasm = await init({ module_or_path: './pdfcraft-web-4269ac80f6ecb5ce_bg.wasm' });


window.wasmBindings = bindings;


dispatchEvent(new CustomEvent("TrunkApplicationStarted", {detail: {wasm}}));
