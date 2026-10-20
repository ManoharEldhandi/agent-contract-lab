const byId = (id) => document.getElementById(id);
const tools = [
	'file.read',
	'file.write',
	'command',
	'model.call',
	'knowledge.search',
];
const format = new Intl.NumberFormat('en', {
	notation: 'compact',
	maximumFractionDigits: 1,
});
let state;
let mode = 'fixture';
let selected;
let rows = [];
let revision = '';
let editorInitialized = false;
let refreshing = false;
let pending = 0;
let toastTimer;

function icons() {
	globalThis.lucide?.createIcons();
}
function node(tag, className, text) {
	const element = document.createElement(tag);
	if (className) element.className = className;
	if (text !== undefined) element.textContent = text;
	return element;
}
function icon(name) {
	const element = node('i');
	element.dataset.lucide = name;
	return element;
}
function clock(milliseconds) {
	const seconds = Math.max(0, Math.floor(milliseconds / 1000));
	return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function toast(message, error = false) {
	clearTimeout(toastTimer);
	const element = byId('toast');
	element.textContent = message;
	element.className = error ? 'toast error' : 'toast';
	element.hidden = false;
	toastTimer = setTimeout(() => {
		element.hidden = true;
	}, 5000);
}

async function api(path, body) {
	const response = await fetch(`/api/${path}`, {
		method: body === undefined ? 'GET' : 'POST',
		cache: 'no-store',
		...(body === undefined
			? {}
			: {
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body),
				}),
	});
	const value = await response.json();
	if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
	return value;
}

async function command(operation) {
	pending += 1;
	renderButtons();
	try {
		await operation();
		await refresh();
	} catch (error) {
		toast(error.message, true);
	} finally {
		pending -= 1;
		renderButtons();
	}
}

function setView(view) {
	for (const button of document.querySelectorAll('[data-view]')) {
		button.classList.toggle('active', button.dataset.view === view);
		if (button.dataset.view === view)
			button.setAttribute('aria-current', 'page');
		else button.removeAttribute('aria-current');
	}
	for (const element of document.querySelectorAll('.view')) {
		const active = element.id === `view-${view}`;
		element.hidden = !active;
		element.classList.toggle('active-view', active);
	}
}

function renderButtons() {
	if (!state) return;
	const busy = state.run.running || pending > 0;
	byId('run-button').disabled = busy;
	byId('stop-button').disabled = !state.run.running;
	byId('reset-button').disabled = busy;
	byId('attempt-button').disabled = busy || state.session.state !== 'running';
	byId('advance-button').disabled = busy || state.session.state !== 'running';
	byId('complete-button').disabled = busy || state.session.state !== 'running';
	byId('model-mode').disabled = !state.model.configured || busy;
	byId('model-mode').title = state.model.configured
		? state.model.name
		: 'No model provider configured';
}

function metric(id, used, limit, progressId) {
	const element = byId(id);
	element.replaceChildren(document.createTextNode(format.format(used)));
	if (limit !== undefined)
		element.append(node('small', '', ` / ${format.format(limit)}`));
	if (progressId) {
		byId(progressId).max = Math.max(1, limit ?? used ?? 1);
		byId(progressId).value = used;
	}
}

