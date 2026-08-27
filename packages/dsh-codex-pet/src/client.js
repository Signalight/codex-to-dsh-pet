/* Browser half of dsh-codex-pet — the Codex spritesheet-atlas renderer,
 * registry-driven. It fetches the selected pet + display config from the
 * host's '/api/codex-pet/*' endpoints and renders the pet as a draggable
 * overlay whose pose follows the live conversation activity (idle / waiting /
 * running / review), with a progress bubble, mouse-tracking "look" (v2),
 * wave-on-hover and jump-on-double-click. Wrapped in an IIFE so the bundle
 * never leaks top-level const into the page. */
(function () {
window.__ModuleLoader__.load({
	id: "@signalight/dsh-codex-pet",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		let react = require("react");
		// react-dom's createPortal mounts the pet host at the top-level document.body
		// stacking context, so side drawers/panels can never cover the pet even when
		// the host's own slot container sits in a lower stacking context. Guarded so
		// the node/browserless test harness (which only provides react) falls back to
		// rendering the host in place.
		let createPortal = null;
		try { createPortal = require("react-dom").createPortal; } catch (e) { createPortal = null; }

		// ================================================================
		// Codex pet renderer (framework-agnostic core).
		// ================================================================

		const FRAME_WIDTH = 192;
		const FRAME_HEIGHT = 208;
		const STATE_POLL_MS = 2000;
		const DONE_CONFIRM_DELAY_MS = STATE_POLL_MS + 500;

		const ANIMATIONS = {
			idle:         { row: 0, frames: 6, frameInterval: 160 },
			runningRight: { row: 1, frames: 8, frameInterval: 120 },
			runningLeft:  { row: 2, frames: 8, frameInterval: 120 },
			waving:       { row: 3, frames: 4, frameInterval: 140 },
			jumping:      { row: 4, frames: 5, frameInterval: 140 },
			failed:       { row: 5, frames: 8, frameInterval: 140 },
			waiting:      { row: 6, frames: 6, frameInterval: 150 },
			sleeping:     { row: 6, frames: 6, frameInterval: 150 },
			running:      { row: 7, frames: 6, frameInterval: 120 },
			review:       { row: 8, frames: 6, frameInterval: 150 },
		};

		const ALIASES = {
			"running-right": "runningRight",
			"running-left": "runningLeft",
			"run-right": "runningRight",
			"run-left": "runningLeft",
			"run": "running",
		};

		const DEFAULT_ANIMATION = "idle";

		function resolveAnimation(name) {
			const key = name == null ? DEFAULT_ANIMATION : (ALIASES[name] || name);
			return ANIMATIONS[key] || ANIMATIONS[DEFAULT_ANIMATION];
		}

		function resolveLook(direction, deadzone = 0) {
			if (direction == null) return undefined;
			let degrees;
			if (typeof direction === "number") {
				degrees = direction;
			} else {
				if (!Number.isFinite(direction.x) || !Number.isFinite(direction.y)) return undefined;
				const magnitude = Math.hypot(direction.x, direction.y);
				if (magnitude === 0 || magnitude <= Math.max(0, deadzone)) return undefined;
				degrees = (Math.atan2(direction.x, -direction.y) * 180) / Math.PI;
			}
			if (!Number.isFinite(degrees)) return undefined;
			const normalized = ((degrees % 360) + 360) % 360;
			return Math.round(normalized / 22.5) % 16;
		}

		function createCodexPet(container, options = {}) {
			const version = options.spriteVersionNumber === 2 ? 2 : 1;
			const rows = version === 2 ? 11 : 9;
			const columns = 8;
			const src = options.src || "";

			let scale = 1;
			if (typeof options.size === "number") scale = options.size / FRAME_WIDTH;
			else if (typeof options.size === "string" && options.size.endsWith("px")) {
				const n = Number(options.size.slice(0, -2));
				if (Number.isFinite(n) && n > 0) scale = n / FRAME_WIDTH;
			}

			const el = document.createElement("div");
			el.className = "codex-pet";
			Object.assign(el.style, {
				width: `${FRAME_WIDTH * scale}px`,
				height: `${FRAME_HEIGHT * scale}px`,
				backgroundImage: src ? `url("${src}")` : "none",
				backgroundRepeat: "no-repeat",
				backgroundSize: `${FRAME_WIDTH * columns * scale}px ${FRAME_HEIGHT * rows * scale}px`,
				position: "absolute",
				userSelect: "none",
				WebkitUserSelect: "none",
				cursor: "grab",
				pointerEvents: "auto",
			});
			container.appendChild(el);

			let animationName = DEFAULT_ANIMATION;
			let current = resolveAnimation(animationName);
			let frame = 0;
			let elapsed = 0;
			let mode = "loop";
			let thenName = null;
			let lookIndex = undefined;
			let rafId = 0;
			let lastTime = 0;
			let dragging = false;
			let dragOffset = { x: 0, y: 0 };
			let disposed = false;

			function canonical(name) { return ALIASES[name] || name; }

			function paint() {
				let row, col;
				if (lookIndex !== undefined) {
					row = 9 + Math.floor(lookIndex / 8);
					col = lookIndex % 8;
				} else {
					row = current.row;
					col = frame % current.frames;
				}
				const n = (options.normalize && options.normalize[row]) || null;
				if (n) {
					el.style.backgroundSize = `${FRAME_WIDTH * columns * scale * n.s}px ${FRAME_HEIGHT * rows * scale * n.s}px`;
					el.style.backgroundPosition =
						`${(FRAME_WIDTH / 2) * scale - (col * FRAME_WIDTH + n.cx) * scale * n.s}px ` +
						`${(FRAME_HEIGHT / 2) * scale - (row * FRAME_HEIGHT + n.cy) * scale * n.s}px`;
				} else {
					el.style.backgroundSize = `${FRAME_WIDTH * columns * scale}px ${FRAME_HEIGHT * rows * scale}px`;
					el.style.backgroundPosition = `${-col * FRAME_WIDTH * scale}px ${-row * FRAME_HEIGHT * scale}px`;
				}
			}

			function tick(t) {
				if (disposed) return;
				if (lastTime === 0) lastTime = t;
				const dt = t - lastTime;
				lastTime = t;
				if (lookIndex === undefined || mode === "once") {
					elapsed += dt;
					while (elapsed >= current.frameInterval) {
						elapsed -= current.frameInterval;
						frame += 1;
						if (frame >= current.frames) {
							if (mode === "once") {
								if (thenName) setAnimation(thenName, { mode: "loop" });
								else frame = current.frames - 1;
							} else {
								frame = 0;
							}
						}
					}
				}
				paint();
				rafId = requestAnimationFrame(tick);
			}

			function setAnimation(name, opts = {}) {
				const key = canonical(name);
				current = resolveAnimation(key);
				animationName = key;
				frame = 0;
				elapsed = 0;
				mode = opts.mode || "loop";
				thenName = opts.then || null;
				paint();
				return controller;
			}

			function place() {
				if (dragging) return;
				if (options.position) {
					el.style.left = `${options.position.x}px`;
					el.style.top = `${options.position.y}px`;
					return;
				}
				const pin = options.pin;
				if (pin) {
					const pw = container.clientWidth || window.innerWidth;
					const ph = container.clientHeight || window.innerHeight;
					const w = FRAME_WIDTH * scale;
					const h = FRAME_HEIGHT * scale;
					const margin = 12;
					let left, top;
					switch (pin) {
						case "top-left": left = margin; top = margin; break;
						case "top": left = (pw - w) / 2; top = margin; break;
						case "top-right": left = pw - w - margin; top = margin; break;
						case "left": left = margin; top = (ph - h) / 2; break;
						case "center": left = (pw - w) / 2; top = (ph - h) / 2; break;
						case "right": left = pw - w - margin; top = (ph - h) / 2; break;
						case "bottom-left": left = margin; top = ph - h - margin; break;
						case "bottom": left = (pw - w) / 2; top = ph - h - margin; break;
						case "bottom-right":
						default: left = pw - w - margin; top = ph - h - margin; break;
					}
					el.style.left = `${left}px`;
					el.style.top = `${top}px`;
				}
			}

			if (options.position) {
				el.style.left = `${options.position.x}px`;
				el.style.top = `${options.position.y}px`;
			} else {
				place();
			}
			const onResize = () => place();
			window.addEventListener("resize", onResize);

			if (options.draggable !== false) {
				const DRAG_RUN_THRESHOLD = 4;
				let dragLastX = 0;
				let preDrag = null;
				el.addEventListener("pointerdown", (e) => {
					if (e.button !== 0 && e.pointerType === "mouse") return;
					dragging = true;
					const rect = el.getBoundingClientRect();
					dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
					dragLastX = e.clientX;
					if (options.dragRun !== false) {
						preDrag = { name: animationName, mode, then: thenName };
						lookIndex = undefined;
						paint();
					}
					el.setPointerCapture(e.pointerId);
					el.style.cursor = "grabbing";
					e.preventDefault();
				});
				el.addEventListener("pointermove", (e) => {
					if (!dragging) return;
					if (options.dragRun !== false) {
						const dx = e.clientX - dragLastX;
						dragLastX = e.clientX;
						if (dx > DRAG_RUN_THRESHOLD && animationName !== "runningRight") {
							setAnimation("runningRight", { mode: "loop" });
						} else if (dx < -DRAG_RUN_THRESHOLD && animationName !== "runningLeft") {
							setAnimation("runningLeft", { mode: "loop" });
						}
					}
					const pr = container.getBoundingClientRect();
					const w = FRAME_WIDTH * scale;
					const h = FRAME_HEIGHT * scale;
					let x = e.clientX - pr.left - dragOffset.x;
					let y = e.clientY - pr.top - dragOffset.y;
					x = Math.max(0, Math.min(x, pr.width - w));
					y = Math.max(0, Math.min(y, pr.height - h));
					el.style.left = `${x}px`;
					el.style.top = `${y}px`;
				});
				const endDrag = () => {
					dragging = false;
					el.style.cursor = "grab";
					if (options.dragRun !== false && preDrag) {
						setAnimation(preDrag.name, { mode: preDrag.mode, then: preDrag.then });
						preDrag = null;
					}
					const x = parseFloat(el.style.left);
					const y = parseFloat(el.style.top);
					if (Number.isFinite(x) && Number.isFinite(y)) {
						options.position = { x, y };
						if (options.onDragEnd) options.onDragEnd({ x, y });
					}
				};
				el.addEventListener("pointerup", endDrag);
				el.addEventListener("pointercancel", endDrag);
			}

			if (options.waveOnHover !== false) {
				el.addEventListener("pointerenter", () => {
					if (dragging) return;
					const anim = canonical(animationName);
					if (anim !== "idle" && anim !== "waving") return;
					lookIndex = undefined;
					paint();
					setAnimation("waving", { mode: "once", then: DEFAULT_ANIMATION });
				});
			}

			if (options.jumpOnDoubleClick !== false) {
				el.addEventListener("dblclick", () => {
					if (dragging) return;
					lookIndex = undefined;
					paint();
					const restore = mode === "loop" ? animationName : DEFAULT_ANIMATION;
					setAnimation("jumping", { mode: "once", then: restore });
				});
			}

			const controller = {
				setAnimation(name, opts) { return setAnimation(name, opts); },
				play(name, opts = {}) {
					return setAnimation(name, { mode: "once", then: opts.then || DEFAULT_ANIMATION });
				},
				setLook(direction, deadzone = 0) {
					if (version !== 2) return controller;
					lookIndex = resolveLook(direction, deadzone);
					frame = 0;
					elapsed = 0;
					paint();
					return controller;
				},
				clearLook() { lookIndex = undefined; paint(); return controller; },
				setScale(s) {
					scale = s;
					Object.assign(el.style, {
						width: `${FRAME_WIDTH * scale}px`,
						height: `${FRAME_HEIGHT * scale}px`,
						backgroundSize: `${FRAME_WIDTH * columns * scale}px ${FRAME_HEIGHT * rows * scale}px`,
					});
					place(); paint(); return controller;
				},
				setPin(pin) { options.pin = pin; place(); return controller; },
				setPosition(x, y) { el.style.left = `${x}px`; el.style.top = `${y}px`; return controller; },
				get animation() { return animationName; },
				get dragging() { return dragging; },
				get lookIndex() { return lookIndex; },
				get element() { return el; },
				dispose() {
					disposed = true;
					cancelAnimationFrame(rafId);
					window.removeEventListener("resize", onResize);
					el.remove();
				},
			};

			setAnimation(options.animation || DEFAULT_ANIMATION, { mode: "loop" });
			rafId = requestAnimationFrame(tick);
			return controller;
		}

		// ================================================================
		// Pure helpers (activity + bubble copy).
		// ================================================================

		function deriveActivity(snap) {
			if (!snap) return "idle";
			if (snap.pending && snap.pending.length > 0) return "waiting";
			if (snap.runningCalls && snap.runningCalls.length > 0) return "running";
			if (snap.running === true) return "review";
			return "idle";
		}

		function partialTextOf(snap) {
			const p = snap && snap.partial;
			if (!p || !p.blocks) return "";
			for (let i = p.blocks.length - 1; i >= 0; i--) {
				const b = p.blocks[i];
				if (b && b.kind === "text" && b.text) return b.text;
			}
			return "";
		}

		function runningToolNameOf(snap) {
			const calls = snap && snap.runningCalls;
			if (!calls || !calls.length) return "";
			return (calls[0] && calls[0].name) || "";
		}

		function liveTail(text, n) {
			text = (text || "").trim();
			if (!text) return "";
			if (text.length <= n) return text;
			return "…" + text.slice(-(n - 1));
		}

		// ================================================================
		// Request-summary helpers (pure; operate on the conversation snapshot).
		// ================================================================

		// Core ContentBlock[] (user messages) carry a `type` tag.
		function coreTextOf(content) {
			if (!content) return "";
			for (const b of content) {
				if (b && b.type === "text" && b.text) return b.text;
			}
			return "";
		}

		function clip(text, n) {
			text = (text || "").trim();
			if (text.length <= n) return text;
			return text.slice(0, Math.max(1, n - 1)) + "…";
		}

		function firstAssistantText(node) {
			for (const b of node.blocks || []) {
				if (b && b.kind === "text" && b.text) return b.text;
			}
			return "";
		}

		/** Completed ordinary model requests, ordered by their durable start seq. */
		function completedModelRequestsOf(snap) {
			const view = snap && snap.views && typeof snap.views.get === "function" ? snap.views.get("trajectory") : null;
			if (!view || !Array.isArray(view.requests)) return [];
			return view.requests
				.filter((request) => request && request.purpose === "assistant" && request.status !== "running" && Number.isSafeInteger(request.startSeq))
				.slice()
				.sort((a, b) => a.startSeq - b.startSeq);
		}

		/** Fold each completed model request into one bounded summarizer record. */
		function collectRequestRecords(nodes, requests, options = {}) {
			const argLimit = options.argLimit ?? 60;
			const textLimit = options.textLimit ?? 200;
			const users = [];
			const assistantsBySeq = new Map();
			const assistantsByStep = new Map();
			const errorsByStep = new Map();
			for (const node of nodes || []) {
				if (!node) continue;
				if (node.kind === "user" && Number.isSafeInteger(node.seq)) users.push(node);
				if (node.kind === "assistant" && Number.isSafeInteger(node.turn) && Number.isSafeInteger(node.step)) {
					if (Number.isSafeInteger(node.seq)) assistantsBySeq.set(node.seq, node);
					assistantsByStep.set(node.turn + ":" + node.step, node);
				}
				if (node.kind === "turn-error" && Number.isSafeInteger(node.turn) && Number.isSafeInteger(node.step)) {
					errorsByStep.set(node.turn + ":" + node.step, node.message || "模型请求异常终止");
				}
			}
			users.sort((a, b) => a.seq - b.seq);
			const records = (requests || []).map((request) => {
				const key = request.turn + ":" + request.step;
				const assistant = (Number.isSafeInteger(request.resultSeq) && assistantsBySeq.get(request.resultSeq)) || assistantsByStep.get(key);
				let user = "";
				if (request.step === 1) {
					for (const node of users) {
						if (node.seq >= request.startSeq) break;
						user = clip(coreTextOf(node.content), textLimit);
					}
				}
				const actions = [];
				for (const block of (assistant && assistant.blocks) || []) {
					if (block && block.kind === "tool-call") {
						actions.push({ tool: block.name || "?", detail: clip(String(block.argsRaw || ""), argLimit), callId: block.callId, failed: false });
					}
				}
				let error = request.status === "error" ? clip(request.error || errorsByStep.get(key) || "模型请求失败", textLimit) : "";
				if (assistant && assistant.interrupted) error = error || "模型请求被用户中断";
				return {
					requestSeq: request.startSeq,
					turn: request.turn,
					step: request.step,
					user,
					assistant: clip(firstAssistantText(assistant || {}), textLimit),
					error,
					actions,
				};
			});
			return markFailedActions(records, nodes);
		}

		/** Completed turn numbers, ascending (the authoritative turnEnds map). */
		function completedTurnsOf(snap) {
			if (!snap || !snap.turnEnds || typeof snap.turnEnds.keys !== "function") return [];
			const out = [];
			for (const t of snap.turnEnds.keys()) if (typeof t === "number") out.push(t);
			return out.sort((a, b) => a - b);
		}

		/**
		 * True when the latest finished turn was cut short by the user: the
		 * conversation snapshot flags its partial assistant message. This is the
		 * reliable abort signal — the agent loop never dispatches agent/turn-stopping
		 * on an abort (it throws straight into the catch), so a host-side hook
		 * cannot see user interrupts at all.
		 */
		function latestTurnInterrupted(snap) {
			if (!snap || !Array.isArray(snap.nodes)) return false;
			const turns = completedTurnsOf(snap);
			if (!turns.length) return false;
			const latest = turns[turns.length - 1];
			return snap.nodes.some((n) => n && n.kind === "assistant" && n.turn === latest && n.interrupted === true);
		}

		/** True when the latest finished turn died on a turn-error node. */
		function latestTurnErrored(snap) {
			if (!snap || !Array.isArray(snap.nodes)) return false;
			const turns = completedTurnsOf(snap);
			if (!turns.length) return false;
			const latest = turns[turns.length - 1];
			return snap.nodes.some((n) => n && n.kind === "turn-error" && n.turn === latest);
		}

		function shouldPlayDone(snap, state) {
			return state.activeSessionId === state.expectedSessionId
				&& state.activity === "idle"
				&& state.now >= state.muteUntil
				&& !latestTurnInterrupted(snap)
				&& !latestTurnErrored(snap);
		}

		/**
		 * Mark failed flags onto the matching tool actions of each request record by
		 * pairing tool-result callIds with the call heads collected above.
		 */
		function markFailedActions(records, nodes) {
			const failedCalls = new Set();
			for (const node of nodes || []) {
				if (node && node.kind === "tool-result" && node.isError && node.callId) failedCalls.add(node.callId);
			}
			for (const rec of records) {
				for (const action of rec.actions) {
					if (action.callId && failedCalls.has(action.callId)) action.failed = true;
				}
			}
			return records;
		}

		/** Assemble one summarize POST body for a consecutive request batch. */
		function buildSummaryPayload(nodes, requests, sessionId) {
			return {
				sessionId: sessionId || undefined,
				fromRequestSeq: requests[0].startSeq,
				toRequestSeq: requests[requests.length - 1].startSeq,
				requests: collectRequestRecords(nodes, requests),
			};
		}

		/** Start automatic observation after the selected snapshot, never at journal history. */
		function baselineAutoTracker(sessionId, completedRequests) {
			const latest = completedRequests && completedRequests.length
				? completedRequests[completedRequests.length - 1].startSeq
				: -1;
			return { sessionId: sessionId ?? null, ready: true, lastSeenRequestSeq: latest, windowStartRequestSeq: latest >= 0 ? latest + 1 : null, retryCount: 0 };
		}

		function awaitingOpenAutoTracker(sessionId) {
			return { sessionId: sessionId ?? null, ready: false, lastSeenRequestSeq: -1, windowStartRequestSeq: null, retryCount: 0 };
		}

		function isCurrentAutoTrackerSession(tracker, sessionId) {
			return !!tracker && tracker.sessionId === sessionId;
		}

		/** Select the next automatic batch without mutating the tracker. */
		function selectAutoSummaryBatch(tracker, sessionId, openState, completedRequests, interval, isSummarizing) {
			if (tracker.sessionId !== sessionId) {
				if (openState === "open") return { tracker: baselineAutoTracker(sessionId, completedRequests), batch: null };
				return { tracker: awaitingOpenAutoTracker(sessionId), batch: null };
			}
			if (openState !== "open") return { tracker, batch: null };
			if (!tracker.ready) return { tracker: baselineAutoTracker(sessionId, completedRequests), batch: null };
			if (!completedRequests.length) return { tracker, batch: null };
			const latest = completedRequests[completedRequests.length - 1].startSeq;
			const nextTracker = latest > tracker.lastSeenRequestSeq ? { ...tracker, lastSeenRequestSeq: latest } : tracker;
			if (isSummarizing) return { tracker: nextTracker, batch: null };
			const start = nextTracker.windowStartRequestSeq != null ? nextTracker.windowStartRequestSeq : completedRequests[0].startSeq;
			const batch = completedRequests.filter((request) => request.startSeq >= start).slice(0, interval);
			return { tracker: nextTracker, batch: batch.length >= interval ? batch : null };
		}

		/** Settle an automatic summary against the current tracker, not its request-time snapshot. */
		function settleAutoTrackerAfterSummary(tracker, sessionId, nextStartRequestSeq, succeeded) {
			if (!isCurrentAutoTrackerSession(tracker, sessionId)) return tracker;
			if (!succeeded) return { ...tracker, retryCount: tracker.retryCount + 1 };
			return {
				...tracker,
				windowStartRequestSeq: tracker.windowStartRequestSeq == null
					? nextStartRequestSeq
					: Math.max(tracker.windowStartRequestSeq, nextStartRequestSeq),
				retryCount: 0,
			};
		}

		function requestCoveredByJournal(request, records) {
			if (!request || !Number.isSafeInteger(request.startSeq)) return false;
			return (records || []).some((record) => record && Number.isSafeInteger(record.fromRequestSeq)
				&& Number.isSafeInteger(record.toRequestSeq) && request.startSeq >= record.fromRequestSeq && request.startSeq <= record.toRequestSeq);
		}

		/** Completed requests absent from every persisted journal range, ascending. */
		function uncoveredModelRequestsOf(completedRequests, journalRecords) {
			return (completedRequests || []).filter((request) => !requestCoveredByJournal(request, journalRecords)).slice().sort((a, b) => a.startSeq - b.startSeq);
		}

		/** Split manual work into server-safe, configured request batches. */
		function summaryBatches(requests, intervalRequests) {
			const size = Math.max(1, Math.min(50, Number.isFinite(Number(intervalRequests)) ? Math.floor(Number(intervalRequests)) : 5));
			const batches = [];
			for (let index = 0; index < (requests || []).length; index += size) batches.push(requests.slice(index, index + size));
			return batches;
		}

		function manualSummaryEnabled(summary) {
			return !!summary && summary.enabled === true && !!summary.provider && !!summary.model;
		}

		function summaryTextFromResponse(data) {
			return data && typeof data.summary === "string" ? data.summary : "";
		}

		function manualSummaryBlocksSession(ownerSessionId, sessionId) {
			return ownerSessionId !== null && ownerSessionId === sessionId;
		}

		function releaseManualSummaryOwner(ownerSessionId, sessionId) {
			return ownerSessionId === sessionId ? null : ownerSessionId;
		}

		function releaseManualSummaryOwnerAfterSessionChange(ownerSessionId, sessionId) {
			return ownerSessionId !== null && ownerSessionId !== sessionId ? null : ownerSessionId;
		}

		/** Keep automatic work after successful manual coverage without skipping new requests. */
		function advanceAutoTrackerAfterManual(tracker, sessionId, requests) {
			if (!tracker || tracker.sessionId !== sessionId || !(requests && requests.length)) return tracker;
			const lastRequestSeq = requests[requests.length - 1].startSeq;
			if (!Number.isSafeInteger(lastRequestSeq)) return tracker;
			const nextRequestSeq = lastRequestSeq + 1;
			tracker.windowStartRequestSeq = tracker.windowStartRequestSeq == null
				? nextRequestSeq
				: Math.max(tracker.windowStartRequestSeq, nextRequestSeq);
			tracker.lastSeenRequestSeq = Math.max(tracker.lastSeenRequestSeq, lastRequestSeq);
			return tracker;
		}

		const BUBBLE_TEXT = {
			runningText: "运行中：{tool}…",
			workingText: "工作中…",
			thinkingText: "思考中…",
		};

		function bubbleContent(snap, activity, maxChars = 140) {
			if (activity === "running") {
				const tool = runningToolNameOf(snap);
				if (tool) return BUBBLE_TEXT.runningText.replace("{tool}", tool);
				return BUBBLE_TEXT.workingText;
			}
			if (activity === "review") {
				const t = partialTextOf(snap);
				if (t) return liveTail(t, maxChars);
				return BUBBLE_TEXT.thinkingText;
			}
			return "";
		}

		// ================================================================
		// React shell.overlay entry.
		// ================================================================

		const BUBBLE_CSS =
			".codex-pet-bubble{" +
			"position:absolute;min-width:96px;" +
			"max-width:min(440px,calc(100vw - 48px));padding:8px 12px;" +
			"background:var(--cp-bubble-bg,rgba(24,27,34,0.94));" +
			"color:var(--cp-bubble-color,#e7e9ee);" +
			"border:1px solid var(--cp-bubble-border,rgba(255,255,255,0.12));" +
			"border-radius:12px;" +
			"font:12px/1.5 -apple-system,'Segoe UI','Microsoft YaHei',sans-serif;" +
			"white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;text-align:left;" +
			"box-shadow:0 6px 18px rgba(0,0,0,0.35);" +
			"pointer-events:none;user-select:none;-webkit-user-select:none;" +
			"}" +
			".codex-pet-bubble::after{" +
			"content:'';position:absolute;top:100%;left:var(--tail-x,50%);transform:translateX(-50%);" +
			"border:6px solid transparent;border-top-color:var(--cp-bubble-bg,rgba(24,27,34,0.94));" +
			"}" +
			// Summary bubble: same visual family as the progress bubble, plus an
			// opacity fade so periodic summaries appear and dissolve in place.
			".codex-pet-summary-bubble{" +
			"position:absolute;min-width:120px;" +
			"max-width:min(480px,calc(100vw - 48px));padding:10px 14px;" +
			"background:var(--cp-bubble-bg,rgba(24,27,34,0.94));" +
			"color:var(--cp-bubble-color,#e7e9ee);" +
			"border:1px solid var(--cp-bubble-border,rgba(255,255,255,0.12));" +
			"border-radius:12px;" +
			"font:12px/1.6 -apple-system,'Segoe UI','Microsoft YaHei',sans-serif;" +
			"white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;text-align:left;" +
			"box-shadow:0 6px 18px rgba(0,0,0,0.35);" +
			"pointer-events:none;user-select:none;-webkit-user-select:none;" +
			"opacity:0;transition:opacity 0.45s ease;" +
			"}" +
			".codex-pet-summary-bubble.visible{opacity:1}" +
			".codex-pet-summary-bubble::after{" +
			"content:'';position:absolute;top:100%;left:var(--tail-x,50%);transform:translateX(-50%);" +
			"border:6px solid transparent;border-top-color:var(--cp-bubble-bg,rgba(24,27,34,0.94));" +
			"}" +

			// Journal cloud stack: hovering the pet floats past AI-view summaries
			// as soft cloud puffs, newest at the bottom, fading out toward the
			// stack edges (CSS mask) and scrolled with the wheel.
			".codex-pet-journal{" +
			"position:absolute;width:300px;max-height:330px;overflow-y:auto;" +
			"scrollbar-width:none;-ms-overflow-style:none;" +
			"padding:26px 8px 18px;box-sizing:border-box;" +
			"pointer-events:none;user-select:none;-webkit-user-select:none;z-index:3;" +
			"opacity:0;transform:translateY(8px) scale(0.965);transform-origin:50% 100%;" +
			"transition:opacity 0.38s ease,transform 0.38s ease;" +
			"-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 30px,#000 calc(100% - 26px),transparent 100%);" +
			"mask-image:linear-gradient(to bottom,transparent 0,#000 30px,#000 calc(100% - 26px),transparent 100%);" +
			"}" +
			".codex-pet-journal::-webkit-scrollbar{display:none}" +
			".codex-pet-journal.visible{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}" +
			".codex-pet-journal-item{" +
			"position:relative;" +
			"background:var(--cp-bubble-bg,rgba(24,27,34,0.92));" +
			"color:var(--cp-bubble-color,#e7e9ee);" +
			"border:1px solid var(--cp-bubble-border,rgba(255,255,255,0.12));" +
			"border-radius:18px 24px 20px 16px;" +
			"padding:8px 13px 9px;margin-top:10px;" +
			"font:12px/1.65 -apple-system,'Segoe UI','Microsoft YaHei',sans-serif;" +
			"box-shadow:0 5px 16px rgba(0,0,0,0.16);" +
			"word-break:break-word;overflow-wrap:anywhere;white-space:pre-wrap;text-align:left;" +
			"}" +
			".codex-pet-journal-item:nth-child(odd){transform:translateX(-5px);border-radius:24px 16px 22px 20px}" +
			".codex-pet-journal-item:nth-child(even){transform:translateX(7px)}" +
			".codex-pet-journal-meta{display:flex;gap:6px;align-items:baseline;opacity:0.6;font-size:10.5px;margin-bottom:2px;white-space:nowrap}" +
			".codex-pet-journal-empty{opacity:0.55;text-align:center;padding:14px 10px;font:12px/1.6 -apple-system,'Segoe UI','Microsoft YaHei',sans-serif;}" +
			".codex-pet-menu{position:absolute;z-index:4;min-width:190px;padding:4px;background:var(--cp-bubble-bg,rgba(24,27,34,0.98));border:1px solid var(--cp-bubble-border,rgba(255,255,255,0.16));border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,0.35);font:12px/1.5 -apple-system,'Segoe UI','Microsoft YaHei',sans-serif;pointer-events:auto}" +
			".codex-pet-menu button{display:block;width:100%;padding:7px 10px;border:0;border-radius:5px;background:transparent;color:var(--cp-bubble-color,#e7e9ee);font:inherit;text-align:left;cursor:pointer}" +
			".codex-pet-menu button:hover{background:rgba(255,255,255,0.12)}";

		function ensureBubbleStyle() {
			try {
				if (!document.getElementById || !document.head) return;
				if (document.getElementById("codex-pet-style")) return;
				const style = document.createElement("style");
				style.id = "codex-pet-style";
				style.textContent = BUBBLE_CSS;
				document.head.appendChild(style);
			} catch (e) { /* non-critical */ }
		}

		// Bubble color presets (rgb base + text color + border), themed via CSS vars.
		const BUBBLE_THEMES = {
			gray:   { rgb: [75, 85, 99], color: "#eef1f5", border: "rgba(255,255,255,0.16)" },
			black:  { rgb: [0, 0, 0], color: "#ffffff", border: "rgba(255,255,255,0.25)" },
			white:  { rgb: [255, 255, 255], color: "#1a1d24", border: "rgba(0,0,0,0.14)" },
			blue:   { rgb: [59, 130, 246], color: "#ffffff", border: "rgba(255,255,255,0.28)" },
			green:  { rgb: [47, 84, 63], color: "#ffffff", border: "rgba(255,255,255,0.22)" },
			pink:   { rgb: [244, 178, 205], color: "#6b2139", border: "rgba(107,33,57,0.22)" },
			orange: { rgb: [234, 88, 12], color: "#ffffff", border: "rgba(255,255,255,0.28)" },
		};
		// Backward-compat: the older default key 'dark' maps to gray.
		BUBBLE_THEMES.dark = BUBBLE_THEMES.gray;

		function bubbleStyle(theme, opacity) {
			const t = BUBBLE_THEMES[theme] || BUBBLE_THEMES.gray;
			const a = Math.max(0, Math.min(100, Number(opacity) || 94)) / 100;
			const bg = "rgba(" + t.rgb[0] + "," + t.rgb[1] + "," + t.rgb[2] + "," + a.toFixed(2) + ")";
			return { bg, color: t.color, border: t.border };
		}

		function applyBubbleTheme(el, theme, opacity) {
			const s = bubbleStyle(theme, opacity);
			el.style.setProperty("--cp-bubble-bg", s.bg);
			el.style.setProperty("--cp-bubble-color", s.color);
			el.style.setProperty("--cp-bubble-border", s.border);
		}

		function useConversationSnapshot(sessions) {
			const provide = sessions && sessions.currentProvideInfo;
			const info = react.useSyncExternalStore(
				(cb) => (provide ? provide.subscribe(cb) : () => {}),
				() => (provide ? provide.getSnapshot() : undefined),
			);
			const source = info && info.hooks ? info.hooks.session : undefined;
			return react.useSyncExternalStore(
				(cb) => (source ? source.subscribe(cb) : () => {}),
				() => (source ? source.getSnapshot() : null),
			);
		}

		function postJson(url, body) {
			return fetch(url, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			}).catch(() => {});
		}

		function PetOverlay({ sessions }) {
			const ref = react.useRef(null);
			const petRef = react.useRef(null);
			const bubbleRef = react.useRef(null);
			const activityRef = react.useRef("idle");
			const bubbleWidthRef = react.useRef(120);
			const summaryBubbleRef = react.useRef(null);
			const summaryHideTimerRef = react.useRef(0);
			const summarizingRef = react.useRef(false);
			const doneTimerRef = react.useRef(0);
			const journalRef = react.useRef(null);
			const journalHideTimerRef = react.useRef(0);
			const journalCacheRef = react.useRef({ sessionId: null, at: 0, items: null });
			const menuRef = react.useRef(null);
			const summaryRetryTimerRef = react.useRef(0);
			const manualSummaryOwnerRef = react.useRef(null);
			const closeMenuRef = react.useRef(() => {});
			const activeAudioRef = react.useRef(new Set());
			// Request window per selected session; journal history is intentionally not reused.
			const trackerRef = react.useRef(baselineAutoTracker(null, []));
			// Timestamp guard: right after the user presses Stop we play the
			// interrupt line directly from the button; this window keeps the
			// activity flip from also firing the done chime for the same abort.
			const stopMuteUntilRef = react.useRef(0);
			const prevWorking = react.useRef(false);
			const activeSessionRef = react.useRef(null);
			// Live eye-tracking switch (read by the pointermove handler below, so
			// toggling it never rebuilds the pet). Applies to v2 atlases only.
			const mouseTrackRef = react.useRef(true);
			const [state, setState] = react.useState(null);
			const [summaryTick, setSummaryTick] = react.useState(0);

			// Live mirrors of the polled persisted config, read by handlers that
			// must not depend on React re-render timing.
			const soundStateRef = react.useRef({ enabled: true, volume: 60 });
			const pulseSeenRef = react.useRef({ error: 0, interrupt: 0 });
			const summaryStateRef = react.useRef(null);

			const snap = useConversationSnapshot(sessions);
			const snapshotRef = react.useRef(snap);
			snapshotRef.current = snap;
			const activity = deriveActivity(snap);
			activityRef.current = activity;
			const showBubble = (activity === "running" || activity === "review");
			const bubbleText = showBubble ? bubbleContent(snap, activity) : "";

			// Reset run-local flags before the activity and pulse effects consume a
			// newly selected session.
			react.useEffect(() => {
				const sid = snap ? (snap.sessionId ?? null) : null;
				if (activeSessionRef.current !== null && activeSessionRef.current !== sid) {
					manualSummaryOwnerRef.current = releaseManualSummaryOwnerAfterSessionChange(manualSummaryOwnerRef.current, sid);
					prevWorking.current = false;
					stopMuteUntilRef.current = 0;
					clearTimeout(doneTimerRef.current);
					clearTimeout(summaryHideTimerRef.current);
					clearTimeout(journalHideTimerRef.current);
					if (summaryBubbleRef.current) summaryBubbleRef.current.classList.remove("visible");
					if (journalRef.current) journalRef.current.classList.remove("visible");
					closeMenuRef.current();
					journalCacheRef.current = { sessionId: null, at: 0, items: null };
					stopActiveAudio();
				}
				activeSessionRef.current = sid;
			}, [snap]);

			react.useEffect(() => () => {
				clearTimeout(summaryRetryTimerRef.current);
				clearTimeout(doneTimerRef.current);
				stopActiveAudio();
			}, []);

			// Poll the selected pet + display config so settings edits reflect live
			// (the service writes them to the persisted file; this re-reads it).
			react.useEffect(() => {
				let cancelled = false;
				let timer;
				let lastKey = "";
				const load = () => {
					fetch("/api/codex-pet/state")
						.then((r) => r.json())
						.then((data) => {
							if (cancelled) return;
							const key = JSON.stringify(data);
							if (key !== lastKey) { lastKey = key; setState(data); }
						})
						.catch(() => {})
						.then(() => { if (!cancelled) timer = setTimeout(load, STATE_POLL_MS); });
				};
				load();
				return () => { cancelled = true; clearTimeout(timer); };
			}, []);

			react.useEffect(() => {
				const snd = (state && state.sound) || {};
				soundStateRef.current = {
					enabled: snd.enabled !== false,
					volume: typeof snd.volume === "number" ? snd.volume : 60,
					tracks: snd.tracks || {},
				};
				summaryStateRef.current = (state && state.summary) || null;

				// Scenario pulses: the host stamps lifecycle events; play each new
				// stamp's voice line exactly once (2 s poll cadence is fine — the
				// lines are reactions, not alarms). Final volume = master × track.
				const pulses = state && state.pulses;
				if (pulses) {
					const seen = pulseSeenRef.current;
					for (const kind of ["error", "interrupt"]) {
						const pulse = pulses[kind] || {};
						const at = typeof pulse === "number" ? pulse : (pulse.at || 0);
						const owner = typeof pulse === "object" ? pulse.sessionId : "";
						if (at && at !== seen[kind]) {
							seen[kind] = at;
							if (owner && owner !== activeSessionRef.current) continue;
							const track = soundStateRef.current.tracks[kind] || {};
							const recent = at > Date.now() - 15000;
							// An error is not a successful completion even when its own
							// voice line is disabled.
							if (kind === "error" && recent) {
								stopMuteUntilRef.current = Date.now() + 8000;
								clearTimeout(doneTimerRef.current);
							}
							if (soundStateRef.current.enabled && track.enabled !== false && recent) {
								playTrack(kind, (soundStateRef.current.volume * (typeof track.volume === "number" ? track.volume : 100)) / 10000);
							}
						}
					}
				}
			}, [state, snap && snap.sessionId]);

			// Shared placement for both bubbles (progress + summary): centered over
			// the pet, clamped to the viewport, tail pointing at the pet's center.
			function positionBubbleEl(b, bw) {
				const pet = petRef.current;
				const host = ref.current;
				if (!pet || !b || !host || !b.isConnected) return;
				const pr = pet.element.getBoundingClientRect();
				const hr = host.getBoundingClientRect();
				const vw = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 1200;
				const gap = 8;
				let left = (pr.left - hr.left) + (pr.width - bw) / 2;
				const viewportLeft = hr.left + left;
				if (viewportLeft < gap) left = gap - hr.left;
				else if (viewportLeft + bw > vw - gap) left = (vw - gap) - bw - hr.left;
				b.style.left = `${left}px`;
				b.style.bottom = `${hr.bottom - pr.top + gap}px`;
				b.style.setProperty("--tail-x", `${pr.left + pr.width / 2 - (hr.left + left)}px`);
			}

			function positionBubble() {
				const b = bubbleRef.current;
				if (!b || b.style.display === "none") return;
				bubbleWidthRef.current = b.offsetWidth || 120;
				positionBubbleEl(b, bubbleWidthRef.current);
			}

			function positionSummaryBubble() {
				const b = summaryBubbleRef.current;
				if (!b) return;
				positionBubbleEl(b, b.offsetWidth || 160);
			}

			function positionJournal() {
				const j = journalRef.current;
				if (!j || !j.classList.contains("visible")) return;
				positionBubbleEl(j, 300);
			}

			// Recreate the pet only when a structural setting changes (pet, show/hide,
			// size, pin) — the 2s poll is deduped so identical snapshots skip this.
			const petIdNow = state && state.pet ? state.pet.id : null;
			const displayNow = state ? state.display : null;
			const configKey = JSON.stringify({
				petId: petIdNow,
				visible: !displayNow || displayNow.visible !== false,
				size: displayNow ? (displayNow.size ?? null) : null,
				pin: displayNow ? (displayNow.pin ?? null) : null,
			});

			react.useEffect(() => {
				const host = ref.current;
				if (!host) return;
				if (!state || !state.pet) return;
				if (state.display && state.display.visible === false) return;

				const pet = state.pet;
				const display = state.display || {};
				const position = (display.left != null && display.top != null)
					? { x: display.left, y: display.top }
					: undefined;

				const controller = createCodexPet(host, {
					src: pet.atlasUrl,
					spriteVersionNumber: pet.spriteVersionNumber,
					size: display.size != null ? display.size : pet.size,
					pin: display.pin != null ? display.pin : pet.pin,
					position,
					draggable: true,
					jumpOnDoubleClick: false, // the overlay owns double-click (activity-aware restore)
					onDragEnd: ({ x, y }) => { postJson("/api/codex-pet/set-config", { left: x, top: y }); },
				});
				petRef.current = controller;
				console.log("[dsh-codex-pet] ready —", pet.id);

				ensureBubbleStyle();
				const bubble = document.createElement("div");
				bubble.className = "codex-pet-bubble";
				bubble.style.display = "none";
				applyBubbleTheme(bubble, display.bubbleTheme ?? "gray", display.bubbleOpacity ?? 94);
				host.appendChild(bubble);
				bubbleRef.current = bubble;

				const summaryBubble = document.createElement("div");
				summaryBubble.className = "codex-pet-summary-bubble";
				applyBubbleTheme(summaryBubble, display.bubbleTheme ?? "gray", display.bubbleOpacity ?? 94);
				host.appendChild(summaryBubble);
				summaryBubbleRef.current = summaryBubble;

				const journal = document.createElement("div");
				journal.className = "codex-pet-journal";
				applyBubbleTheme(journal, display.bubbleTheme ?? "gray", Math.min(display.bubbleOpacity ?? 94, 92));
				host.appendChild(journal);
				journalRef.current = journal;

				function formatJournalTime(iso) {
					const t = new Date(iso).getTime();
					if (!Number.isFinite(t)) return "";
					const diff = Date.now() - t;
					if (diff < 60000) return "刚刚";
					if (diff < 3600000) return Math.floor(diff / 60000) + " 分钟前";
					if (diff < 86400000) return Math.floor(diff / 3600000) + " 小时前";
					if (diff < 172800000) return "昨天 " + new Date(t).toTimeString().slice(0, 5);
					return new Date(t).toDateString().slice(5) + " " + new Date(t).toTimeString().slice(0, 5);
				}
				function renderJournal(items, loadError) {
					journal.textContent = "";
					if (loadError) {
						const error = document.createElement("div");
						error.className = "codex-pet-journal-empty";
						error.textContent = "总结记录加载失败：" + loadError;
						journal.appendChild(error);
						return;
					}
					if (!items || !items.length) {
						const empty = document.createElement("div");
						empty.className = "codex-pet-journal-empty";
						empty.textContent = "还没有总结记录 — 完成设定的模型请求数后，我会把进展汇报在这里";
						journal.appendChild(empty);
						return;
					}
					// Oldest first (top → bottom), so the newest puff sits right above the pet.
					for (const rec of [...items].reverse()) {
						const item = document.createElement("div");
						item.className = "codex-pet-journal-item";
						const meta = document.createElement("div");
						meta.className = "codex-pet-journal-meta";
						const when = document.createElement("span");
						when.textContent = formatJournalTime(rec.createdAt);
						const range = document.createElement("span");
						range.textContent = typeof rec.requestCount === "number"
							? rec.requestCount + " Requests"
							: "Turn " + rec.fromTurn + "–" + rec.toTurn;
						meta.appendChild(when);
						meta.appendChild(range);
						const body = document.createElement("div");
						body.textContent = rec.summary || "";
						item.appendChild(meta);
						item.appendChild(body);
						journal.appendChild(item);
					}
				}
				function openJournal() {
					clearTimeout(journalHideTimerRef.current);
					const sessionId = activeSessionRef.current;
					if (!sessionId) { renderJournal(null); return; }
					const now = Date.now();
					const cache = journalCacheRef.current;
					if (cache.sessionId !== sessionId || now - cache.at > 10000 || !cache.items) {
						fetch("/api/codex-pet/journal?session=" + encodeURIComponent(sessionId) + "&limit=30").then((r) => {
							if (!r.ok) throw new Error("HTTP " + r.status);
							return r.json();
						}).then((d) => {
							if (!d || !Array.isArray(d.records)) throw new Error("响应格式无效");
							if (activeSessionRef.current !== sessionId) return;
							journalCacheRef.current = { sessionId, at: Date.now(), items: d.records };
							renderJournal(journalCacheRef.current.items);
						}).catch((error) => {
							if (activeSessionRef.current !== sessionId) return;
							renderJournal(null, (error && error.message) || "网络错误");
						});
					} else {
						renderJournal(journalCacheRef.current.items);
					}
					journal.classList.add("visible");
					positionJournal();
					// Newest puff sits at the bottom edge, next to the pet.
					requestAnimationFrame(() => { journal.scrollTop = journal.scrollHeight; });
				}
				function closeJournal() { journal.classList.remove("visible"); }
				const menu = document.createElement("div");
				menu.className = "codex-pet-menu";
				menu.style.display = "none";
				applyBubbleTheme(menu, display.bubbleTheme ?? "gray", display.bubbleOpacity ?? 94);
				const analyzeButton = document.createElement("button");
				analyzeButton.type = "button";
				analyzeButton.textContent = "分析此前未总结内容";
				const journalButton = document.createElement("button");
				journalButton.type = "button";
				journalButton.textContent = "查看总结记录";
				menu.append(analyzeButton, journalButton);
				host.appendChild(menu);
				menuRef.current = menu;
				const closeMenu = () => { menu.style.display = "none"; };
				closeMenuRef.current = closeMenu;
				const showManualMessage = (message) => { showSummaryBubble(message); };
				const analyzeUncovered = async () => {
					closeMenu();
					const sessionId = activeSessionRef.current;
					const summary = summaryStateRef.current;
					if (!sessionId) return showManualMessage("没有可分析的会话");
					if (!manualSummaryEnabled(summary)) return showManualMessage("自动总结未启用，无法分析此前内容");
					if (manualSummaryBlocksSession(manualSummaryOwnerRef.current, sessionId) || summarizingRef.current) return showManualMessage("总结正在生成，请稍候");
					const snapshot = snapshotRef.current;
					const completed = completedModelRequestsOf(snapshot || {});
					if (!completed.length) return showManualMessage("没有可分析的已完成请求");
					let records;
					try {
						const response = await fetch("/api/codex-pet/journal?session=" + encodeURIComponent(sessionId) + "&all=1");
						if (!response.ok) throw new Error("HTTP " + response.status);
						const data = await response.json();
						if (!data || !Array.isArray(data.records)) throw new Error("响应格式无效");
						records = data.records;
					} catch (error) {
						return showManualMessage("总结记录加载失败：" + ((error && error.message) || "网络错误"));
					}
					if (activeSessionRef.current !== sessionId) return;
					const uncovered = uncoveredModelRequestsOf(completed, records);
					const batches = summaryBatches(uncovered, summary.intervalRequests);
					if (!batches.length) return showManualMessage("此前没有未总结的内容");
					if (!window.confirm("将分析 " + batches.reduce((count, batch) => count + batch.length, 0) + " 个未总结请求，分 " + batches.length + " 批调用模型，可能产生相应费用。继续吗？")) return;
					manualSummaryOwnerRef.current = sessionId;
					const summaries = [];
					try {
						for (const batch of batches) {
							if (activeSessionRef.current !== sessionId) throw new Error("会话已切换，已停止分析");
							const response = await fetch("/api/codex-pet/summarize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(buildSummaryPayload((snapshotRef.current || {}).nodes, batch, sessionId)) });
							const data = await response.json().catch(() => null);
							if (!response.ok || !data || data.ok === false) throw new Error((data && data.error) || ("HTTP " + response.status));
							advanceAutoTrackerAfterManual(trackerRef.current, sessionId, batch);
							const text = summaryTextFromResponse(data);
							if (text) summaries.push(text);
						}
						journalCacheRef.current = { sessionId: null, at: 0, items: null };
						if (activeSessionRef.current === sessionId) {
							showSummaryBubble(summaries.join("\n\n"));
							openJournal();
						}
					} catch (error) {
						if (activeSessionRef.current === sessionId) {
							const message = (error && error.message) || "未知错误";
							showManualMessage(message === "no-llm-service" ? "未连接可用的 LLM 服务，无法分析此前内容" : "总结失败，已停止：" + message);
						}
					} finally {
						manualSummaryOwnerRef.current = releaseManualSummaryOwner(manualSummaryOwnerRef.current, sessionId);
					}
				};
				const onContextMenu = (event) => {
					event.preventDefault();
					closeJournal();
					menu.style.display = "block";
					menu.style.left = "0px";
					menu.style.top = "0px";
					const width = menu.offsetWidth;
					const height = menu.offsetHeight;
					const hostRect = host.getBoundingClientRect();
					const maxLeft = Math.min(host.clientWidth - width - 4, window.innerWidth - width - 4 - hostRect.left);
					const maxTop = Math.min(host.clientHeight - height - 4, window.innerHeight - height - 4 - hostRect.top);
					const minLeft = Math.max(4, 4 - hostRect.left);
					const minTop = Math.max(4, 4 - hostRect.top);
					menu.style.left = Math.max(minLeft, Math.min(event.clientX - hostRect.left, maxLeft)) + "px";
					menu.style.top = Math.max(minTop, Math.min(event.clientY - hostRect.top, maxTop)) + "px";
				};
				const onOutsideMenu = (event) => { if (!menu.contains(event.target) && event.target !== controller.element) closeMenu(); };
				const onMenuKeydown = (event) => { if (event.key === "Escape") closeMenu(); };
				const onJournalButtonClick = () => { closeMenu(); openJournal(); };
				analyzeButton.addEventListener("click", analyzeUncovered);
				journalButton.addEventListener("click", onJournalButtonClick);
				controller.element.addEventListener("contextmenu", onContextMenu);
				document.addEventListener("pointerdown", onOutsideMenu);
				window.addEventListener("keydown", onMenuKeydown);
				function scheduleCloseJournal() {
					clearTimeout(journalHideTimerRef.current);
					journalHideTimerRef.current = setTimeout(closeJournal, 280);
				}
				const onPetEnter = () => { openJournal(); };
				const onPetLeave = () => { scheduleCloseJournal(); };
				const onJournalEnter = () => { clearTimeout(journalHideTimerRef.current); };
				const onJournalLeave = () => { scheduleCloseJournal(); };
				const onJournalDragHide = (event) => { if (event.button === 0) closeJournal(); };
				controller.element.addEventListener("pointerenter", onPetEnter);
				controller.element.addEventListener("pointerleave", onPetLeave);
				journal.addEventListener("pointerenter", onJournalEnter);
				journal.addEventListener("pointerleave", onJournalLeave);
				controller.element.addEventListener("pointerdown", onJournalDragHide);

				const look = (e) => {
					if (pet.spriteVersionNumber === 1) return; // v1 atlases have no look cells
					if (!mouseTrackRef.current) return; // eye-tracking turned off in settings
					if (activityRef.current !== "idle") return;
					if (e.target === controller.element) return;
					const r = controller.element.getBoundingClientRect();
					const cx = r.left + r.width / 2;
					const cy = r.top + r.height / 2;
					controller.setLook({ x: e.clientX - cx, y: e.clientY - cy }, 28);
				};
				window.addEventListener("pointermove", look);
				const onBubbleMove = () => { positionBubble(); positionSummaryBubble(); positionJournal(); };
				window.addEventListener("pointermove", onBubbleMove);
				window.addEventListener("resize", onBubbleMove);

				let petDragging = false;
				const onDragDown = (event) => {
					if (event.button !== 0) return;
					petDragging = true;
					closeMenu();
				};
				const releaseSync = () => {
					if (!petDragging) return;
					petDragging = false;
					syncToActivity(activityRef.current, { wave: false });
					positionBubble();
				};
				controller.element.addEventListener("pointerdown", onDragDown);
				controller.element.addEventListener("pointerup", releaseSync);
				controller.element.addEventListener("pointercancel", releaseSync);

				const RESTORE_BY_ACTIVITY = { running: "running", review: "review", waiting: "waiting", idle: "idle" };
				const onDoubleClick = () => {
					const restore = RESTORE_BY_ACTIVITY[activityRef.current] || "idle";
					controller.clearLook();
					controller.play("jumping", { then: restore });
				};
				controller.element.addEventListener("dblclick", onDoubleClick);

				return () => {
					closeMenuRef.current = () => {};
					closeMenu();
					window.removeEventListener("pointermove", look);
					window.removeEventListener("pointermove", onBubbleMove);
					window.removeEventListener("resize", onBubbleMove);
					controller.element.removeEventListener("pointerdown", onDragDown);
					controller.element.removeEventListener("pointerup", releaseSync);
					controller.element.removeEventListener("pointercancel", releaseSync);
					controller.element.removeEventListener("dblclick", onDoubleClick);
					controller.element.removeEventListener("pointerenter", onPetEnter);
					controller.element.removeEventListener("pointerleave", onPetLeave);
					controller.element.removeEventListener("pointerdown", onJournalDragHide);
					controller.element.removeEventListener("contextmenu", onContextMenu);
					analyzeButton.removeEventListener("click", analyzeUncovered);
					journalButton.removeEventListener("click", onJournalButtonClick);
					document.removeEventListener("pointerdown", onOutsideMenu);
					window.removeEventListener("keydown", onMenuKeydown);
					journal.removeEventListener("pointerenter", onJournalEnter);
					journal.removeEventListener("pointerleave", onJournalLeave);
					controller.dispose();
					petRef.current = null;
					if (bubble) bubble.remove();
					bubbleRef.current = null;
					if (summaryBubble) summaryBubble.remove();
					summaryBubbleRef.current = null;
					if (journal) journal.remove();
					journalRef.current = null;
					if (menu) menu.remove();
					menuRef.current = null;
					clearTimeout(summaryHideTimerRef.current);
					clearTimeout(journalHideTimerRef.current);
				};
			}, [configKey]);

			// Update the bubble theme in place when the setting changes (no pet re-create).
			const bubbleThemeNow = displayNow ? (displayNow.bubbleTheme ?? "gray") : "gray";
			const bubbleOpacityNow = displayNow ? (displayNow.bubbleOpacity ?? 94) : 94;
			react.useEffect(() => { mouseTrackRef.current = !displayNow || displayNow.mouseTracking !== false; }, [displayNow]);
			react.useEffect(() => {
				const b = bubbleRef.current;
				const s = summaryBubbleRef.current;
				const m = menuRef.current;
				if (!b && !s && !m) return;
				if (b) applyBubbleTheme(b, bubbleThemeNow, bubbleOpacityNow);
				if (s) applyBubbleTheme(s, bubbleThemeNow, bubbleOpacityNow);
				if (m) applyBubbleTheme(m, bubbleThemeNow, bubbleOpacityNow);
			}, [bubbleThemeNow, bubbleOpacityNow]);

			// Task-finished chime: browsers require a prior user gesture before
			// audio, so a blocked first attempt is warned and dropped.
			function playTrack(track, volume) {
				try {
					const audio = new Audio("/codex-pet-sound?track=" + encodeURIComponent(track) + "&t=" + Date.now());
					const removeAudio = () => { activeAudioRef.current.delete(audio); };
					audio.addEventListener("ended", removeAudio, { once: true });
					audio.addEventListener("error", removeAudio, { once: true });
					activeAudioRef.current.add(audio);
					audio.volume = typeof volume === "number" ? Math.min(1, Math.max(0, volume)) : 0.6;
					const played = audio.play();
					if (played && played.catch) {
						played.catch((e) => {
							removeAudio();
							if (e && e.name === "NotAllowedError") console.warn("[dsh-codex-pet] " + track + " voice blocked by autoplay policy until first user gesture");
						});
					}
				} catch (e) { console.warn("[dsh-codex-pet] " + track + " audio unavailable:", e); }
			}

			function stopActiveAudio() {
				for (const audio of activeAudioRef.current) {
					try { audio.pause(); audio.currentTime = 0; } catch (e) { /* best effort cleanup */ }
				}
				activeAudioRef.current.clear();
			}

			/** Play one scenario track at master × track volume, honoring switches. */
			function playScenarioTrack(kind) {
				const s = soundStateRef.current;
				if (!s || s.enabled === false) return;
				const t = (s.tracks && s.tracks[kind]) || {};
				if (t.enabled === false) return;
				playTrack(kind, (s.volume * (typeof t.volume === "number" ? t.volume : 100)) / 10000);
			}

			function playDoneSound() {
				playScenarioTrack("done");
			}

			// Show one periodic-summary bubble for bubbleSeconds, then fade it out.
			function showSummaryBubble(text) {
				const b = summaryBubbleRef.current;
				if (!b || !text) return;
				b.textContent = text;
				b.classList.add("visible");
				positionSummaryBubble();
				clearTimeout(summaryHideTimerRef.current);
				const seconds = Math.max(3, (summaryStateRef.current && summaryStateRef.current.bubbleSeconds) || 12);
				summaryHideTimerRef.current = setTimeout(() => { b.classList.remove("visible"); }, seconds * 1000);
			}

			// Periodic request-summary: watch completed assistant requests; once
			// intervalRequests of them accumulated since the last batch, post the
			// transcript excerpt to the host and surface the LLM reply in a bubble.
			react.useEffect(() => {
				if (!snap) return;
				const cfg = summaryStateRef.current;
				const wasSessionChange = trackerRef.current.sessionId !== snap.sessionId;
				if (!manualSummaryEnabled(cfg)) {
					if (wasSessionChange) {
						trackerRef.current = awaitingOpenAutoTracker(snap.sessionId);
						summarizingRef.current = false;
						clearTimeout(summaryRetryTimerRef.current);
					}
					return;
				}
				const interval = Math.max(1, cfg.intervalRequests || 5);
				const done = completedModelRequestsOf(snap);
				const selection = selectAutoSummaryBatch(
					trackerRef.current,
					snap.sessionId,
					snap.openState,
					done,
					interval,
					summarizingRef.current || manualSummaryBlocksSession(manualSummaryOwnerRef.current, snap.sessionId),
				);
				trackerRef.current = selection.tracker;
				if (wasSessionChange) {
					summarizingRef.current = false;
					clearTimeout(summaryRetryTimerRef.current);
					return;
				}
				const tracker = selection.tracker;
				const batch = selection.batch;
				if (!batch) return;
				const nextStartRequestSeq = batch[batch.length - 1].startSeq + 1;
				const payload = buildSummaryPayload(snap.nodes, batch, snap.sessionId);
				summarizingRef.current = true;
				const requestSessionId = tracker.sessionId;
				let succeeded = false;
				fetch("/api/codex-pet/summarize", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(payload),
				})
					.then((r) => r.json())
					.then((d) => {
						if (d && d.ok === false) throw new Error(d.error || "summarize-failed");
						if (!isCurrentAutoTrackerSession(trackerRef.current, requestSessionId) || activeSessionRef.current !== requestSessionId) return;
						trackerRef.current = settleAutoTrackerAfterSummary(trackerRef.current, requestSessionId, nextStartRequestSeq, true);
						journalCacheRef.current = { sessionId: null, at: 0, items: null };
						showSummaryBubble((d && d.summary) || "");
						succeeded = true;
					})
					.catch((e) => console.warn("[dsh-codex-pet] summarize failed:", e))
					.finally(() => {
						if (!isCurrentAutoTrackerSession(trackerRef.current, requestSessionId) || activeSessionRef.current !== requestSessionId) return;
						summarizingRef.current = false;
						if (!succeeded) trackerRef.current = settleAutoTrackerAfterSummary(trackerRef.current, requestSessionId, nextStartRequestSeq, false);
						const delay = succeeded ? 0 : Math.min(30000, 1000 * (2 ** Math.min(trackerRef.current.retryCount, 5)));
						clearTimeout(summaryRetryTimerRef.current);
						summaryRetryTimerRef.current = setTimeout(() => setSummaryTick((value) => value + 1), delay);
					});
			}, [snap, state, summaryTick]);

			// The Stop button is the one user-facing interrupt control: the
			// composer's stop button and the send button's stop morph share the
			// same aria-label ("停止生成" / "Stop generating"). Clicking it speaks
			// the interrupt line right away — no snapshot timing involved.
			react.useEffect(() => {
				const onClick = (e) => {
					const target = e.target;
					const btn = target && target.closest ? target.closest('button[aria-label="停止生成"], button[aria-label="Stop generating"]') : null;
					if (!btn) return;
					stopMuteUntilRef.current = Date.now() + 8000;
					clearTimeout(doneTimerRef.current);
					playScenarioTrack("interrupt");
				};
				document.addEventListener("click", onClick, true);
				return () => document.removeEventListener("click", onClick, true);
			}, []);

			function syncToActivity(act, opts = {}) {
				const pet = petRef.current;
				if (!pet) return;
				if (act === "running") {
					clearTimeout(doneTimerRef.current);
					pet.clearLook();
					pet.setAnimation("running");
					prevWorking.current = true;
				} else if (act === "review") {
					clearTimeout(doneTimerRef.current);
					pet.clearLook();
					pet.setAnimation("review");
					prevWorking.current = true;
				} else if (act === "waiting") {
					clearTimeout(doneTimerRef.current);
					pet.clearLook();
					pet.setAnimation("waiting");
					// Keep prevWorking: a queued message (steering) continues the
					// same run, so its eventual completion still gets the chime.
				} else {
					if (opts.wave !== false && prevWorking.current) {
						if (latestTurnInterrupted(snap) || Date.now() < stopMuteUntilRef.current) {
							// The user cut the turn short: acknowledge the interrupt
							// instead of celebrating a finished task. (The line itself
							// already played on the button press; this branch only
							// suppresses the done chime and the wave.)
							pet.clearLook();
							pet.setAnimation("idle");
						} else if (latestTurnErrored(snap)) {
							// The turn died on an error: the error line plays through
							// the agent/error pulse — never stack the done chime on it.
							pet.clearLook();
							pet.setAnimation("idle");
						} else {
							pet.clearLook();
							pet.setAnimation("idle");
							const sessionId = activeSessionRef.current;
							clearTimeout(doneTimerRef.current);
							// agent/error reaches the browser through the 2 s state poll.
							// Wait past that window, then re-check the live snapshot before
							// treating the settled turn as a successful completion.
							doneTimerRef.current = setTimeout(() => {
								const current = snapshotRef.current;
								if (!shouldPlayDone(current, {
									activeSessionId: activeSessionRef.current,
									expectedSessionId: sessionId,
									activity: activityRef.current,
									muteUntil: stopMuteUntilRef.current,
									now: Date.now(),
								})) return;
								const currentPet = petRef.current;
								if (!currentPet) return;
								currentPet.clearLook();
								currentPet.play("waving", { then: "idle" });
								playDoneSound();
							}, DONE_CONFIRM_DELAY_MS);
						}
					} else pet.setAnimation("idle");
					prevWorking.current = false;
				}
			}
			react.useEffect(() => { syncToActivity(activity, { wave: true }); }, [activity]);

			react.useEffect(() => {
				const b = bubbleRef.current;
				if (!b) return;
				if (showBubble && bubbleText) {
					b.textContent = bubbleText;
					b.style.display = "block";
					bubbleWidthRef.current = b.offsetWidth || 120;
					positionBubble();
				} else {
					b.style.display = "none";
				}
			}, [showBubble, bubbleText]);

			const hostEl = react.createElement("div", {
				ref,
				className: "codex-pet-host",
				// Mount at the top-level (document.body) stacking context with a very
				// high z-index, so side drawers/panels (any shell.overlay sibling that
				// sits in a higher stacking context) can never cover the pet. The host
				// is pointerEvents:none, so it only raises the small pet element (and
				// its transient UI), never the whole panel. Falls back to in-place
				// rendering when react-dom is unavailable.
				style: { position: "fixed", inset: "0", pointerEvents: "none", zIndex: 2147483000 },
			});
			return createPortal ? createPortal(hostEl, document.body) : hostEl;
		}

		// ================================================================
		// Settings section (client half of the "settings.section" slot).
		// ================================================================

		const PINS = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"];

		function field(label, control) {
			return react.createElement("label", { style: { display: "grid", gap: "4px", fontSize: "13px" } },
				react.createElement("span", { style: { color: "#9aa0a6" } }, label),
				control,
			);
		}

		// Inline checkbox: box and label on the same row.
		function checkboxField(label, checked, onChange, disabled = false) {
			return react.createElement("label", { style: { display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1 } },
				react.createElement("input", { type: "checkbox", checked, onChange, disabled, style: { cursor: disabled ? "default" : "pointer" } }),
				react.createElement("span", null, label),
			);
		}

		// Number input with a local draft, so typing "200" does not snap back
		// to the committed value after the intermediate "2". Commits only values
		// within [min, max] and resets the draft on blur.
		function NumberField({ value, disabled, min = 0, max = 512, onCommit }) {
			const [draft, setDraft] = react.useState(String(value));
			react.useEffect(() => { setDraft(String(value)); }, [value]);
			return react.createElement("input", {
				type: "number", min, max, step: 1,
				value: draft,
				disabled,
				style: { padding: "6px 8px" },
				onChange: (e) => {
					const text = e.target.value;
					setDraft(text);
					const n = Number(text);
					if (Number.isFinite(n) && n >= min && n <= max) onCommit(n);
				},
				onBlur: () => { setDraft(String(value)); },
			});
		}

		// File import: a name input + a file picker. The name becomes the pet's
		// display name (Chinese OK); the id comes from the filename, falling back
		// to a generated one when the filename has no kebab characters.
		function ImportButton({ onImported }) {
			const inputRef = react.useRef(null);
			const [name, setName] = react.useState("");
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState("");

			const onFile = (e) => {
				const file = e.target.files && e.target.files[0];
				e.target.value = "";
				if (!file) return;
				const fileId = file.name.replace(/\.[^.]+$/, "").toLowerCase();
				const displayName = name.trim();
				let query = "id=" + encodeURIComponent(fileId);
				if (displayName) query += "&name=" + encodeURIComponent(displayName);
				setBusy(true);
				setError("");
				fetch("/api/codex-pet/import?" + query, { method: "POST", body: file })
					.then((r) => r.json())
					.then((d) => {
						if (d && d.ok === false) { setError(d.error || "导入失败"); return; }
						setName("");
						onImported();
					})
					.catch(() => setError("导入失败（网络错误）"))
					.finally(() => setBusy(false));
			};

			return react.createElement("div", { style: { display: "grid", gap: "8px" } },
				field("宠物名 Pet name（可选，可中文）", react.createElement("input", {
					type: "text",
					value: name,
					placeholder: "留空则用文件名",
					style: { padding: "6px 8px" },
					onChange: (e) => setName(e.target.value),
				})),
				react.createElement("button", {
					type: "button",
					onClick: () => { if (inputRef.current) inputRef.current.click(); },
					disabled: busy,
					style: { padding: "8px 12px", cursor: busy ? "default" : "pointer" },
				}, busy ? "导入中…" : "选择文件并导入（webp / png / gif）"),
				react.createElement("input", {
					ref: inputRef,
					type: "file",
					accept: ".webp,.png,.gif",
					style: { display: "none" },
					onChange: onFile,
				}),
				error ? react.createElement("div", { style: { color: "#e5484d", fontSize: "12px" } }, error) : null,
			);
		}

		function sectionTitle(text) {
			return react.createElement("div", {
				style: { fontWeight: 600, fontSize: "13px", marginTop: "4px", borderTop: "1px solid rgba(128,128,128,0.25)", paddingTop: "12px" },
			}, text);
		}

		// Periodic request-summary settings: cadence, model route (cheap models
		// welcome - the summary is a tiny auxiliary call), bubble dwell time.
		function SummaryControls({ summary, reload }) {
			const [providers, setProviders] = react.useState(null);
			const [error, setError] = react.useState("");
			react.useEffect(() => {
				let cancelled = false;
				fetch("/api/codex-pet/models").then((r) => {
					if (!r.ok) throw new Error(r.status === 404 ? "插件尚未重载：请重启一次 DSH Web 后再试" : "HTTP " + r.status);
					return r.json();
				}).then((d) => {
					if (cancelled) return;
					setProviders(d.providers || []);
				}).catch((e) => {
					if (!cancelled) setError("模型列表加载失败：" + ((e && e.message) || "网络错误"));
				});
				return () => { cancelled = true; };
			}, []);

			const post = (patch) => {
				setError("");
				fetch("/api/codex-pet/set-config", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ summary: patch }),
				}).then((r) => {
					if (!r.ok) throw new Error("HTTP " + r.status);
					reload();
				}).catch((e) => setError("总结设置保存失败：" + ((e && e.message) || "网络错误")));
			};

			const s = summary || {};
			const providerOptions = providers || [];
			const selectedProvider = s.provider || "";
			const selectedModel = s.model || "";
			const routeConfigured = !!selectedProvider && !!selectedModel;
			const modelsOf = (pid) => {
				const entry = providerOptions.find((pr) => pr.id === pid);
				return entry ? entry.models : [];
			};

			return react.createElement("div", { style: { display: "grid", gap: "10px" } },
				checkboxField("启用定期总结 Enabled", routeConfigured && s.enabled === true, (e) => post({ enabled: e.target.checked }), !routeConfigured),
				!routeConfigured ? react.createElement("div", { style: { color: "#e5a13b", fontSize: "12px", marginTop: "-6px" } }, "请先选择 Provider 和 Model / Select provider and model first.") : null,
				field("每 N 次模型请求总结一次 Interval (requests)", react.createElement(NumberField, {
					value: typeof s.intervalRequests === "number" ? s.intervalRequests : 5,
					min: 1, max: 50,
					onCommit: (n) => post({ intervalRequests: n }),
				})),
				field("总结模型 Provider", react.createElement("select", {
					value: selectedProvider,
					disabled: !providers,
					style: { padding: "6px 8px" },
					onChange: (e) => post({ provider: e.target.value, model: "" }),
				},
					react.createElement("option", { value: "" }, providers ? "请选择 Provider" : "加载中…"),
					providerOptions.map((pr) => react.createElement("option", { key: pr.id, value: pr.id }, pr.name || pr.id))),
				),
				field("总结模型 Model", react.createElement("select", {
					value: selectedModel,
					disabled: !selectedProvider || !providers,
					style: { padding: "6px 8px" },
					onChange: (e) => post({ model: e.target.value }),
				},
					react.createElement("option", { value: "" }, selectedProvider ? "请选择 Model" : "—"),
					modelsOf(selectedProvider).map((m) => react.createElement("option", { key: m.id, value: m.id }, m.name || m.id))),
				),
				field("总结气泡停留秒数 Bubble seconds", react.createElement(NumberField, {
					value: typeof s.bubbleSeconds === "number" ? s.bubbleSeconds : 12,
					min: 3, max: 120,
					onCommit: (n) => post({ bubbleSeconds: n }),
				})),
				react.createElement("div", { style: { color: "#9aa0a6", fontSize: "12px" } },
					"请先选择 Provider 和 Model，再自行开启。开启后会将有长度限制的用户、助手、工具和错误摘录发送给所选 LLM 生成总结，并产生该 Provider 的用量/费用；建议选择低成本模型。"),
				error ? react.createElement("div", { style: { color: "#e5a13b", fontSize: "12px" } }, error) : null,
			);
		}

		// Task-finished chime settings: toggle, volume, preview, custom upload.
		function SoundControls({ sound, hasCustomSounds, reload }) {
			const inputRef = react.useRef(null);
			const uploadTrackRef = react.useRef("done");
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState("");

			const post = (patch) => {
				setError("");
				fetch("/api/codex-pet/set-config", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ sound: patch }),
				}).then((r) => {
					if (!r.ok) throw new Error("HTTP " + r.status);
					reload();
				}).catch((e) => setError("场景语音设置保存失败：" + ((e && e.message) || "网络错误")));
			};
			const previewTrack = (track) => {
				setError("");
				try {
					const audio = new Audio("/codex-pet-sound?track=" + track + "&t=" + Date.now());
					const tv = (sound && sound.tracks && sound.tracks[track] && sound.tracks[track].volume);
					audio.volume = Math.max(0, Math.min(1, (((sound && sound.volume) ?? 60) * (typeof tv === "number" ? tv : 100)) / 10000));
					audio.play().catch((e) => {
						if (e && e.name === "NotAllowedError") setError("浏览器自动播放策略拦截：先在页面上任意点击一次再试");
						else setError(track + " 音加载失败（" + ((e && e.name) || "未知") + "）");
					});
				} catch {
					setError("音频播放失败");
				}
			};
			const onFile = (e) => {
				const file = e.target.files && e.target.files[0];
				e.target.value = "";
				if (!file) return;
				setBusy(true);
				setError("");
				fetch("/api/codex-pet/sound?track=" + encodeURIComponent(uploadTrackRef.current || "done"), { method: "POST", body: file })
					.then((r) => r.json())
					.then((d) => { if (d && d.ok === false) throw new Error(d.error || "上传失败"); reload(); })
					.catch((e2) => setError(e2 && e2.message ? String(e2.message) : "上传失败"))
					.finally(() => setBusy(false));
			};
			// Unified "Scenario Voices" panel: global controls (master switch and
			// volume) above a data-driven
			// scenario list — each row: [checkbox + label | volume slider | upload /
			// built-in ghosts | ▶ 试听]. Future scenarios are one more SCENARIOS entry.
			const masterOn = !((sound && sound.enabled) === false);
			const tracksCfg = (sound && sound.tracks) || {};
			const customMap = hasCustomSounds || {};
			const volume = (sound && typeof sound.volume === "number") ? sound.volume : 60;
			const dimmed = { opacity: masterOn ? 1 : 0.4, pointerEvents: masterOn ? "auto" : "none", transition: "opacity 0.25s ease" };
			const ghostButton = { background: "transparent", border: "1px solid rgba(255,255,255,0.14)", color: "#c9ccd4", padding: "3px 10px", borderRadius: "6px", fontSize: "12px", cursor: "pointer", whiteSpace: "nowrap" };
			const previewButton = Object.assign({}, ghostButton, { color: "#9ec1ff", borderColor: "rgba(158,193,255,0.35)" });
			const trackCfg = (id) => tracksCfg[id] || {};
			const trackVolume = (id) => {
				const v = trackCfg(id).volume;
				return typeof v === "number" ? v : 100;
			};
			const SCENARIOS = [
				{ id: "done", label: "任务完成时" },
				{ id: "error", label: "遇到错误时" },
				{ id: "interrupt", label: "被中断时" },
			];
			// One card per scenario, two lines so nothing ever squeezes or wraps:
			//   line 1 — switch + name + preview
			//   line 2 — volume slider + custom/built-in audio actions
			const scenarioRow = (sc) => react.createElement("div", {
				key: sc.id,
				style: { display: "grid", gap: "7px", padding: "9px 11px", borderRadius: "8px", background: "rgba(255,255,255,0.025)" },
			},
				react.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
					react.createElement("input", {
						type: "checkbox",
						checked: trackCfg(sc.id).enabled !== false,
						onChange: (e) => post({ tracks: Object.assign({}, tracksCfg, { [sc.id]: Object.assign({}, trackCfg(sc.id), { enabled: e.target.checked }) }) }),
					}),
					react.createElement("span", { style: { fontSize: "13px", color: "#e2e2e2", whiteSpace: "nowrap" } }, sc.label),
					react.createElement("span", { style: { flex: 1 } }),
					react.createElement("button", {
						type: "button",
						onClick: () => previewTrack(sc.id),
						style: previewButton,
						title: "试听这条场景语音",
					}, "▶ 试听"),
				),
				react.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px", paddingLeft: "24px" } },
					react.createElement("span", { style: { fontSize: "11px", color: "#8b8b8b", whiteSpace: "nowrap" } }, "音量"),
					react.createElement("input", {
						type: "range", min: 0, max: 100, step: 10,
						value: trackVolume(sc.id),
						title: "这条场景的相对音量（最终音量 = 总音量 × 此处）",
						style: { flex: 1, minWidth: 0, maxWidth: "170px", accentColor: "#9ec1ff" },
						onChange: (e) => post({ tracks: Object.assign({}, tracksCfg, { [sc.id]: Object.assign({}, trackCfg(sc.id), { volume: Number(e.target.value) }) }) }),
					}),
					react.createElement("span", { style: { fontSize: "11px", color: "#9aa0a6", minWidth: "34px", textAlign: "right", whiteSpace: "nowrap" } }, trackVolume(sc.id) + "%"),
					react.createElement("button", {
						type: "button",
						onClick: () => { uploadTrackRef.current = sc.id; if (inputRef.current) inputRef.current.click(); },
						disabled: busy,
						style: Object.assign({}, ghostButton, { marginLeft: "auto" }),
						title: "上传这条场景的自定义音频（wav / mp3 / ogg / m4a / flac / webm）",
					}, busy && uploadTrackRef.current === sc.id ? "上传中…" : "自定义音频"),
					customMap[sc.id] ? react.createElement("button", {
						type: "button",
						onClick: () => {
							setError("");
							fetch("/api/codex-pet/reset-sound?track=" + sc.id, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
								.then((r) => {
									if (!r.ok) throw new Error("HTTP " + r.status);
									reload();
								}).catch((e) => setError("恢复内置音频失败：" + ((e && e.message) || "网络错误")));
						},
						style: ghostButton,
						title: "移除自定义音频，回到内置",
					}, "内置") : null,
				),
			);
			return react.createElement("div", { style: { display: "grid", gap: "10px" } },
				// Global controls: everything every scenario shares.
				react.createElement("div", { style: { display: "grid", gap: "10px" } },
					react.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" } },
						react.createElement("span", { style: { fontSize: "13px", color: "#e2e2e2" } }, "启用场景语音"),
						react.createElement("label", { style: { display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" } },
							react.createElement("input", {
								type: "checkbox",
								checked: masterOn,
								onChange: (e) => post({ enabled: e.target.checked }),
							}),
							react.createElement("span", { style: { fontSize: "12px", color: "#9aa0a6" } }, masterOn ? "开" : "关"),
						),
					),
						react.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
							react.createElement("span", { style: { fontSize: "11px", color: "#8b8b8b", whiteSpace: "nowrap" } }, "音量"),
							react.createElement("input", {
								type: "range", min: 0, max: 100, step: 5,
								value: volume,
								title: "总音量（最终音量 = 总音量 × 场景音量）",
								style: { flex: 1, minWidth: 0, maxWidth: "220px", accentColor: "#9ec1ff" },
								onChange: (e) => post({ volume: Number(e.target.value) }),
							}),
							react.createElement("span", { style: { fontSize: "12px", color: "#9aa0a6", minWidth: "34px", textAlign: "right", whiteSpace: "nowrap" } }, volume + "%"),
						),
				),
						customMap.done ? react.createElement("div", { style: { color: "#d08c3a", fontSize: "12px" } },
							"任务完成音当前使用自定义音频 — 点该行『内置』可回到内置语音轮换。") : null,
				// Scenario list: one row per trigger; add future scenarios to SCENARIOS.
				react.createElement("div", { style: Object.assign({ display: "grid", gap: "8px" }, dimmed) },
					react.createElement("div", { style: { fontSize: "11px", color: "#8b8b8b", letterSpacing: "0.04em" } }, "触发场景 TRIGGER EVENTS"),
					SCENARIOS.map(scenarioRow),
				),
				react.createElement("input", {
					ref: inputRef,
					type: "file",
					accept: ".wav,.mp3,.ogg,.m4a,.flac,.webm",
					style: { display: "none" },
					onChange: onFile,
				}),
				error ? react.createElement("div", { style: { color: "#e5484d", fontSize: "12px" } }, error) : null,
			);
		}

		function SettingsSection() {
			const [state, setState] = react.useState(null);

			const load = () => {
				fetch("/api/codex-pet/state")
					.then((r) => r.json())
					.then((d) => setState(d))
					.catch(() => {});
			};

			react.useEffect(() => { load(); }, []);

			if (!state || !state.display) {
				return react.createElement("div", { style: { padding: "16px", color: "#888" } }, "加载中…");
			}
			const v = state.display;
			const pets = state.pets || [];
			// Eye-tracking applies to v2 atlases (the 16 "look" cells) only; v1
			// atlases have no look cells, so the setting is inert for them.
			const selectedPetIsV2 = !!(state.pet && state.pet.spriteVersionNumber === 2);
			const post = (path, body) => {
				fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
					.then(() => load())
					.catch(() => {});
			};

			return react.createElement("div", { style: { padding: "16px", display: "grid", gap: "14px", maxWidth: "440px" } },
				field("宠物 Pet", react.createElement("select", {
					value: state.petId ?? "",
					style: { padding: "6px 8px" },
					onChange: (e) => post("/api/codex-pet/set-pet", { petId: e.target.value }),
				}, pets.map((p) => react.createElement("option", { key: p.id, value: p.id }, p.displayName || p.id)))),
				field("位置 Pin", react.createElement("select", {
					value: v.pin ?? "bottom-right",
					style: { padding: "6px 8px" },
					onChange: (e) => post("/api/codex-pet/set-config", { pin: e.target.value }),
				}, PINS.map((p) => react.createElement("option", { key: p, value: p }, p)))),
				field("大小 Size", react.createElement(NumberField, {
					value: v.size ?? 120,
					min: 32, max: 512,
					onCommit: (n) => post("/api/codex-pet/set-config", { size: n }),
				})),
				checkboxField("显示 Visible", !!v.visible, (e) => post("/api/codex-pet/set-visible", { visible: e.target.checked })),
				checkboxField("鼠标视觉追踪 Eye tracking（仅 v2 图集）", v.mouseTracking !== false, (e) => post("/api/codex-pet/set-config", { mouseTracking: e.target.checked })),
				react.createElement("div", { style: { color: selectedPetIsV2 ? "#9aa0a6" : "#e5a13b", fontSize: "12px", marginTop: "-6px" } },
					selectedPetIsV2
						? "仅 v2 图集支持鼠标追踪：开启后，宠物视线会跟随鼠标。"
						: "仅 v2 图集支持鼠标追踪，当前所选宠物不是 v2 图集，此设置不会生效。"),
				field("气泡颜色 Bubble color", react.createElement("select", {
					value: v.bubbleTheme ?? "gray",
					style: { padding: "6px 8px" },
					onChange: (e) => post("/api/codex-pet/set-config", { bubbleTheme: e.target.value }),
				},
					react.createElement("option", { value: "gray" }, "深灰"),
					react.createElement("option", { value: "black" }, "黑色"),
					react.createElement("option", { value: "white" }, "白色"),
					react.createElement("option", { value: "blue" }, "蓝色"),
					react.createElement("option", { value: "green" }, "墨绿"),
					react.createElement("option", { value: "pink" }, "浅粉"),
					react.createElement("option", { value: "orange" }, "橙色"),
				)),
				field("气泡透明度 Bubble opacity (%)", react.createElement(NumberField, {
					value: v.bubbleOpacity ?? 94,
					min: 0, max: 100,
					onCommit: (n) => post("/api/codex-pet/set-config", { bubbleOpacity: n }),
				})),
				react.createElement(ImportButton, { onImported: load }),

				sectionTitle("定期总结 Turn Summary"),
				react.createElement(SummaryControls, { summary: state.summary, reload: load }),

				sectionTitle("完成提示音 Done Chime"),
				react.createElement(SoundControls, { sound: state.sound, hasCustomSounds: state.hasCustomSounds || {}, reload: load }),
			);
		}

		// ================================================================
		// Plugin body.
		// ================================================================

		const inject = ["slots", "sessions"];

		function apply(ctx) {
			const sessions = ctx.sessions;
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "dsh-codex-pet",
				order: 100,
				label: "Codex Pet",
			}, (props) => react.createElement(PetOverlay, { ...props, sessions })));

			// Settings page: reads/writes through our own /api/codex-pet/* routes
			// (the same source of truth the pet overlay polls), so no settings
			// namespace round-trip is needed.
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "codex-pet",
				order: 130,
				label: "桌宠",
			}, () => react.createElement(SettingsSection)));
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.deriveActivity = deriveActivity;
		// Render-smoke hook: lets the node test suite mount the settings UI
		// without a browser. The host reads only apply/inject.
			exports.__internals = { SoundControls, SummaryControls, SettingsSection, latestTurnInterrupted, latestTurnErrored, shouldPlayDone, completedTurnsOf, completedModelRequestsOf, buildSummaryPayload, baselineAutoTracker, isCurrentAutoTrackerSession, selectAutoSummaryBatch, settleAutoTrackerAfterSummary, requestCoveredByJournal, uncoveredModelRequestsOf, summaryBatches, manualSummaryEnabled, summaryTextFromResponse, manualSummaryBlocksSession, releaseManualSummaryOwner, releaseManualSummaryOwnerAfterSessionChange, advanceAutoTrackerAfterManual };
		return module.exports;
	}
});
})();
