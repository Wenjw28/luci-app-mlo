// SPDX-License-Identifier: GPL-2.0-only
'use strict';
'require view';
'require fs';

var BIN = '/usr/bin/mlo-toggle';

function parseJson(out) {
	try {
		return JSON.parse((out || '').trim());
	} catch (e) {
		return { state: 'unknown', msg: (out || '').trim() };
	}
}

function callStatus() {
	return fs.exec(BIN, [ 'status' ]).then(function(res) {
		return parseJson(res.stdout);
	}).catch(function() {
		return { state: 'unknown' };
	});
}

function callAction(cmd) {
	return fs.exec(BIN, [ cmd || 'toggle' ]).then(function(res) {
		return parseJson(res.stdout);
	}).catch(function(err) {
		return { state: 'error', msg: String(err) };
	});
}

return view.extend({
	load: function() {
		return callStatus();
	},

	render: function(st) {
		var self = this;

		this.statusEl = E('div', {});
		this.btnEl = E('div', { 'class': 'cbi-page-actions', 'style': 'margin-top:12px' });
		this.noteEl = E('p', { 'class': 'cbi-section-descr', 'style': 'margin-top:8px' });

		this.update(st);

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [ 'MLO 多链路聚合' ]),
			E('div', { 'class': 'cbi-map-descr' }, [
				'Wi-Fi 7 的 MLO 让 2.4G 与 5G 同时为一个客户端收发数据（双链路聚合）。',
				'开启后后台「网络 → 无线」只会显示一个 ap-mld0、5G 那行显示 “?”，属正常现象。'
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [ '当前状态' ]),
				this.statusEl,
				this.noteEl
			]),
			this.btnEl
		]);
	},

	row: function(label, value) {
		return E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, [ label ]),
			E('div', { 'class': 'cbi-value-field' }, [ value ])
		]);
	},

	badge: function(text, ok) {
		return E('span', {
			'style': 'display:inline-block;padding:2px 10px;border-radius:10px;font-weight:600;' +
				(ok ? 'background:#1f7a3d;color:#fff' : 'background:#7a1f1f;color:#fff')
		}, [ text ]);
	},

	update: function(st) {
		var self = this;
		var state = st.state || 'unknown';
		var on = (state === 'on');

		while (this.statusEl.firstChild)
			this.statusEl.removeChild(this.statusEl.firstChild);

		this.statusEl.appendChild(this.row('MLO', on
			? this.badge('已开启（多链路）', true)
			: (state === 'off' ? this.badge('已关闭（2.4G / 5G 独立）', false)
				: (state === 'applying' ? this.badge('正在应用…', true)
					: this.badge(state === 'error' ? '出错' : '未知', false)))));

		if (on) {
			var links = st.links || [];
			var txt = links.map(function(l) {
				return l.band + ' ch' + l.channel + (l.width ? ' / ' + l.width : '');
			}).join('   +   ');
			this.statusEl.appendChild(this.row('链路', txt || '—'));
			this.statusEl.appendChild(this.row('在线客户端', String(st.clients || 0)));
			this.statusEl.appendChild(this.row('其中 MLO 客户端', String(st.mlo_clients || 0)));
		}
		else if (state === 'off') {
			this.statusEl.appendChild(this.row('独立 AP 数量', String(st.aps || 0)));
		}

		if (st.msg)
			this.noteEl.appendChild(E('span', {}, [ st.msg ]));

		while (this.btnEl.firstChild)
			this.btnEl.removeChild(this.btnEl.firstChild);

		if (state === 'applying') {
			this.btnEl.appendChild(E('span', { 'class': 'spinning' }, [ ' 正在重启无线，请稍候…' ]));
			return;
		}

		this.btnEl.appendChild(E('button', {
			'class': 'cbi-button cbi-button-' + (on ? 'negative' : 'positive'),
			'click': function() { self.toggle(on); }
		}, [ on ? '关闭 MLO（恢复 2.4G / 5G 两个 AP）' : '开启 MLO（2.4G + 5G 双链路）' ]));

		this.btnEl.appendChild(E('button', {
			'class': 'cbi-button cbi-button-neutral',
			'style': 'margin-left:8px',
			'click': function() { self.refresh(); }
		}, [ '刷新状态' ]));

		this.btnEl.appendChild(E('button', {
			'class': 'cbi-button cbi-button-reset',
			'style': 'margin-left:8px',
			'click': function() { self.factoryReset(); }
		}, [ '恢复插件安装前的配置' ]));
	},

	refresh: function() {
		var self = this;
		return callStatus().then(function(st) { self.update(st); });
	},

	factoryReset: function() {
		var self = this;
		var msg = '把无线配置恢复成「插件安装前」的那一份快照。\n\n' +
			'· 当前 MLO / 拆分的 AP 设置会被覆盖\n' +
			'· 你后来改的 SSID / 密码也会被回退\n' +
			'· 无线会重启，设备断线约 20~40 秒\n\n确定继续？';

		if (!confirm(msg))
			return;

		this.update({ state: 'applying', msg: '正在恢复安装前配置…' });

		return callAction('factory').then(function(res) {
			if (res.state === 'error' || res.state === 'unknown') {
				self.update(res);
				return;
			}
			self.waitDone(0);
		});
	},

	toggle: function(wasOn) {
		var self = this;
		var msg = wasOn
			? '关闭 MLO 会把无线拆回 2.4G / 5G 两个独立 AP，所有设备会短暂断线重连（约 20~40 秒）。继续？'
			: '开启 MLO 会重启无线，所有设备短暂断线重连（约 20~40 秒）。继续？';

		if (!confirm(msg))
			return;

		this.update({ state: 'applying', msg: '已提交，等待无线重启…' });

		return callAction().then(function(res) {
			if (res.state === 'error') {
				self.update(res);
				return;
			}
			self.waitDone(0);
		});
	},

	waitDone: function(n) {
		var self = this;
		if (n > 40) {
			self.update({ state: 'unknown', msg: '等待超时，请点“刷新状态”查看结果。' });
			return;
		}
		window.setTimeout(function() {
			callStatus().then(function(st) {
				if (st.state === 'applying' || st.state === 'unknown')
					self.waitDone(n + 1);
				else
					self.update(st);
			});
		}, 3000);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