function renderRuntime() {
	const runtime = state.runtime;
	const counters = runtime.state;
	const policy = runtime.policy;
	const limits = policy.limits ?? {};
	metric(
		'metric-actions',
		counters.actions,
		limits.maxActions,
		'progress-actions',
	);
	metric(
		'metric-tokens',
		counters.tokensCharged,
		limits.maxTokens,
		'progress-tokens',
	);
	metric(
		'metric-files',
		counters.changedPaths.length,
		limits.maxChangedFiles,
		'progress-files',
	);
	metric(
		'metric-retries',
		Object.values(counters.failures).reduce((total, count) => total + count, 0),
	);
	byId('retry-limit').textContent =
		`${limits.maxRetries ?? 'No'} ${limits.maxRetries === 1 ? 'retry' : 'retries'} / request / revision`;
	byId('reported-tokens').textContent =
		counters.tokensReported > 0
			? `${counters.tokensReported} provider-reported${counters.tokenUsageUnknown ? ' + missing usage' : ''}`
			: 'Provider usage: not reported';
	const finished = state.session.completedAt
		? Date.parse(state.session.completedAt)
		: Date.now();
	const elapsed = Math.max(0, finished - counters.startedAt);
	byId('metric-time').replaceChildren(
		document.createTextNode(clock(elapsed)),
		node(
			'small',
			'',
			` / ${limits.maxDurationMs === undefined ? 'Unbounded' : clock(limits.maxDurationMs)}`,
		),
	);
	byId('progress-time').max = limits.maxDurationMs ?? Math.max(1, elapsed);
	byId('progress-time').value = elapsed;
	byId('current-stage').textContent = runtime.phase ?? 'All tools';
	const workflow = byId('workflow');
	workflow.replaceChildren();
	(policy.phases ?? []).forEach((phase, index) => {
		if (index > 0) workflow.append(icon('chevron-right'));
		const item = node(
			'li',
			index === counters.phaseIndex
				? 'active'
				: index < counters.phaseIndex
					? 'past'
					: '',
		);
		item.append(
			icon(
				index < counters.phaseIndex || state.session.state === 'completed'
					? 'circle-check'
					: index === counters.phaseIndex
						? 'circle-dot'
						: 'circle',
			),
			document.createTextNode(phase.name),
		);
		workflow.append(item);
	});
	const permissions = byId('tool-permissions');
	permissions.replaceChildren();
	const permitted = policy.phases?.[counters.phaseIndex]?.tools ?? tools;
	for (const tool of tools) {
		const row = node('div', 'tool-row');
		const allowed = permitted.includes(tool);
		const status = node('span', `tool-state ${allowed ? 'allowed' : 'denied'}`);
		status.append(
			icon(allowed ? 'check' : 'minus'),
			document.createTextNode(allowed ? 'Stage allowed' : 'Stage blocked'),
		);
		row.append(node('span', '', tool), status);
		permissions.append(row);
	}
	const phase = policy.phases?.[counters.phaseIndex];
	const next =
		phase?.next?.[0] ?? policy.phases?.[counters.phaseIndex + 1]?.name;
	byId('advance-button').replaceChildren(
		icon(
			next === 'edit' && runtime.phase === 'verify' ? 'undo-2' : 'arrow-right',
		),
		document.createTextNode(
			next
				? `${next === 'edit' && runtime.phase === 'verify' ? 'Return to' : 'Advance to'} ${next}`
				: 'No next stage',
		),
	);
	byId('advance-button').dataset.target = next ?? '';
	renderCatalog(policy);
}

function actionRows() {
	return state.events
		.filter(
			(event) =>
				event.kind === 'tool.called' && event.actor === 'supervisor-tools',
		)
		.map((event) => {
			const related = state.events.filter(
				(candidate) => candidate.correlationId === event.correlationId,
			);
			const decision = related.find(
				(candidate) =>
					candidate.kind === 'policy.decision' &&
					candidate.payload.phase === 'pre-action',
			);
			const result = related.find(
				(candidate) => candidate.kind === 'tool.completed',
			);
			const status = result?.payload.blocked
				? 'blocked'
				: result
					? result.payload.success
						? 'completed'
						: 'failed'
					: 'pending';
			const payload = event.payload;
			const target =
				payload.path ??
				(payload.executable
					? [
							payload.executable.split('/').at(-1),
							...(payload.args ?? []),
						].join(' ')
					: (payload.query ?? payload.model ?? ''));
			return { event, related, decision, result, status, target };
		});
}

