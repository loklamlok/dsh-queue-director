/**
 * dsh-queue-director — host half.
 *
 * 只做一件宿主侧必须做的事：为「调整排队消息顺序」提供受信任的 HTTP 端点。
 * 排队消息的编辑/删除/立即发送由 DSH 内置 RPC（session.updateQueue）完成，
 * 客户端 UI 直接复用；但内置协议没有"重排"动词，所以本插件通过
 * `agent.inbox.splice`（与内置 updateQueue 同一条持久化通路）实现
 * 上移 / 下移 / 置顶 / 置底。
 *
 * 路由（与 better-sidebar 相同的浏览器信任围栏）：
 *   POST /queue-director/api/reorder
 *     payload: { sessionId, itemId, direction: 'up'|'down'|'top'|'bottom' }
 */

// ---------------------------------------------------------------------------
// 浏览器信任围栏（镜像 dsh-better-sidebar 的 trust-fence，语义一致）
// ---------------------------------------------------------------------------

function header(headers, name) {
	const value = headers[name];
	return typeof value === 'string' ? value : void 0;
}

/** Normalized URL of a Host-header authority, or undefined when unparsable. */
function parseAuthority(authority) {
	try {
		return new URL(`http://${authority}`);
	} catch {
		return;
	}
}

/** Whether a normalized URL hostname names the local loopback authority. */
function isLoopbackHostname(hostname) {
	if (hostname === 'localhost' || hostname === '[::1]') return true;
	const parts = hostname.split('.');
	return parts.length === 4
		&& parts[0] === '127'
		&& parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/** Canonical authority form: hostname, or hostname:port when a port was written. */
function canonicalAuthority(entry, entryUrl) {
	const port = entryUrl.port !== '' ? entryUrl.port : new URL(`https://${entry}`).port;
	return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`;
}

/** Whether the request authority matches a trustedHosts entry (exact or port-less). */
function isTrustedAuthority(hostUrl, trustedHosts) {
	return trustedHosts.some((entry) => {
		const entryUrl = parseAuthority(entry);
		if (entryUrl === void 0) return false;
		return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
			? entryUrl.hostname === hostUrl.hostname
			: entryUrl.host === hostUrl.host;
	});
}

/**
 * Decide whether one queue-director request may reach the plugin routes.
 * @param request - node HTTP request facts (headers).
 * @param trustedHosts - non-loopback authorities this deployment serves.
 */
function isTrustedApiRequest(request, trustedHosts) {
	const host = header(request.headers, 'host');
	if (host === void 0) return false;
	const hostUrl = parseAuthority(host);
	if (hostUrl === void 0) return false;
	if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false;
	if (header(request.headers, 'sec-fetch-site') === 'cross-site') return false;
	const origin = header(request.headers, 'origin');
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// HTTP 小工具
// ---------------------------------------------------------------------------

function writeJson(res, status, body) {
	const data = JSON.stringify(body);
	res.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store'
	});
	res.end(data);
}

function writeOk(res, value) {
	writeJson(res, 200, { ok: true, ...value });
}

function writeError(res, code, message, status = 400) {
	writeJson(res, status, { ok: false, error: { code, message } });
}

function readJsonBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on('data', (chunk) => {
			size += chunk.length;
			if (size > 1_048_576) {
				req.destroy();
				reject(new Error('request body too large'));
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => {
			if (chunks.length === 0) {
				resolve({});
				return;
			}
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
			} catch {
				reject(new Error('invalid JSON body'));
			}
		});
		req.on('error', reject);
	});
}

// ---------------------------------------------------------------------------
// 排队消息重排（唯一需要宿主能力的操作）
// ---------------------------------------------------------------------------

const DIRECTIONS = ['up', 'down', 'top', 'bottom'];

/**
 * 把排队消息移到新位置。两条 splice 与内置 updateQueue 走同一条
 * `agent/inbox/spliced` 持久化通路，客户端快照会自动刷新。
 * @returns {accepted: true} 或 {error: {code, message}}
 */
function reorderInbox(agent, itemId, direction) {
	const targets = [
		['next-turn', agent.inbox.nextTurn],
		['next-step', agent.inbox.nextStep]
	];
	for (const [target, list] of targets) {
		const index = list.findIndex((message) => message.id === itemId);
		if (index === -1) continue;
		const length = list.length;
		let to = index;
		if (direction === 'up') to = index - 1;
		else if (direction === 'down') to = index + 1;
		else if (direction === 'top') to = 0;
		else if (direction === 'bottom') to = length - 1;
		if (to < 0 || to >= length || to === index) return { accepted: true };
		const [moved] = agent.inbox.splice(target, index, 1, []);
		agent.inbox.splice(target, to, 0, [moved]);
		return { accepted: true };
	}
	return {
		error: {
			code: 'queue-item-not-found',
			message: 'queued item is no longer pending'
		}
	};
}

// ---------------------------------------------------------------------------
// 插件主体
// ---------------------------------------------------------------------------

export const name = 'queue-director';

/** 需要的宿主服务：webServer（挂路由）、webRuntime（信任围栏）。agents 改为请求时懒取。 */
export const inject = ['webServer', 'webRuntime'];

/** 供测试使用的重排逻辑（与 apply 共用）。 */
export { reorderInbox };

function buildApi(ctx) {
	return {
		reorder(payload = {}) {
			const { sessionId, itemId, direction } = payload;
			if (typeof sessionId !== 'string' || typeof itemId !== 'string' || !DIRECTIONS.includes(direction)) {
				return { error: { code: 'bad-request', message: 'sessionId, itemId and direction are required' } };
			}
			const agents = ctx.get('agents');
			if (agents === void 0) {
				return { error: { code: 'service-unavailable', message: 'agents service unavailable' } };
			}
			const agent = agents.get(sessionId);
			if (agent === void 0) {
				return {
					error: {
						code: 'session-not-found',
						message: `session "${sessionId}" not found (not attached)`
					}
				};
			}
			return reorderInbox(agent, itemId, direction);
		}
	};
}

export function apply(ctx) {
	const fence = (req) => isTrustedApiRequest(req, ctx.webRuntime.trustedHosts);
	const api = buildApi(ctx);

	ctx.effect(() => ctx.webServer.register({
		kind: 'prefix',
		path: '/queue-director/api',
		handler: async (req, res) => {
			if (!fence(req)) {
				writeError(res, 'forbidden', 'forbidden', 403);
				return;
			}
			if (req.method !== 'POST') {
				writeError(res, 'method-error', 'method not allowed', 405);
				return;
			}
			const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname;
			const method = pathname.startsWith('/queue-director/api/')
				? pathname.slice('/queue-director/api/'.length)
				: void 0;
			if (method === void 0 || method.includes('/')) {
				writeError(res, 'not-found', 'unknown queue-director API method', 404);
				return;
			}
			try {
				const body = await readJsonBody(req);
				const handler = api[method];
				if (handler === void 0) {
					writeError(res, 'not-found', `unknown queue-director API method "${method}"`, 404);
					return;
				}
				const result = handler(body.payload ?? {});
				if (result && result.error) {
					writeError(res, result.error.code, result.error.message, 400);
					return;
				}
				writeOk(res, result);
			} catch (error) {
				writeError(res, 'internal', error instanceof Error ? error.message : String(error), 500);
			}
		}
	}), 'dsh-queue-director: /queue-director/api routes');
}
