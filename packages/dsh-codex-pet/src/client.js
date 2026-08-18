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

		// ================================================================
		// Codex pet renderer (framework-agnostic core).
		// ================================================================

		const FRAME_WIDTH = 192;
		const FRAME_HEIGHT = 208;

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
			"}";

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
			const [state, setState] = react.useState(null);

			const snap = useConversationSnapshot(sessions);
			const activity = deriveActivity(snap);
			activityRef.current = activity;
			const showBubble = (activity === "running" || activity === "review");
			const bubbleText = showBubble ? bubbleContent(snap, activity) : "";

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
						.then(() => { if (!cancelled) timer = setTimeout(load, 2000); });
				};
				load();
				return () => { cancelled = true; clearTimeout(timer); };
			}, []);

			function positionBubble() {
				const pet = petRef.current;
				const b = bubbleRef.current;
				const host = ref.current;
				if (!pet || !b || !host || b.style.display === "none") return;
				const pr = pet.element.getBoundingClientRect();
				const hr = host.getBoundingClientRect();
				const vw = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 1200;
				const bw = bubbleWidthRef.current;
				const gap = 8;
				let left = (pr.left - hr.left) + (pr.width - bw) / 2;
				const viewportLeft = hr.left + left;
				if (viewportLeft < gap) left = gap - hr.left;
				else if (viewportLeft + bw > vw - gap) left = (vw - gap) - bw - hr.left;
				b.style.left = `${left}px`;
				b.style.bottom = `${hr.bottom - pr.top + gap}px`;
				b.style.setProperty("--tail-x", `${pr.left + pr.width / 2 - (hr.left + left)}px`);
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

				const look = (e) => {
					if (pet.spriteVersionNumber === 1) return; // v1 atlases have no look cells
					if (activityRef.current !== "idle") return;
					if (e.target === controller.element) return;
					const r = controller.element.getBoundingClientRect();
					const cx = r.left + r.width / 2;
					const cy = r.top + r.height / 2;
					controller.setLook({ x: e.clientX - cx, y: e.clientY - cy }, 28);
				};
				window.addEventListener("pointermove", look);
				const onBubbleMove = () => positionBubble();
				window.addEventListener("pointermove", onBubbleMove);
				window.addEventListener("resize", onBubbleMove);

				let petDragging = false;
				const onDragDown = () => { petDragging = true; };
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
					window.removeEventListener("pointermove", look);
					window.removeEventListener("pointermove", onBubbleMove);
					window.removeEventListener("resize", onBubbleMove);
					controller.element.removeEventListener("pointerdown", onDragDown);
					controller.element.removeEventListener("pointerup", releaseSync);
					controller.element.removeEventListener("pointercancel", releaseSync);
					controller.element.removeEventListener("dblclick", onDoubleClick);
					controller.dispose();
					petRef.current = null;
					bubbleRef.current = null;
				};
			}, [configKey]);

			// Update the bubble theme in place when the setting changes (no pet re-create).
			const bubbleThemeNow = displayNow ? (displayNow.bubbleTheme ?? "gray") : "gray";
			const bubbleOpacityNow = displayNow ? (displayNow.bubbleOpacity ?? 94) : 94;
			react.useEffect(() => {
				const b = bubbleRef.current;
				if (!b) return;
				applyBubbleTheme(b, bubbleThemeNow, bubbleOpacityNow);
			}, [bubbleThemeNow, bubbleOpacityNow]);

			const prevWorking = react.useRef(false);
			function syncToActivity(act, opts = {}) {
				const pet = petRef.current;
				if (!pet) return;
				if (act === "running") {
					pet.clearLook();
					pet.setAnimation("running");
					prevWorking.current = true;
				} else if (act === "review") {
					pet.clearLook();
					pet.setAnimation("review");
					prevWorking.current = true;
				} else if (act === "waiting") {
					pet.clearLook();
					pet.setAnimation("waiting");
					prevWorking.current = false;
				} else {
					if (opts.wave !== false && prevWorking.current) {
						pet.clearLook();
						pet.play("waving", { then: "idle" });
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

			return react.createElement("div", {
				ref,
				className: "codex-pet-host",
				style: { position: "absolute", inset: "0", pointerEvents: "none" },
			});
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
		function checkboxField(label, checked, onChange) {
			return react.createElement("label", { style: { display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", cursor: "pointer" } },
				react.createElement("input", { type: "checkbox", checked, onChange, style: { cursor: "pointer" } }),
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
		return module.exports;
	}
});
})();