function inspect(row) {
	selected = row.event.correlationId;
	byId('selected-action').textContent =
		`${row.event.payload.tool}: ${row.target}`;
	byId('decision-detail').textContent = JSON.stringify(
		{
			decision: row.decision?.payload ?? null,
			result: row.result?.payload.result ?? null,
		},
		null,
		2,
	);
	byId('evidence-reference').textContent =
		`Correlation ${row.event.correlationId}\nEvent ${row.event.eventId}`;
	for (const element of byId('timeline-body').children)
		element.classList.toggle(
			'selected',
			element.dataset.correlation === selected,
		);
}

function renderTimeline() {
	const nextRevision = `${state.session.sessionId}:${state.events.at(-1)?.sequence ?? 0}`;
	if (revision === nextRevision) return;
	revision = nextRevision;
	rows = actionRows();
	const body = byId('timeline-body');
	body.replaceChildren();
	for (const row of rows) {
		const element = node(
			'tr',
			selected === row.event.correlationId ? 'selected' : '',
		);
		element.dataset.correlation = row.event.correlationId;
		element.tabIndex = 0;
		element.setAttribute(
			'aria-label',
			`${row.event.payload.tool} ${row.target}, ${row.status}`,
		);
		element.append(
			node(
				'td',
				'',
				new Date(row.event.occurredAt).toLocaleTimeString('en-GB', {
					hour12: false,
				}),
			),
		);
		const action = node('td');
		action.append(
			node('span', 'action-label', row.event.payload.tool),
			node('span', 'action-target', row.target),
		);
		element.append(action);
		const result = node('td');
		const badge = node('span', `result-label ${row.status}`);
		badge.append(
			icon(
				{
					completed: 'check',
					blocked: 'shield-x',
					failed: 'circle-alert',
					pending: 'loader-circle',
				}[row.status],
			),
			document.createTextNode(
				{
					completed: 'Allowed',
					blocked: 'Blocked',
					failed: 'Failed',
					pending: 'Running',
				}[row.status],
			),
		);
		result.append(badge);
		element.append(result);
		element.append(
			node(
				'td',
				'rule-cell',
				row.decision?.payload.ruleIds?.join(', ') || 'Policy passed',
			),
		);
		element.addEventListener('click', () => inspect(row));
		element.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') inspect(row);
		});
		body.append(element);
	}
	byId('timeline-empty').hidden = rows.length > 0;
	byId('timeline-counts').textContent =
		`${rows.length} actions / ${rows.filter((row) => row.status === 'blocked').length} blocked`;
	const current =
		rows.find((row) => row.event.correlationId === selected) ?? rows.at(-1);
	if (current) inspect(current);
	else {
		selected = undefined;
		byId('selected-action').textContent = 'No action selected';
		byId('decision-detail').textContent = '{}';
		byId('evidence-reference').textContent = '';
	}
	const diff = state.events.findLast(
		(event) => event.kind === 'workspace.diff',
	);
	byId('workspace-diff').textContent =
		diff?.payload.diff || 'No final diff retained.';
	byId('diff-status').textContent = diff
		? diff.evidenceGrade
		: 'Pending final snapshot';
}

