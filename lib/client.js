/**
 * dsh-queue-director — client half（v3：只保留排队消息排序）。
 *
 * 替换内置的排队消息条（conversation.input.dock, id "queue", priority -1 影
 * 内置条目），在保留内置行为（预览 / 行内编辑 / 删除 / 立即发送）的基础上，
 * 为每条排队消息增加排序：↑ / ↓（多消息展开后还有 置顶 / 置底），
 * 通过宿主路由 /queue-director/api/reorder 重排。
 */
window.__ModuleLoader__.load({
	id: 'dsh-queue-director',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		const react = require('react');
		const { useState, useEffect, useMemo } = react;
		const P = require('@deepseek-ai/dsh-client-ui-primitives');
		const {
			Tooltip,
			IconQueueOutline14,
			IconChevronUpOutline14,
			IconChevronDownOutline14,
			IconEditOutline16,
			IconTrashOutline16,
			IconSendOutline14,
			IconCheckOutline16,
			IconCloseOutline16
		} = P;

		// ---------------------------------------------------------------------
		// 样式（沿用 DSH 主题令牌，与内置队列条视觉一致）
		// ---------------------------------------------------------------------
		const CSS_ID = 'dsh-queue-director';
		if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_ID}"]`) === null) {
			const tag = document.createElement('style');
			tag.dataset.plugin = CSS_ID;
			tag.dataset.pluginCss = CSS_ID;
			tag.textContent = `
.qd-dock{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));max-width:calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));margin:0 auto calc(0px - var(--dsh-composer-stack-gap) - 3px);padding:0 var(--dsh-composer-dock-inset);flex:none}
.qd-panel{background:var(--dsw-specific-tip);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border-radius:12px 12px 0 0;width:100%;padding:2px 0;position:relative;overflow:hidden}
.qd-panel:after{border:1px solid var(--dsw-alias-border-l1);border-radius:inherit;content:"";pointer-events:none;border-bottom:none;position:absolute;inset:0}
.qd-header{box-sizing:border-box;width:100%;height:36px;color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;background:0 0;border:none;border-radius:8px;align-items:center;gap:10px;padding:4px 12px;display:flex}
.qd-header:focus-visible{outline:2px solid var(--dsw-alias-label-tertiary);outline-offset:-2px}
.qd-header:disabled{cursor:default}
.qd-lead{color:var(--dsw-alias-label-tertiary);flex:none;place-items:center;display:grid}
.qd-count{min-width:0;font-family:Inter,var(--dsw-font-family);flex:auto;font-size:13px;font-weight:500;line-height:24px}
.qd-chevron{width:14px;height:14px;color:var(--dsw-alias-label-tertiary);flex:none;place-items:center;display:grid}
.qd-list{max-height:180px;margin:0;padding:0;list-style:none;overflow-y:auto}
.qd-row{box-sizing:border-box;border-radius:8px;align-items:center;gap:10px;width:100%;height:36px;padding:4px 5px 4px 12px;display:flex}
.qd-row+.qd-row{box-shadow:inset 0 1px 0 var(--dsw-alias-border-l1)}
.qd-preview,.qd-editor{min-width:0;font:var(--dsw-font-xs-13);font-family:Inter,var(--dsw-font-family);flex:auto}
.qd-preview{color:var(--dsw-alias-label-primary-dimmed);text-overflow:ellipsis;white-space:nowrap;word-break:break-word;overflow:hidden}
.qd-editor{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);height:28px;color:var(--dsw-alias-label-primary);border-radius:6px;outline:none;padding:0 8px}
.qd-editor:focus{border-color:var(--dsw-alias-state-business-primary)}
.qd-actions{flex:none;align-items:center;gap:2px;display:flex}
.qd-action{width:28px;height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:999px;flex:none;place-items:center;padding:0;display:grid}
.qd-action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.qd-action:focus-visible{outline:2px solid var(--dsw-alias-label-tertiary);outline-offset:-2px}
.qd-action:disabled{cursor:default;opacity:.45}
.qd-actionWarn:hover:not(:disabled){color:var(--dsw-alias-state-error-primary)}
.qd-sep{width:1px;height:16px;background:var(--dsw-alias-border-l1);flex:none;margin:0 2px}
.qd-chips{flex:none;align-items:center;gap:2px;display:flex}
.qd-chip{height:22px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover-solid);cursor:pointer;border:none;border-radius:11px;align-items:center;padding:0 8px;font-size:11px;font-weight:500;line-height:22px;display:inline-flex}
.qd-chip:hover:not(:disabled){filter:brightness(1.08)}
.qd-chip:disabled{cursor:default;opacity:.5}`;
			document.head.appendChild(tag);
		}

		// ---------------------------------------------------------------------
		// 文案（zh / en）
		// ---------------------------------------------------------------------
		const NS = 'queueDirector';
		const zh = {
			queueCount: '排队 {n} 条',
			edit: '编辑排队消息',
			editUnsupported: '包含非文本内容，暂不支持编辑',
			save: '保存',
			cancelEdit: '取消编辑',
			remove: '删除排队消息',
			steer: '立即发送',
			steerUnavailable: '任务未在运行，无法立即发送',
			reorderUp: '上移',
			reorderDown: '下移',
			reorderTop: '置顶',
			reorderBottom: '置底',
			reorderFailed: '排序失败：这条消息可能已经开始发送。',
			editFailed: '编辑失败：这条消息可能已经开始发送。',
			removeFailed: '删除失败：这条消息可能已经开始发送。',
			steerFailed: '立即发送失败。'
		};
		const en = {
			queueCount: '{n} queued',
			edit: 'Edit queued message',
			editUnsupported: 'Contains non-text content; editing is not supported',
			save: 'Save',
			cancelEdit: 'Cancel editing',
			remove: 'Remove queued message',
			steer: 'Send now',
			steerUnavailable: 'Task is not running; cannot send now',
			reorderUp: 'Move up',
			reorderDown: 'Move down',
			reorderTop: 'Move to top',
			reorderBottom: 'Move to bottom',
			reorderFailed: 'Reorder failed: this message may have already started sending.',
			editFailed: 'Edit failed: this message may have already started sending.',
			removeFailed: 'Remove failed: this message may have already started sending.',
			steerFailed: 'Send-now failed.'
		};

		let localeService;
		function attachLocale(service) { localeService = service; }
		function activeLocale() {
			return localeService?.getSnapshot?.().active
				?? (typeof navigator !== 'undefined' ? navigator.language : '')
				?? 'en';
		}
		function t(key, params) {
			const dict = activeLocale().toLowerCase().startsWith('zh') ? zh : en;
			let text = dict[key] ?? key;
			if (params !== void 0) {
				for (const [name, value] of Object.entries(params)) {
					text = text.replaceAll(`{${name}}`, String(value));
				}
			}
			return text;
		}

		// ---------------------------------------------------------------------
		// 调用宿主重排端点。
		// ---------------------------------------------------------------------
		async function apiReorder(sessionId, itemId, direction) {
			const res = await fetch('/queue-director/api/reorder', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ payload: { sessionId, itemId, direction } })
			});
			let data = {};
			try { data = await res.json(); } catch { /* ignore */ }
			if (!res.ok || data.ok !== true) {
				throw new Error(data?.error?.message ?? `reorder failed (${res.status})`);
			}
		}

		// ---------------------------------------------------------------------
		// 主组件：排队消息条（内置行为 + ↑↓ / 置顶 / 置底 排序）
		// ---------------------------------------------------------------------
		function QueueDirectorDock(props) {
			const { useSession, updateQueue, reorder, notify, t } = props;

			const inbox = useSession((s) => s.queue);
			const queue = useMemo(() => inbox.filter((row) => row.placement === 'queued'), [inbox]);
			const running = useSession((s) => s.running);
			const queueMutable = useSession((s) => s.subagent === null);

			const [editing, setEditing] = useState(null);
			const [busy, setBusy] = useState(null);
			const [collapsed, setCollapsed] = useState(true);

			useEffect(() => {
				if (queue.length === 0 && !collapsed) setCollapsed(true);
				if (editing !== null && (!queueMutable || !queue.some((row) => row.id === editing.id))) setEditing(null);
			}, [collapsed, editing, queue, queueMutable]);

			if (queue.length === 0) return null;

			const interactionActive = queueMutable && (editing !== null || busy !== null);
			const expanded = !collapsed || interactionActive;
			const listVisible = queue.length === 1 || expanded;

			const applyQueueAction = async (itemId, action, failureKey) => {
				setBusy(itemId);
				try {
					await updateQueue(itemId, action);
					return true;
				} catch {
					notify('error', t(failureKey));
					return false;
				} finally {
					setBusy((current) => (current === itemId ? null : current));
				}
			};

			const saveQueueEdit = async () => {
				if (editing === null || editing.text.trim() === '') return;
				if (await applyQueueAction(editing.id, {
					kind: 'edit',
					content: [{ type: 'text', text: editing.text }]
				}, 'editFailed')) setEditing(null);
			};

			const applyReorder = async (itemId, direction) => {
				setBusy(itemId);
				try {
					await reorder(itemId, direction);
				} catch {
					notify('error', t('reorderFailed'));
				} finally {
					setBusy((current) => (current === itemId ? null : current));
				}
			};

			const iconBtn = (label, disabled, onClick, Icon, extra) =>
				react.createElement(Tooltip, {
					label,
					side: 'bottom',
					delayMs: 500,
					disabled,
					children: react.createElement('button', {
						type: 'button',
						className: `qd-action${extra || ''}`,
						'aria-label': label,
						disabled,
						onClick
					}, react.createElement(Icon, { size: 14 }))
				});

			const queueRows = queue.map((row, index) => {
				const canUp = queueMutable && index > 0 && busy === null;
				const canDown = queueMutable && index < queue.length - 1 && busy === null;
				const canTop = queueMutable && index > 0 && busy === null;
				const canBottom = queueMutable && index < queue.length - 1 && busy === null;
				const actions = [];
				if (queueMutable) {
					actions.push(iconBtn(t('reorderUp'), !canUp, () => applyReorder(row.id, 'up'), IconChevronUpOutline14));
					actions.push(iconBtn(t('reorderDown'), !canDown, () => applyReorder(row.id, 'down'), IconChevronDownOutline14));
					actions.push(react.createElement('span', { className: 'qd-sep' }));
				}
				if (editing?.id === row.id) {
					actions.push(iconBtn(t('save'), busy !== null || editing.text.trim() === '', () => { saveQueueEdit(); }, IconCheckOutline16));
					actions.push(iconBtn(t('cancelEdit'), busy !== null, () => setEditing(null), IconCloseOutline16));
				} else if (queueMutable) {
					actions.push(iconBtn(t('edit'), busy !== null || row.text === null, () => {
						if (row.text !== null) setEditing({ id: row.id, text: row.text });
					}, IconEditOutline16));
					actions.push(iconBtn(t('remove'), busy !== null, () => applyQueueAction(row.id, { kind: 'remove' }, 'removeFailed'), IconTrashOutline16, ' qd-actionWarn'));
					actions.push(iconBtn(t('steer'), busy !== null || !running, () => applyQueueAction(row.id, { kind: 'steer' }, 'steerFailed'), IconSendOutline14));
				}
				const chips = [];
				if (expanded && queueMutable) {
					chips.push(react.createElement('button', {
						type: 'button',
						key: 'top',
						className: 'qd-chip',
						disabled: !canTop,
						onClick: () => applyReorder(row.id, 'top')
					}, t('reorderTop')));
					chips.push(react.createElement('button', {
						type: 'button',
						key: 'bottom',
						className: 'qd-chip',
						disabled: !canBottom,
						onClick: () => applyReorder(row.id, 'bottom')
					}, t('reorderBottom')));
				}
				return react.createElement('li', { className: 'qd-row', key: row.id },
					queue.length === 1 && react.createElement('span', { className: 'qd-lead', 'aria-hidden': true },
						react.createElement(IconQueueOutline14, {})),
					editing?.id === row.id
						? react.createElement('input', {
							autoFocus: true,
							className: 'qd-editor',
							'aria-label': t('edit'),
							value: editing.text,
							onChange: (event) => setEditing({ id: row.id, text: event.currentTarget.value }),
							onKeyDown: (event) => {
								if (event.key === 'Escape') { setEditing(null); return; }
								if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
									event.preventDefault();
									saveQueueEdit();
								}
							}
						})
						: react.createElement('span', { className: 'qd-preview', title: row.text ?? void 0 }, row.preview),
					chips.length > 0 && react.createElement('span', { className: 'qd-chips' }, ...chips),
					queueMutable && react.createElement('div', { className: 'qd-actions' }, ...actions)
				);
			});

			return react.createElement('div', { className: 'qd-dock', 'data-queue-dock': '' },
				react.createElement('div', { className: 'qd-panel' },
					queue.length > 1 && react.createElement('button', {
						type: 'button',
						className: 'qd-header',
						'aria-expanded': expanded,
						disabled: interactionActive,
						onClick: () => setCollapsed((value) => !value)
					},
						react.createElement('span', { className: 'qd-lead', 'aria-hidden': true },
							react.createElement(IconQueueOutline14, {})),
						react.createElement('span', { className: 'qd-count' }, t('queueCount', { n: queue.length })),
						react.createElement('span', { className: 'qd-chevron', 'aria-hidden': true },
							react.createElement(expanded ? IconChevronDownOutline14 : IconChevronUpOutline14, {}))
					),
					react.createElement('ul', { className: 'qd-list', hidden: !listVisible }, ...queueRows)
				)
			);
		}

		// ---------------------------------------------------------------------
		// 插件入口
		// ---------------------------------------------------------------------

		/** 需要的客户端服务：slots（注册 dock）、sessions（取会话作用域）、conversation（改队列）、locale（文案）。 */
		const inject = ['slots', 'sessions', 'conversation', 'locale'];

		function apply(ctx) {
			attachLocale(ctx.locale);
			ctx.effect(() => {
				const offZh = ctx.locale.register(NS, 'zh', zh);
				const offEn = ctx.locale.register(NS, 'en', en);
				return () => { offZh(); offEn(); };
			}, 'dsh-queue-director: dictionaries');

			// 注册队列条：id "queue"（shadow 内置条目）、priority -1（低者渲染）。
			ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
				name: 'conversation.input.dock',
				id: 'queue',
				order: 20,
				priority: -1,
				locale: NS,
				inject: (sessionId) => {
					const actx = ctx.sessions.scope(sessionId);
					if (actx === void 0) throw new Error(`queue-director dock: session "${sessionId}" resolved no scope`);
					const conversation = actx.get('conversation');
					if (conversation === void 0) throw new Error('queue-director dock: conversation service unavailable');
					return {
						updateQueue: (itemId, action) => conversation.updateQueue(itemId, action),
						reorder: (itemId, direction) => apiReorder(sessionId, itemId, direction),
						notify: (level, text) => conversation.input.for(actx).notify(level, text)
					};
				}
			}, QueueDirectorDock));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
