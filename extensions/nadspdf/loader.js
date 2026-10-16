import init, * as bindings from './pdfcraft-web-88ad1155dc8ac59d.js';
const wasm = await init({ module_or_path: './pdfcraft-web-88ad1155dc8ac59d_bg.wasm' });


window.wasmBindings = bindings;


dispatchEvent(new CustomEvent("TrunkApplicationStarted", {detail: {wasm}}));
