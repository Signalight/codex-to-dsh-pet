/* Browser half of codex-to-dsh-pet — built by build.js (injects config + spritesheet).
 * A generic Codex-pet → DSH overlay: configure via config.json.
 * Wrapped in an IIFE so multiple pets' bundles never leak top-level const
 * (which would collide and make later bundles fail to register). */
(function () {
const RAW_CONFIG = __CONFIG_JSON__;
const DEFAULTS = {
	name: "codex-to-dsh-pet",
	label: "桌宠 Pet",
	spriteVersionNumber: 2,
	size: 120,
	pin: "bottom-right",
	normalize: null,
	look: {
		enabled: true,
		deadzone: 28,
	},
	bubble: {
		enabled: true,
		maxChars: 140,
		runningText: "运行中：{tool}…",
		workingText: "工作中…",
		thinkingText: "思考中…",
	},
};
const CONFIG = Object.assign({}, DEFAULTS, RAW_CONFIG);
CONFIG.bubble = Object.assign({}, DEFAULTS.bubble, RAW_CONFIG.bubble || {});
CONFIG.look = Object.assign({}, DEFAULTS.look, RAW_CONFIG.look || {});

const SPRITESHEET = "__SPRITESHEET_DATA_URI__";

window.__ModuleLoader__.load({
	id: CONFIG.name,
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
				const pin = options.pin;
				if (pin && !dragging) {
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
		// Pure helpers.
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

		function bubbleContent(snap, activity) {
			if (CONFIG.bubble.enabled === false) return "";
			if (activity === "running") {
				const tool = runningToolNameOf(snap);
				if (tool) return (CONFIG.bubble.runningText || "运行中：{tool}…").replace("{tool}", tool);
				return CONFIG.bubble.workingText || "工作中…";
			}
			if (activity === "review") {
				const t = partialTextOf(snap);
				if (t) return liveTail(t, CONFIG.bubble.maxChars || 140);
				return CONFIG.bubble.thinkingText || "思考中…";
			}
			return "";
		}

		// ================================================================
		// React shell.overlay entry.
		// ================================================================

		const BUBBLE_CSS =
			".codex-to-dsh-pet-bubble{" +
			"position:absolute;min-width:96px;" +
			"max-width:min(440px,calc(100vw - 48px));padding:8px 12px;" +
			"background:rgba(24,27,34,0.94);color:#e7e9ee;" +
			"border:1px solid rgba(255,255,255,0.12);border-radius:12px;" +
			"font:12px/1.5 -apple-system,'Segoe UI','Microsoft YaHei',sans-serif;" +
			"white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;text-align:left;" +
			"box-shadow:0 6px 18px rgba(0,0,0,0.35);" +
			"pointer-events:none;user-select:none;-webkit-user-select:none;" +
			"}" +
			".codex-to-dsh-pet-bubble::after{" +
			"content:'';position:absolute;top:100%;left:var(--tail-x,50%);transform:translateX(-50%);" +
			"border:6px solid transparent;border-top-color:rgba(24,27,34,0.94);" +
			"}";

		function ensureBubbleStyle() {
			try {
				if (!document.getElementById || !document.head) return;
				if (document.getElementById("codex-to-dsh-pet-style")) return;
				const style = document.createElement("style");
				style.id = "codex-to-dsh-pet-style";
				style.textContent = BUBBLE_CSS;
				document.head.appendChild(style);
			} catch (e) { /* non-critical */ }
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

		function PetOverlay({ sessions }) {
			const ref = react.useRef(null);
			const petRef = react.useRef(null);
			const bubbleRef = react.useRef(null);
			const activityRef = react.useRef("idle");
			const bubbleWidthRef = react.useRef(120);

			const snap = useConversationSnapshot(sessions);
			const activity = deriveActivity(snap);
			activityRef.current = activity;
			const showBubble = (activity === "running" || activity === "review") && CONFIG.bubble.enabled !== false;
			const bubbleText = showBubble ? bubbleContent(snap, activity) : "";

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

			react.useEffect(() => {
				const host = ref.current;
				if (!host) return;

				const pet = createCodexPet(host, {
					src: SPRITESHEET,
					spriteVersionNumber: CONFIG.spriteVersionNumber,
					size: CONFIG.size,
					pin: CONFIG.pin,
					draggable: true,
					jumpOnDoubleClick: false, // the overlay owns double-click (activity-aware restore)
					normalize: CONFIG.normalize || undefined,
				});
				petRef.current = pet;
				window.__pet = pet;
				console.log("[codex-to-dsh-pet] ready —", CONFIG.name);

				ensureBubbleStyle();
				const bubble = document.createElement("div");
				bubble.className = "codex-to-dsh-pet-bubble";
				bubble.style.display = "none";
				host.appendChild(bubble);
				bubbleRef.current = bubble;

				const look = (e) => {
					if (CONFIG.look.enabled === false) return;      // 显式关闭注视
					if (CONFIG.spriteVersionNumber === 1) return;    // v1 图集没有注视帧
					if (activityRef.current !== "idle") return;
					if (e.target === pet.element) return;
					const r = pet.element.getBoundingClientRect();
					const cx = r.left + r.width / 2;
					const cy = r.top + r.height / 2;
					pet.setLook({ x: e.clientX - cx, y: e.clientY - cy }, CONFIG.look.deadzone || 28);
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
				pet.element.addEventListener("pointerdown", onDragDown);
				pet.element.addEventListener("pointerup", releaseSync);
				pet.element.addEventListener("pointercancel", releaseSync);

				const RESTORE_BY_ACTIVITY = { running: "running", review: "review", waiting: "waiting", idle: "idle" };
				const onDoubleClick = () => {
					const restore = RESTORE_BY_ACTIVITY[activityRef.current] || "idle";
					pet.clearLook();
					pet.play("jumping", { then: restore });
				};
				pet.element.addEventListener("dblclick", onDoubleClick);

				return () => {
					window.removeEventListener("pointermove", look);
					window.removeEventListener("pointermove", onBubbleMove);
					window.removeEventListener("resize", onBubbleMove);
					pet.element.removeEventListener("pointerdown", onDragDown);
					pet.element.removeEventListener("pointerup", releaseSync);
					pet.element.removeEventListener("pointercancel", releaseSync);
					pet.element.removeEventListener("dblclick", onDoubleClick);
					if (window.__pet === pet) delete window.__pet;
					pet.dispose();
					petRef.current = null;
				};
			}, []);

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
				className: "codex-to-dsh-pet-host",
				style: { position: "absolute", inset: "0", pointerEvents: "none" },
			});
		}

		// ================================================================
		// Plugin body.
		// ================================================================

		const inject = ["slots", "sessions"];

		function apply(ctx) {
			const sessions = ctx.sessions;
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: CONFIG.name,
				order: 100,
				label: CONFIG.label,
			}, (props) => react.createElement(PetOverlay, { ...props, sessions })));
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.deriveActivity = deriveActivity;
		exports.bubbleContent = bubbleContent;
		return module.exports;
	}
});
})();
