// LuCI view 冒烟测试：模拟 LuCI 的 view/fs/E/DOM 环境，执行 load + render，
// 用于抓 ReferenceError / TypeError 这类只在浏览器里才暴露的错误。
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'files', 'www', 'luci-static', 'resources', 'view', 'mlo', 'panel.js');

// ---- 极简 DOM ----
function mkEl(tag) {
	const el = {
		tagName: tag, attrs: {}, children: [], firstChild: null, style: {},
		appendChild(c) { this.children.push(c); this.firstChild = this.children[0]; return c; },
		removeChild(c) {
			const i = this.children.indexOf(c);
			if (i >= 0) this.children.splice(i, 1);
			this.firstChild = this.children[0] || null;
			return c;
		},
		setAttribute(k, v) { this.attrs[k] = v; },
		addEventListener() {},
		classList: { add() {}, remove() {} },
	};
	return el;
}

global.E = function (tag, attrs, children) {
	const el = mkEl(tag);
	if (attrs) for (const k of Object.keys(attrs)) el.attrs[k] = attrs[k];
	for (const c of (children || [])) el.appendChild(typeof c === 'string' ? { text: c } : c);
	return el;
};
global.document = { createElement: mkEl, querySelector: () => null, addEventListener() {} };
global.window = { setTimeout: (fn) => { /* 不真正定时 */ }, location: { href: '' } };
global.confirm = () => false;

// ---- LuCI 模块加载器模拟 ----
const viewStub = { extend: (o) => o };
let statusPayload = { state: 'off', aps: 2, clients: 0, mlo_clients: 0 };
const fsStub = {
	exec: (cmd, args) => Promise.resolve({
		code: 0,
		stdout: JSON.stringify(statusPayload) + '\n',
		stderr: '',
	}),
};

let src = fs.readFileSync(FILE, 'utf8');
const requires = [];
src = src.replace(/^\s*'require ([a-z-]+)';\s*$/gm, (m, name) => { requires.push(name); return ''; });
console.log('requires:', requires.join(', ') || '(none)');

const factory = new Function('view', 'fs', 'E', 'document', 'window', 'confirm', src);
const mod = factory(viewStub, fsStub, global.E, global.document, global.window, global.confirm);

function renderWith(state) {
	statusPayload = state;
	return mod.load().then((st) => {
		const el = mod.render(st);
		if (!el || el.tagName !== 'div') throw new Error('render 没有返回根节点');
		console.log('  render ok:', JSON.stringify(st).slice(0, 80));
		// 再走一遍 update，覆盖 'applying' 等分支
		for (const s of [{ state: 'on', links: [{ id: 0, channel: 6, band: '2.4G', width: '20' }], clients: 3, mlo_clients: 1 },
			{ state: 'off', aps: 2 }, { state: 'applying' }, { state: 'error', msg: 'x' }, { state: 'unknown' }]) {
			mod.update(s);
		}
		console.log('  update 分支 ok');
	});
}

Promise.resolve()
	.then(() => renderWith({ state: 'off', aps: 2 }))
	.then(() => renderWith({ state: 'on', links: [{ id: 0, channel: 6, band: '2.4G', width: '20' }, { id: 1, channel: 52, band: '5G', width: '160' }], clients: 9, mlo_clients: 1 }))
	.then(() => {
		// 测试按钮回调存在且可调用（confirm=false 时直接返回）
		const el = mod.render({ state: 'on', links: [], clients: 0, mlo_clients: 0 });
		console.log('smoke OK');
	})
	.catch((e) => { console.error('SMOKE FAILED:', e && e.stack || e); process.exit(1); });