function renderCatalog(policy) {
	const limits = policy.limits ?? {};
	const controls = [
		['Stage permissions', `${policy.phases?.length ?? 0} phases`],
		[
			'Session / action duration',
			`${clock(limits.maxDurationMs ?? 0)} / ${clock(limits.maxActionDurationMs ?? 0)}`,
		],
		[
			'Token admission',
			limits.maxTokens === undefined
				? 'Unbounded'
				: `${limits.maxTokens} charged tokens`,
		],
		['Retries', `${limits.maxRetries ?? 'Unbounded'} / request / revision`],
		['Total actions', limits.maxActions ?? 'Unbounded'],
		[
			'Per-tool quotas',
			Object.entries(policy.toolQuotas ?? {})
				.map(([tool, count]) => `${tool} ${count}`)
				.join(' / ') || 'Unbounded',
		],
		[
			'Action rate',
			limits.maxActionsPerWindow === undefined
				? 'Unbounded'
				: `${limits.maxActionsPerWindow} / ${(limits.windowMs ?? 60000) / 1000}s`,
		],
		[
			'Failure circuit breaker',
			`${limits.maxConsecutiveFailures ?? 'Unbounded'} consecutive`,
		],
		['Changed-file breadth', limits.maxChangedFiles ?? 'Unbounded'],
		['Aggregate write volume', `${limits.maxWriteBytes ?? 'Unbounded'} bytes`],
		['Tool output cap', `${limits.maxOutputBytes ?? 'Unbounded'} bytes`],
		[
			'Read before write',
			policy.requireReadBeforeWrite ? 'Required' : 'Not required',
		],
		['Model allowlist', policy.allowedModels?.join(', ') ?? 'Unrestricted'],
		[
			'Current-revision verification',
			policy.requireVerificationBeforeComplete ? 'Required' : 'Not required',
		],
	];
	const catalog = byId('control-catalog');
	catalog.replaceChildren();
	for (const [label, value] of controls) {
		const row = node('div', 'control-row');
		row.append(node('span', '', label), node('strong', '', String(value)));
		catalog.append(row);
	}
}

function render() {
	byId('connection-label').textContent = 'Local supervisor';
	byId('connection-dot').style.background = '';
	byId('session-short').textContent = state.session.sessionId.slice(0, 16);
	const status = byId('session-status');
	status.textContent = state.run.running
		? 'Running'
		: state.session.state === 'running'
			? 'Ready'
			: state.session.state;
	status.className = `status-pill ${state.session.state}`;
	byId('active-policy').textContent = state.activeContractName;
	byId('run-error').hidden = !state.run.error;
	byId('run-error').textContent = state.run.error ?? '';
	byId('footer-session').textContent = state.session.sessionId;
	byId('footer-evidence').textContent =
		`${state.events.length} retained events / ${state.run.mode === 'fixture' ? 'Scripted fixture agent' : 'Connected model'}`;
	byId('knowledge-policy').textContent = state.activeContractName;
	if (!editorInitialized) {
		byId('policy-editor').value = state.policyYaml;
		editorInitialized = true;
	}
	renderRuntime();
	renderTimeline();
	renderButtons();
	icons();
}

async function refresh() {
	if (refreshing) return;
	refreshing = true;
	try {
		state = await api('state');
		render();
	} catch (error) {
		byId('connection-label').textContent = 'Disconnected';
		byId('connection-dot').style.background = '#b23d45';
	} finally {
		refreshing = false;
	}
}

function actionFields() {
	const kind = byId('action-kind').value;
	byId('action-content-label').hidden = kind !== 'file.write';
	byId('action-args-label').hidden = kind !== 'command';
	byId('action-prompt-label').hidden = kind !== 'model.call';
	byId('action-target').value =
		kind === 'command'
			? (state?.testCommand.executable ?? 'node')
			: kind === 'knowledge.search'
				? 'workflow tool access'
				: kind === 'model.call'
					? (state?.model.name ?? 'review-model')
					: 'src/inventory.cjs';
}

for (const button of document.querySelectorAll('[data-view]'))
	button.addEventListener('click', () => setView(button.dataset.view));
for (const button of document.querySelectorAll('[data-mode]'))
	button.addEventListener('click', () => {
		mode = button.dataset.mode;
		for (const candidate of document.querySelectorAll('[data-mode]'))
			candidate.classList.toggle('selected', candidate === button);
	});
byId('run-button').addEventListener('click', () =>
	command(async () => {
		await api('run', { mode });
	}),
);
byId('stop-button').addEventListener('click', () =>
	command(async () => {
		await api('stop', {});
		toast('Run stopped.');
	}),
);
byId('reset-button').addEventListener('click', () =>
	command(async () => {
		await api('reset', {});
		toast('New isolated session.');
	}),
);
byId('export-button').addEventListener('click', () => {
	const link = node('a');
	link.href = '/api/export';
	link.download = `agent-contract-${state.session.sessionId}.json`;
	link.click();
});
byId('advance-button').addEventListener('click', () =>
	command(async () => {
		const phase = byId('advance-button').dataset.target;
		if (!phase) return;
		const decision = await api('phase', { phase });
		toast(
			decision.allowed ? `Stage: ${phase}` : decision.message,
			!decision.allowed,
		);
	}),
);
byId('complete-button').addEventListener('click', () =>
	command(async () => {
		await api('complete', {});
		toast('Session completed.');
	}),
);
byId('action-kind').addEventListener('change', actionFields);
byId('action-form').addEventListener('submit', (event) => {
	event.preventDefault();
	void command(async () => {
		const kind = byId('action-kind').value;
		const target = byId('action-target').value;
		const action =
			kind === 'command'
				? {
						kind,
						executable: target,
						args: JSON.parse(byId('action-args').value),
					}
				: kind === 'file.read'
					? { kind, path: target }
					: kind === 'file.write'
						? { kind, path: target, content: byId('action-content').value }
						: kind === 'knowledge.search'
							? { kind, query: target }
							: {
									kind,
									model: target,
									prompt: byId('action-prompt').value,
									knowledgeQuery: 'workflow verification policy',
									maxOutputTokens: 256,
								};
		const result = await api('action', action);
		const output = byId('action-result');
		output.className = `action-result ${result.status}`;
		output.textContent = `${result.status.toUpperCase()}: ${result.decision.message}`;
	});
});
byId('policy-preset').addEventListener('change', () => {
	byId('policy-editor').value = state.profiles[byId('policy-preset').value];
	byId('policy-save-state').textContent = 'Unsaved preset';
});
byId('policy-editor').addEventListener('input', () => {
	byId('policy-save-state').textContent = 'Unsaved changes';
});
byId('validate-button').addEventListener('click', () =>
	command(async () => {
		const result = await api('policy/validate', {
			yaml: byId('policy-editor').value,
		});
		toast(`Valid policy: ${result.name}`);
		byId('policy-save-state').textContent = 'Valid / not applied';
	}),
);
byId('save-policy-button').addEventListener('click', () =>
	command(async () => {
		const result = await api('policy', { yaml: byId('policy-editor').value });
		toast(`Saved: ${result.name}`);
		byId('policy-save-state').textContent = 'Saved for next session';
	}),
);
byId('knowledge-form').addEventListener('submit', (event) => {
	event.preventDefault();
	void command(async () => {
		const result = await api('knowledge', {
			query: byId('knowledge-query').value,
		});
		byId('knowledge-engine').replaceChildren(
			icon('database'),
			document.createTextNode(
				result.retrieval.engine === 'sqlite-fts5'
					? 'SQLite FTS5'
					: 'MiniSearch',
			),
		);
		byId('knowledge-stats').textContent =
			`${result.citations.length} citations / ${result.retrieval.indexedChunks} indexed chunks / ${result.retrieval.durationMs} ms`;
		const results = byId('knowledge-results');
		results.replaceChildren();
		if (!result.citations.length)
			results.append(node('p', 'quiet', result.answer));
		result.citations.forEach((citation, index) => {
			const article = node('article', 'citation');
			const heading = node('div', 'citation-header');
			heading.append(
				node('h3', '', `[${index + 1}] ${citation.title}`),
				node(
					'span',
					'citation-origin',
					citation.origin === 'attached-policy'
						? 'Attached policy'
						: 'Runbook / reference',
				),
			);
			article.append(
				heading,
				node('div', 'citation-source', citation.source),
				node('p', '', citation.excerpt),
				node('div', 'citation-hash', `SHA-256 ${citation.contentSha256}`),
			);
			results.append(article);
		});
		icons();
	});
});

icons();
await refresh();
setInterval(() => {
	void refresh();
}, 400);
