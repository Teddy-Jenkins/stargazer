/**
 * Stargazer Hand Tray — Stage 2
 *
 * A screen-anchored HTML panel at the bottom-center of the viewport.
 * Each player has their own Foundry Hand document; only they see its contents.
 *
 * Tucked state: thin strip showing card count + mousewheel scrolls a peek preview.
 * Expanded state: ~1.5× card height freeform workspace; cards can be dragged
 *   freely, snapping to stacks when dropped near another card.
 * Drag to canvas: dragging a card above the tray's top edge moves it to the
 *   Table pile and drops it onto the canvas at the cursor position.
 * Drag from canvas: (handled in card-table.js) dropping a canvas card onto
 *   the tray moves it into this player's Hand.
 *
 * Data model:
 *   Hand card position → flags.stargazer.handPos: { x, y, stackId? }
 *   stackId links cards in the same logical stack (shared string key).
 *
 * Stage 2 deferred: long-press group-drag of a full stack. The stackId data
 *   model is in place; the interaction is stubbed as TODO.
 */

// ── Debug flag — set false before sessions ──────────────────────────────────
const SGZ_DEBUG = true;

function dbg(scope, msg, data) {
  if (!SGZ_DEBUG) return;
  if (data !== undefined) {
    console.log(`[SGZ:${scope}] ${msg}`, data);
  } else {
    console.log(`[SGZ:${scope}] ${msg}`);
  }
}

function dbgAssert(condition, scope, msgPass, msgFail, data) {
  if (!SGZ_DEBUG) return;
  if (condition) {
    console.log(`✅ [SGZ:${scope}] ${msgPass}`);
  } else {
    console.warn(`❌ [SGZ:${scope}] ${msgFail}`, data ?? "");
  }
}

const MODULE_NS      = "stargazer";
const TABLE_PILE_FLAG = "isCardTable";
const HAND_FLAG       = "isPlayerHand";
const HAND_POS_FLAG   = "handPos";
const POS_FLAG_KEY    = "cardPos";
const TORN_FLAG_KEY   = "tornCorners"; // ["tl","tr","bl","br"] subset — shared with card-table.js
const COLOR_FLAG_KEY  = "cardColor";   // hex number or null — shared with card-table.js
// Preset palette cycled through by ctrl+click, matching the consequence-type
// color table: Failure/Black, Harm/Red, Friction/Yellow, Loss/Green,
// Fatigue/Blue, Threat/Purple. Must match card-table.js's PRESET_COLORS.
const PRESET_COLORS = [0x1a1a1a, 0xc0392b, 0xd4b90a, 0x2e9e4f, 0x3d7fd6, 0x8e44ad];

export const CARD_W       = 90;
export const CARD_H       = 126;
const TRAY_HEIGHT  = Math.round(CARD_H * 1.5);
const TUCK_HEIGHT  = 32;
// Cards must overlap by at least this fraction of their own size in BOTH
// axes to snap into a stack — a passing/slight overlap should not stack.
const MIN_OVERLAP_FRACTION = 0.35;
const TRAY_WIDTH_VW = 60;

// Torn-corner geometry is stored in card-table.js's coordinate space (a card
// centered on 0,0 at CANVAS_CARD_W×CANVAS_CARD_H), so it scales uniformly
// onto the smaller hand-tray card regardless of which surface it's on.
const CANVAS_CARD_W = 140;
const CANVAS_CARD_H = 196;
const SCALE = CARD_W / CANVAS_CARD_W; // same ratio as CARD_H / CANVAS_CARD_H
const CORNER_ZONE = 26; // must match card-table.js's CORNER_ZONE
const CORNER_INSET = 6; // must match card-table.js's CORNER_INSET

function colorNumToCss(hex) {
  return "#" + hex.toString(16).padStart(6, "0");
}

// ─────────────────────────────────────────────────────────────────────────────

export class HandTray {

  /** @type {Cards|null} */
  hand = null;

  /** @type {HTMLElement|null} */
  el = null;

  /** @type {HTMLElement|null} */
  cardsEl = null;

  /** @type {boolean} */
  expanded = false;

  /** @type {Map<string, HTMLElement>} cardId → DOM element */
  cardEls = new Map();

  /** @type {number} */
  peekOffset = 0;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async init() {
    await this._ensureHand();
    this._buildDOM();
    this._bindHooks();
    this._render();
  }

  destroy() {
    this.el?.remove();
    this.el = null;
  }

  // ── Hand document management ───────────────────────────────────────────────

  async _ensureHand() {
    const userId = game.user.id;
    this.hand = game.cards.find(c =>
      c.type === "hand" && c.getFlag(MODULE_NS, HAND_FLAG) === userId
    );
    if (!this.hand) {
      this.hand = await Cards.create({
        name: `${game.user.name}'s Hand`,
        type: "hand",
        ownership: {
          default: 0,
          [userId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
          ...(Object.fromEntries(
            game.users.filter(u => u.isGM).map(u => [u.id, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER])
          )),
        },
        flags: { [MODULE_NS]: { [HAND_FLAG]: userId } },
      });
    }
    dbg("init", `Hand resolved: "${this.hand?.name}" (${this.hand?.id}), cards: ${this.hand?.cards.size}`);
  }

  // ── DOM construction ───────────────────────────────────────────────────────

  _buildDOM() {
    if (this.el) this.el.remove();

    const el = document.createElement("div");
    el.id = "sgz-hand-tray";
    el.innerHTML = `
      <div class="sgz-tray-strip" title="Your hand — hover to expand">
        <span class="sgz-tray-count">0 cards</span>
        <span class="sgz-tray-hint">▲ hand</span>
      </div>
      <div class="sgz-tray-body">
        <div class="sgz-tray-cards"></div>
      </div>
    `;

    this._injectStyles();
    document.body.appendChild(el);
    this.el = el;
    this.cardsEl = el.querySelector(".sgz-tray-cards");

    el.addEventListener("mouseenter", () => this._expand());
    el.addEventListener("mouseleave", () => this._collapse());

    el.querySelector(".sgz-tray-strip").addEventListener("wheel", (ev) => {
      ev.preventDefault();
      this.peekOffset = Math.max(0,
        Math.min(this.peekOffset + (ev.deltaY > 0 ? 1 : -1),
          Math.max(0, (this.hand?.cards.size ?? 0) - 1))
      );
      this._updateStrip();
      this._updatePeek();
    }, { passive: false });
  }

  _expand() {
    this.expanded = true;
    this.el?.classList.add("sgz-expanded");
  }

  _collapse() {
    this.expanded = false;
    this.el?.classList.remove("sgz-expanded");
    this._updatePeek();
  }

  _updateStrip() {
    const count = this.hand?.cards.size ?? 0;
    const strip = this.el?.querySelector(".sgz-tray-count");
    if (strip) strip.textContent = `${count} card${count !== 1 ? "s" : ""}`;
  }

  _updatePeek() {
    if (!this.el || this.expanded) return;
    const existing = this.el.querySelector(".sgz-peek-card");
    existing?.remove();
    if (!this.hand?.cards.size) return;
    const cards = Array.from(this.hand.cards);
    const card = cards[Math.min(this.peekOffset, cards.length - 1)];
    if (!card) return;
    const peek = document.createElement("div");
    peek.className = "sgz-peek-card";
    peek.textContent = card.name?.slice(0, 1) ?? "?";
    peek.title = card.name ?? "Card";
    this.el.querySelector(".sgz-tray-strip")?.appendChild(peek);
  }

  // ── Full render ────────────────────────────────────────────────────────────

  _render() {
    if (!this.cardsEl || !this.hand) return;
    this.cardEls.forEach(el => el.remove());
    this.cardEls.clear();
    for (const card of this.hand.cards) {
      this._renderCard(card);
    }
    this._refreshStackBadges();
    this._updateStrip();
    this._updatePeek();
    this._debugDOMSync("after _render");
  }

  _renderCard(card, { fadeIn = false } = {}) {
    this.cardEls.get(card.id)?.remove();

    const pos = card.getFlag(MODULE_NS, HAND_POS_FLAG) || { x: 20 + this.cardEls.size * (CARD_W + 10), y: 20 };

    const el = document.createElement("div");
    el.className = "sgz-hand-card";
    el.dataset.cardId = card.id;
    el.style.left = `${pos.x}px`;
    el.style.top  = `${pos.y}px`;

    const nameEl = document.createElement("div");
    nameEl.className = "sgz-hand-card-name";
    nameEl.textContent = card.name ?? "Card";
    el.appendChild(nameEl);

    if (card.description) {
      const descEl = document.createElement("div");
      descEl.className = "sgz-hand-card-desc";
      descEl.textContent = card.description;
      el.appendChild(descEl);
    }

    const stackId = pos.stackId;
    if (stackId && pos.stackZ !== undefined && pos.stackZ !== null) {
      el.style.zIndex = pos.stackZ;
    }

    this._wireTrayDrag(el, card);
    this._applyCardColor(el, card);
    this._renderCardTorn(el, card);
    this.cardsEl.appendChild(el);
    this.cardEls.set(card.id, el);

    if (fadeIn) {
      el.style.opacity = "0";
      requestAnimationFrame(() => {
        el.style.transition = "opacity 160ms ease";
        el.style.opacity = "1";
        setTimeout(() => { el.style.transition = ""; }, 180);
      });
    }

    dbg("render", `Rendered card "${card.name}" (${card.id}) at x=${pos.x} y=${pos.y} stackId=${stackId ?? "none"} stackZ=${pos.stackZ ?? "n/a"}`);
  }

  /** Apply (or clear) the freeform color tag as the card element's border color */
  /** Which quadrant of the card (in DOM box coords, origin top-left) a click falls in */
  _cornerAt(local) {
    return (local.y < CARD_H / 2 ? "t" : "b") + (local.x < CARD_W / 2 ? "l" : "r");
  }

  /** Tear one corner (idempotent — no-op if already torn) */
  async _tearCorner(card, corner) {
    const current = card.getFlag(MODULE_NS, TORN_FLAG_KEY) || [];
    if (current.includes(corner)) return;
    await card.setFlag(MODULE_NS, TORN_FLAG_KEY, [...current, corner]);
  }

  /** Restore one corner (idempotent — no-op if already intact) */
  async _restoreCorner(card, corner) {
    const current = card.getFlag(MODULE_NS, TORN_FLAG_KEY) || [];
    if (!current.includes(corner)) return;
    await card.setFlag(MODULE_NS, TORN_FLAG_KEY, current.filter(c => c !== corner));
  }

  /** Advance the card's color tag through the preset palette, then back to "none" */
  async _cycleCardColor(card) {
    const current = card.getFlag(MODULE_NS, COLOR_FLAG_KEY);
    const idx = PRESET_COLORS.indexOf(current);
    const next = idx === -1 ? PRESET_COLORS[0] : (idx === PRESET_COLORS.length - 1 ? null : PRESET_COLORS[idx + 1]);
    await card.setFlag(MODULE_NS, COLOR_FLAG_KEY, next);
  }

  _applyCardColor(el, card) {
    const color = card.getFlag(MODULE_NS, COLOR_FLAG_KEY);
    el.style.borderColor = color != null ? colorNumToCss(color) : "";
  }

  /**
   * Redraw a card's torn corners as an SVG overlay, scaled down from
   * card-table.js's coordinate space. Torn state is per-card-document data
   * (not per-surface), so a corner torn on the canvas shows torn here too,
   * and vice versa — the card carries its damage with it.
   */
  _renderCardTorn(el, card) {
    el.querySelector(".sgz-hand-card-torn")?.remove();
    const torn = card.getFlag(MODULE_NS, TORN_FLAG_KEY) || [];
    if (!torn.length) return;

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "sgz-hand-card-torn");
    svg.setAttribute("width", CARD_W);
    svg.setAttribute("height", CARD_H);

    const zone = CORNER_ZONE * SCALE;
    const inset = CORNER_INSET * SCALE;
    const corners = {
      tl: [[inset, inset], [inset + zone, inset], [inset, inset + zone]],
      tr: [[CARD_W - inset, inset], [CARD_W - inset - zone, inset], [CARD_W - inset, inset + zone]],
      bl: [[inset, CARD_H - inset], [inset + zone, CARD_H - inset], [inset, CARD_H - inset - zone]],
      br: [[CARD_W - inset, CARD_H - inset], [CARD_W - inset - zone, CARD_H - inset], [CARD_W - inset, CARD_H - inset - zone]],
    };
    for (const c of torn) {
      const tri = corners[c];
      if (!tri) continue;
      const poly = document.createElementNS(svgNS, "polygon");
      poly.setAttribute("points", tri.map(p => p.join(",")).join(" "));
      poly.setAttribute("fill", "#000000");
      svg.appendChild(poly);
    }
    el.appendChild(svg);
  }

  // ── Stack badge refresh ───────────────────────────────────────────────────
  // Called after any render/add/remove to update count badges and hide
  // non-top stacked cards. Only the card with the highest z-index in a
  // stack is visible; the others have visibility:hidden so they still
  // occupy the event target but don't draw.

  _refreshStackBadges(excludeCardId = null, { persist = true } = {}) {
    // Group cardEls by stackId, keeping each member's persisted position flag
    // (stackZ lives there, not in DOM style — DOM z-index is only a rendering
    // side-effect of it).
    const groups = new Map(); // stackId → [{id, el, card, pos}]
    for (const [id, el] of this.cardEls) {
      if (id === excludeCardId) continue;
      const c = this.hand?.cards.get(id);
      const pos = c?.getFlag(MODULE_NS, HAND_POS_FLAG);
      const sid = pos?.stackId;
      if (!sid) {
        // Not stacked — ensure visible, remove any orphan badge
        el.style.visibility = "";
        this._removeStackBadge(el);
        continue;
      }
      if (!groups.has(sid)) groups.set(sid, []);
      groups.get(sid).push({ id, el, card: c, pos });
    }

    for (const [, members] of groups) {
      // If only 1 card remains in the stack, dissolve it — clear badge and
      // treat it as an individual card again.
      if (members.length <= 1) {
        const lone = members[0];
        if (lone) {
          lone.el.style.visibility = "";
          this._removeStackBadge(lone.el);
          if (persist && lone.pos.stackId) {
            lone.card.setFlag(MODULE_NS, HAND_POS_FLAG, { ...lone.pos, stackId: null, stackZ: null });
          }
        }
        continue;
      }

      const top = members.reduce((a, b) => (b.pos.stackZ ?? 0) > (a.pos.stackZ ?? 0) ? b : a);
      for (const m of members) {
        const isTop = m === top;
        m.el.style.visibility = isTop ? "" : "hidden";
        if (isTop) this._setStackBadge(m.el, members.length);
        else this._removeStackBadge(m.el);
      }
    }
  }

  /** Attach/update a floating count badge above a stack's top card element, creating it if needed */
  _setStackBadge(el, count) {
    let badge = el.querySelector(".sgz-stack-badge");
    if (!badge) {
      badge = document.createElement("div");
      badge.className = "sgz-stack-badge";
      el.appendChild(badge);
    }
    badge.textContent = `${count}`;
  }

  /** Remove a card element's stack badge, if any */
  _removeStackBadge(el) {
    el.querySelector(".sgz-stack-badge")?.remove();
  }

  // ── Tray-internal drag ─────────────────────────────────────────────────────

  _wireTrayDrag(el, card) {
    el.addEventListener("contextmenu", (ev) => {
      if (!ev.shiftKey) return; // no other right-click behavior defined for hand cards
      ev.preventDefault();
      const rect = el.getBoundingClientRect();
      const corner = this._cornerAt({ x: ev.clientX - rect.left, y: ev.clientY - rect.top });
      this._restoreCorner(card, corner);
    });

    // Only one of {group drag, single drag} is ever active per mousedown —
    // decided immediately from modifier keys at mousedown time, not from a
    // timing heuristic (an earlier long-press-based version was fragile:
    // real pointer jitter and frame hitches fought the timer).
    let dragging = false;
    let offsetX, offsetY;

    el.addEventListener("mousedown", (ev) => {
      if (ev.button !== 0) return;

      if (ev.shiftKey && (ev.ctrlKey || ev.metaKey)) {
        // Shift+Ctrl+drag: grab the whole stack together. (Not Alt+drag —
        // Alt+mouse gestures get intercepted by the OS/browser on enough
        // platforms — window-move on several Linux desktops, menu-access-key
        // handling on Windows/Firefox — that it isn't reliable. Shift and
        // Ctrl are both already proven to reach us cleanly on their own.)
        const pos = card.getFlag(MODULE_NS, HAND_POS_FLAG) || {};
        const stackId = pos.stackId;
        if (stackId) {
          const stackCards = Array.from(this.hand?.cards ?? [])
            .filter(c => c.getFlag(MODULE_NS, HAND_POS_FLAG)?.stackId === stackId);
          if (stackCards.length >= 2) {
            ev.preventDefault();
            this._startTrayGroupDrag(el, ev, stackCards);
            return;
          }
        }
        // Not actually part of a multi-card stack — fall through to a normal
        // single-card drag below rather than doing nothing.
      } else if (ev.ctrlKey || ev.metaKey) {
        // Ctrl(+Cmd)+left-click: cycle the card's color tag. Never starts a drag.
        ev.preventDefault();
        this._cycleCardColor(card);
        return;
      } else if (ev.shiftKey) {
        // Shift+left-click: tear whichever corner was clicked. Never starts a drag.
        ev.preventDefault();
        const rect = el.getBoundingClientRect();
        const corner = this._cornerAt({ x: ev.clientX - rect.left, y: ev.clientY - rect.top });
        this._tearCorner(card, corner);
        return;
      }
      ev.preventDefault();

      const rect = el.getBoundingClientRect();
      offsetX = ev.clientX - rect.left;
      offsetY = ev.clientY - rect.top;

      dbg("drag", `mousedown on "${card.name}" at client(${ev.clientX}, ${ev.clientY})`);

      // Reveal the next card in the stack right away, since this drag is
      // about to peel this one off and leave the rest behind.
      const pickupPos = card.getFlag(MODULE_NS, HAND_POS_FLAG);
      if (pickupPos?.stackId) {
        this._refreshStackBadges(card.id, { persist: false });
      }

      // ── Normal single-card drag ────────────────────────────────────────────
      dragging = true;
      el.classList.add("sgz-dragging");
      el.style.zIndex = 9999;

      const onMove = (mv) => {
        if (!dragging) return;
        const trayRect = this.cardsEl.getBoundingClientRect();
        const newX = mv.clientX - trayRect.left - offsetX;
        const newY = mv.clientY - trayRect.top  - offsetY;
        el.style.left = `${newX}px`;
        el.style.top  = `${newY}px`;
        const trayTop = this.el.getBoundingClientRect().top;
        el.classList.toggle("sgz-will-drop-canvas", mv.clientY < trayTop);
      };

      const onUp = async (up) => {
        if (!dragging) return;
        dragging = false;
        el.classList.remove("sgz-dragging", "sgz-will-drop-canvas");
        el.style.zIndex = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);

        const trayTop = this.el.getBoundingClientRect().top;
        dbg("drag", `onUp: client(${up.clientX}, ${up.clientY}), trayTop=${trayTop}, drop=${up.clientY < trayTop ? "canvas" : "tray"}`);

        if (up.clientY < trayTop) {
          await this._dropToCanvas(card, up.clientX, up.clientY);
        } else {
          const trayRect = this.cardsEl.getBoundingClientRect();
          const newX = up.clientX - trayRect.left - offsetX;
          const newY = up.clientY - trayRect.top  - offsetY;
          await this._persistHandPos(card, newX, newY);
        }

        this._debugDOMSync("after single-card drop");
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    // ── Mousewheel: cycle z-index within a stack ───────────────────────────
    el.addEventListener("wheel", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const pos = card.getFlag(MODULE_NS, HAND_POS_FLAG) || {};
      const stackId = pos.stackId;
      if (!stackId) {
        dbg("wheel", `Wheel on "${card.name}" — no stackId, skipping`);
        return;
      }

      const stackCards = Array.from(this.hand?.cards ?? [])
        .filter(c => c.getFlag(MODULE_NS, HAND_POS_FLAG)?.stackId === stackId)
        .sort((a, b) => (a.getFlag(MODULE_NS, HAND_POS_FLAG)?.stackZ ?? 0) - (b.getFlag(MODULE_NS, HAND_POS_FLAG)?.stackZ ?? 0));

      dbg("wheel", `Stack "${stackId}": ${stackCards.length} cards, stackZ before:`, stackCards.map(c => c.getFlag(MODULE_NS, HAND_POS_FLAG)?.stackZ));

      dbgAssert(stackCards.length >= 2, "wheel",
        `Stack has ${stackCards.length} cards — cycling valid`,
        `Stack has only ${stackCards.length} card — nothing to cycle`
      );

      if (stackCards.length < 2) return;

      // Reassign clean sequential z 1..n every cycle — this also self-heals
      // any degenerate/duplicate stackZ values left over from older data.
      let zVals = stackCards.map((_, i) => i + 1);
      if (ev.deltaY > 0) {
        zVals.push(zVals.shift()); // bottom card → top
      } else {
        zVals.unshift(zVals.pop()); // top card → bottom
      }

      for (let i = 0; i < stackCards.length; i++) {
        const c = stackCards[i];
        const p = c.getFlag(MODULE_NS, HAND_POS_FLAG) || {};
        await c.setFlag(MODULE_NS, HAND_POS_FLAG, { ...p, stackZ: zVals[i] });
      }
      this._refreshStackBadges();

      dbg("wheel", `Stack "${stackId}" stackZ after:`, zVals);
    }, { passive: false });
  }

  /** Shift+Ctrl+drag: pick up every member of a hand stack together and move them as one unit */
  _startTrayGroupDrag(el, initialEv, stackCards) {
    const stackEls = stackCards.map(c => this.cardEls.get(c.id)).filter(Boolean);
    dbgAssert(stackCards.length >= 2, "drag/group",
      `Stack has ${stackCards.length} cards — group drag valid`,
      `Stack has only ${stackCards.length} card(s) — group drag is a no-op`
    );

    const groupOffsets = stackEls.map(sel => {
      const sr = sel.getBoundingClientRect();
      return { el: sel, ox: initialEv.clientX - sr.left, oy: initialEv.clientY - sr.top };
    });

    stackEls.forEach(sel => { sel.classList.add("sgz-dragging"); sel.style.zIndex = 9999; });
    el.classList.add("sgz-stack-dragging");

    const onGroupMove = (mv) => {
      const tr = this.cardsEl.getBoundingClientRect();
      groupOffsets.forEach(({ el: sel, ox, oy }) => {
        sel.style.left = `${mv.clientX - tr.left - ox}px`;
        sel.style.top  = `${mv.clientY - tr.top  - oy}px`;
      });
      const trayTop = this.el.getBoundingClientRect().top;
      stackEls.forEach(sel => sel.classList.toggle("sgz-will-drop-canvas", mv.clientY < trayTop));
    };

    const onGroupUp = async (up) => {
      stackEls.forEach(sel => {
        sel.classList.remove("sgz-dragging", "sgz-will-drop-canvas", "sgz-stack-dragging");
        sel.style.zIndex = "";
      });
      document.removeEventListener("mousemove", onGroupMove);
      document.removeEventListener("mouseup", onGroupUp);

      dbg("drag/group", `Group drop at client(${up.clientX}, ${up.clientY})`);

      const trayTop = this.el.getBoundingClientRect().top;
      const tr = this.cardsEl.getBoundingClientRect();

      for (let i = 0; i < stackCards.length; i++) {
        const sc = stackCards[i];
        const { ox, oy } = groupOffsets[i];
        if (up.clientY < trayTop) {
          await this._dropToCanvas(sc, up.clientX - ox + CARD_W / 2, up.clientY - oy + CARD_H / 2);
        } else {
          const nx = up.clientX - tr.left - groupOffsets[i].ox;
          const ny = up.clientY - tr.top  - groupOffsets[i].oy;
          const current = sc.getFlag(MODULE_NS, HAND_POS_FLAG) || {};
          await sc.setFlag(MODULE_NS, HAND_POS_FLAG, { ...current, x: nx, y: ny });
        }
      }

      this._debugDOMSync("after group drop");
    };

    document.addEventListener("mousemove", onGroupMove);
    document.addEventListener("mouseup", onGroupUp);
  }

  // ── Canvas drop ────────────────────────────────────────────────────────────

  async _dropToCanvas(card, clientX, clientY) {
    const pile = game.cards.find(c => c.getFlag(MODULE_NS, TABLE_PILE_FLAG));
    if (!pile) {
      ui.notifications.warn("Stargazer | No table pile found. Ask the GM to initialise the card table.");
      return;
    }

    const canvasPos = canvas.stage.toLocal({ x: clientX, y: clientY });
    dbg("drop/canvas", `Dropping "${card.name}" to canvas at canvas(${canvasPos.x.toFixed(0)}, ${canvasPos.y.toFixed(0)})`);

    // Snap onto whatever's under the drop point, exactly like an internal
    // canvas drag would — lets a hand card join a table stack on arrival.
    const layer = canvas.stargazerCards;
    let x = canvasPos.x, y = canvasPos.y, stackId = null, stackZ = null;
    const snap = layer?._findSnapTarget?.(x, y, new Set());
    if (snap) {
      x = snap.x;
      y = snap.y;
      const oPos = snap.other.getFlag(MODULE_NS, POS_FLAG_KEY) || {};
      stackId = oPos.stackId ?? `stack-${Date.now()}`;
      if (!oPos.stackId) {
        await snap.other.setFlag(MODULE_NS, POS_FLAG_KEY, { ...oPos, stackId, stackZ: oPos.stackZ ?? 0 });
      }
      stackZ = layer._nextStackZ(stackId, null);
    }

    try {
      // pass()'s updateData forwarding and return value are both unreliable
      // in this Foundry version — the same quirk already noted for
      // Cards.deal() elsewhere in this module ("does not reliably return
      // dealt card data across versions"). Trusting updateData here caused
      // the create step to fail *after* the card had already been removed
      // from the hand — i.e. the card vanishing. Snapshot ids before/after
      // instead, exactly like dealTestCards does, then set the flag as a
      // separate, verified step once we actually have the new document.
      const idsBefore = new Set(pile.cards.map(c => c.id));
      await card.parent.pass(pile, [card.id]);
      const newCard = pile.cards.find(c => !idsBefore.has(c.id));
      if (!newCard) {
        console.error("Stargazer | HandTray._dropToCanvas: pass() completed but no new card was found in the table pile.");
        ui.notifications.error("Stargazer | Card moved but couldn't be placed — check the console.");
        return;
      }
      await newCard.setFlag(MODULE_NS, POS_FLAG_KEY, { x, y, rotation: 0, faceUp: true, stackId, stackZ });
    } catch (err) {
      console.error("Stargazer | HandTray._dropToCanvas failed:", err);
      ui.notifications.error("Stargazer | Failed to move card to canvas.");
    }
  }

  // ── Position persistence + snap ────────────────────────────────────────────

  /**
   * Find an existing hand card whose bbox overlaps the given point's
   * card-sized box by at least MIN_OVERLAP_FRACTION in both axes. Mirrors
   * CardTableLayer._findSnapTarget — a brushing/slight overlap deliberately
   * does not count.
   */
  _findHandSnapTarget(x, y, excludeCardIds = new Set()) {
    const ax1 = x, ay1 = y, ax2 = x + CARD_W, ay2 = y + CARD_H;
    const minOverlapX = CARD_W * MIN_OVERLAP_FRACTION;
    const minOverlapY = CARD_H * MIN_OVERLAP_FRACTION;
    for (const [otherId] of this.cardEls) {
      if (excludeCardIds.has(otherId)) continue;
      const other = this.hand?.cards.get(otherId);
      const otherPos = other?.getFlag(MODULE_NS, HAND_POS_FLAG);
      if (!otherPos) continue;
      const bx1 = otherPos.x, by1 = otherPos.y, bx2 = otherPos.x + CARD_W, by2 = otherPos.y + CARD_H;
      const overlapX = Math.min(ax2, bx2) - Math.max(ax1, bx1);
      const overlapY = Math.min(ay2, by2) - Math.max(ay1, by1);
      if (overlapX >= minOverlapX && overlapY >= minOverlapY) {
        return { other, x: otherPos.x, y: otherPos.y };
      }
    }
    return null;
  }

  /**
   * Compute placement for a card arriving from outside the tray (e.g. passed
   * from the canvas table): snap onto whatever's at the drop point exactly
   * like an internal drag would, giving an un-stacked target a fresh
   * stackId. Returns {x, y, stackId, stackZ} — the caller bakes this into
   * the incoming card's own flags (it doesn't exist in this hand yet, so it
   * can't be looked up or mutated directly here).
   */
  async computeIncomingDropPlacement(x, y) {
    const snap = this._findHandSnapTarget(x, y);
    let stackId = null;
    let snappedX = x, snappedY = y;

    if (snap) {
      snappedX = snap.x;
      snappedY = snap.y;
      const targetPos = snap.other.getFlag(MODULE_NS, HAND_POS_FLAG) || {};
      stackId = targetPos.stackId ?? `stack-${Date.now()}`;
      if (!targetPos.stackId) {
        const cz = targetPos.stackZ ?? this._nextStackZ(stackId);
        await snap.other.setFlag(MODULE_NS, HAND_POS_FLAG, { ...targetPos, x: snappedX, y: snappedY, stackId, stackZ: cz });
      }
    }

    const stackZ = stackId ? this._nextStackZ(stackId) : null;
    return { x: snappedX, y: snappedY, stackId, stackZ };
  }

  async _persistHandPos(card, x, y) {
    // Snap detection: does the card's new tray-relative bbox genuinely
    // overlap another card's bbox by MIN_OVERLAP_FRACTION? Card-to-card, not
    // cursor-to-center, so it works regardless of where on the card the user
    // grabbed it. A passing/slight overlap deliberately does not snap.
    let stackId = null;

    const snap = this._findHandSnapTarget(x, y, new Set([card.id]));
    const targetCard = snap?.other ?? null;
    let snappedX = snap?.x ?? x, snappedY = snap?.y ?? y;

    if (targetCard) {
      // Determine the winning stackId: prefer an existing stack on the target,
      // then an existing stack on the dragged card, then create a new one.
      const targetStack = targetCard.getFlag(MODULE_NS, HAND_POS_FLAG)?.stackId;
      const draggedStack = card.getFlag(MODULE_NS, HAND_POS_FLAG)?.stackId;
      stackId = targetStack ?? draggedStack ?? `stack-${Date.now()}`;

      dbg("snap", `"${card.name}" snapping to "${targetCard.name}" → stackId="${stackId}" (targetStack=${targetStack}, draggedStack=${draggedStack})`);

      // Collect every card that needs to move to this stackId:
      //  - all members of draggedStack (the card being dragged and its former stack-mates)
      //  - the target card if it had no stack yet
      const toMigrate = new Map(); // cardId → card doc

      if (draggedStack && draggedStack !== stackId) {
        // Re-home all former stack-mates of the dragged card
        for (const c of this.hand.cards) {
          if (c.getFlag(MODULE_NS, HAND_POS_FLAG)?.stackId === draggedStack) {
            toMigrate.set(c.id, c);
          }
        }
      }
      // Ensure the target gets a stackId if it didn't have one
      if (!targetStack) toMigrate.set(targetCard.id, targetCard);
      // The dragged card itself is handled below (final setFlag)
      toMigrate.delete(card.id);

      for (const [, c] of toMigrate) {
        const p = c.getFlag(MODULE_NS, HAND_POS_FLAG) || {};
        // Normalize onto the anchor position too, so if this member is later
        // promoted to top (because the current top leaves) it doesn't jump.
        const cz = p.stackZ ?? this._nextStackZ(stackId);
        dbg("snap", `  migrating "${c.name}" → stackId="${stackId}"`);
        await c.setFlag(MODULE_NS, HAND_POS_FLAG, { ...p, x: snappedX, y: snappedY, stackId, stackZ: cz });
      }
    }

    const finalX = stackId ? snappedX : x;
    const finalY = stackId ? snappedY : y;
    const current = card.getFlag(MODULE_NS, HAND_POS_FLAG) || {};
    // Explicitly null stackId/stackZ when card is dropped without snapping —
    // this dissolves it from its former stack so _refreshStackBadges can clean up.
    // The dragged card becomes the new top of the stack it joins.
    const stackZ = stackId ? this._nextStackZ(stackId) : null;
    await card.setFlag(MODULE_NS, HAND_POS_FLAG, { ...current, x: finalX, y: finalY, stackId: stackId ?? null, stackZ });
    const el = this.cardEls.get(card.id);
    if (el) {
      // Only ease when the snap point differs from where the pointer let go
      // (i.e. it's actually snapping onto a stack) — a plain drop lands
      // exactly under the cursor and shouldn't animate.
      const snapped = (finalX !== x || finalY !== y);
      if (snapped) this._easeCardTo(el, finalX, finalY);
      else { el.style.left = `${finalX}px`; el.style.top = `${finalY}px`; }
    }
    this._refreshStackBadges();
  }

  /** Animate a hand-tray card element to a new left/top, then clear the transition so drags stay 1:1 with the cursor */
  _easeCardTo(el, x, y, duration = 140) {
    el.style.transition = `left ${duration}ms ease, top ${duration}ms ease`;
    requestAnimationFrame(() => {
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    });
    setTimeout(() => { el.style.transition = ""; }, duration + 20);
  }

  /** Highest stackZ currently in use by a stack, +1 — newly placed/migrated card becomes top */
  _nextStackZ(stackId) {
    let max = 0;
    for (const c of (this.hand?.cards ?? [])) {
      const p = c.getFlag(MODULE_NS, HAND_POS_FLAG);
      if (p?.stackId === stackId) max = Math.max(max, p.stackZ ?? 0);
    }
    return max + 1;
  }

  // ── React to document updates ──────────────────────────────────────────────

  async onCardAdded(card) {
    if (card.parent?.id !== this.hand?.id) return;
    dbg("hook/createCard", `Card added to hand: "${card.name}" (${card.id})`);

    this._pendingAdd?.delete(card.id);
    this._renderCard(card, { fadeIn: true });
    this._refreshStackBadges();
    this._updateStrip();
    this._updatePeek();
    this._expand();
    this._debugDOMSync("after onCardAdded");

    // Clear a stale stackId (leftover from a stack with no peers in this
    // hand) without blocking the render above on the round trip — a prior
    // version awaited this first, which delayed rendering during batch
    // creates and produced transient DOM-out-of-sync warnings.
    const existingPos = card.getFlag(MODULE_NS, HAND_POS_FLAG);
    if (existingPos?.stackId) {
      const peersExist = Array.from(this.hand.cards).some(c =>
        c.id !== card.id &&
        c.getFlag(MODULE_NS, HAND_POS_FLAG)?.stackId === existingPos.stackId
      );
      if (!peersExist) {
        dbg("hook/createCard", `Clearing stale stackId "${existingPos.stackId}" on "${card.name}" — no peers`);
        card.setFlag(MODULE_NS, HAND_POS_FLAG, { ...existingPos, stackId: null, stackZ: null });
      }
    }
  }

  onCardUpdated(card) {
    if (card.parent?.id !== this.hand?.id) return;
    const el = this.cardEls.get(card.id);
    const pos = card.getFlag(MODULE_NS, HAND_POS_FLAG) || {};

    if (el) {
      if (pos.x !== undefined) el.style.left = `${pos.x}px`;
      if (pos.y !== undefined) el.style.top  = `${pos.y}px`;
      this._applyCardColor(el, card);
      this._renderCardTorn(el, card);
      const nameEl = el.querySelector(".sgz-hand-card-name");
      if (nameEl && nameEl.textContent !== (card.name ?? "Card")) {
        dbg("hook/updateCard", `Name changed on "${card.name}" — full re-render`);
        this._renderCard(card);
      }
      return;
    }
    // Card exists in hand but not in DOM — render it now.
    dbg("hook/updateCard", `Card "${card.name}" (${card.id}) in hand but missing from DOM — rendering`);
    this._renderCard(card, { fadeIn: true });
    this._updateStrip();
    this._updatePeek();
    this._debugDOMSync("after onCardUpdated fallthrough");
  }

  onCardRemoved(cardId) {
    dbg("hook/deleteCard", `Card removed from hand: ${cardId}`);
    this.cardEls.get(cardId)?.remove();
    this.cardEls.delete(cardId);
    this._refreshStackBadges();
    this._updateStrip();
    this._updatePeek();
  }

  // ── Hook wiring ────────────────────────────────────────────────────────────

  _bindHooks() {
    // Track cards currently being added (between createCard and first updateCard)
    // to prevent onCardUpdated from double-rendering during the setFlag in onCardAdded.
    this._pendingAdd = new Set();

    Hooks.on("createCard", (card) => {
      dbg("hook/createCard", `Fired: "${card.name}" parent=${card.parent?.id} hand=${this.hand?.id} match=${card.parent?.id === this.hand?.id}`);
      if (card.parent?.id === this.hand?.id) this._pendingAdd.add(card.id);
      this.onCardAdded(card);
    });

    Hooks.on("updateCard", (card, diff) => {
      dbg("hook/updateCard", `Fired: "${card.name}" parent=${card.parent?.id} hand=${this.hand?.id} match=${card.parent?.id === this.hand?.id}`, diff);
      if (this._pendingAdd?.has(card.id)) {
        dbg("hook/updateCard", `Skipping — card "${card.name}" is mid-add`);
        return;
      }
      this.onCardUpdated(card);
    });

    Hooks.on("deleteCard", (card) => {
      dbg("hook/deleteCard", `Fired: ${card.id} parent=${card.parent?.id} hand=${this.hand?.id} match=${card.parent?.id === this.hand?.id}`);
      // Guard: deleteCard fires on the SOURCE when a card is passed OUT of a
      // collection. If the card's parent is the pile (not the hand), ignore it —
      // that's the pile cleaning up after pass(), not the hand losing a card.
      if (card.parent?.id !== this.hand?.id) {
        dbg("hook/deleteCard", `Ignoring — parent is not the hand`);
        return;
      }
      this.onCardRemoved(card.id);
    });

    // Bug 1 fix: pass() fires updateCards on the destination Hand document.
    // Log exactly what arrives so we can verify the hand ID matches.
    Hooks.on("updateCards", (cards, diff) => {
      dbg("hook/updateCards", `Fired on "${cards.name}" (${cards.id}) type=${cards.type} isHand=${cards.id === this.hand?.id} cardCount=${cards.cards.size}`, diff);
      if (cards.id !== this.hand?.id) return;

      // Sync DOM: add any cards now in the hand that aren't rendered yet
      for (const card of cards.cards) {
        if (!this.cardEls.has(card.id)) {
          dbg("hook/updateCards", `Card "${card.name}" (${card.id}) in hand but not in DOM — rendering`);
          this._renderCard(card, { fadeIn: true });
        }
      }
      // Remove any cards that left the hand
      for (const [id, el] of this.cardEls) {
        if (!cards.cards.has(id)) {
          dbg("hook/updateCards", `Card ${id} no longer in hand — removing from DOM`);
          el.remove();
          this.cardEls.delete(id);
        }
      }
      this._updateStrip();
      this._updatePeek();
      this._expand();
      this._debugDOMSync("after updateCards");
    });
  }

  // ── Debug helpers ──────────────────────────────────────────────────────────

  _debugDOMSync(context = "") {
    if (!SGZ_DEBUG) return;
    const handCount = this.hand?.cards.size ?? 0;
    const mapCount  = this.cardEls.size;
    const domCount  = this.cardsEl?.querySelectorAll(".sgz-hand-card").length ?? 0;
    const ok = handCount === mapCount && mapCount === domCount;
    if (ok) {
      dbg("sync", `✅ DOM in sync (${handCount} cards) [${context}]`);
    } else {
      console.warn(`❌ [SGZ:sync] DOM OUT OF SYNC [${context}]`);
      console.warn(`   Hand doc: ${handCount} | cardEls map: ${mapCount} | DOM nodes: ${domCount}`);
      const handIds = new Set(this.hand?.cards.map(c => c.id) ?? []);
      const mapIds  = new Set(this.cardEls.keys());
      const inHandNotMap = [...handIds].filter(id => !mapIds.has(id));
      const inMapNotHand = [...mapIds].filter(id => !handIds.has(id));
      if (inHandNotMap.length) console.warn(`   In hand, not in map:`, inHandNotMap);
      if (inMapNotHand.length) console.warn(`   In map, not in hand:`, inMapNotHand);
    }
  }

  // ── Styles ─────────────────────────────────────────────────────────────────

  _injectStyles() {
    if (document.getElementById("sgz-hand-tray-styles")) return;
    const s = document.createElement("style");
    s.id = "sgz-hand-tray-styles";
    s.textContent = `
#sgz-hand-tray {
  position: fixed;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: ${TRAY_WIDTH_VW}vw;
  z-index: 60;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  pointer-events: auto;
  font-family: "Roboto", sans-serif;
}

.sgz-tray-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: ${TUCK_HEIGHT}px;
  background: rgba(20, 20, 30, 0.92);
  border: 1px solid rgba(255,255,255,0.12);
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  padding: 0 12px;
  cursor: pointer;
  user-select: none;
  gap: 8px;
}

.sgz-tray-count {
  font-size: 0.72rem;
  color: #aaa;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.sgz-tray-hint {
  font-size: 0.65rem;
  color: #666;
}

.sgz-peek-card {
  width: 20px;
  height: 24px;
  background: #2a2a3a;
  border: 1px solid #6a6a8a;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.6rem;
  color: #aaa;
  margin-left: 4px;
}

.sgz-tray-body {
  height: 0;
  overflow: hidden;
  background: rgba(14, 14, 22, 0.96);
  border: 1px solid rgba(255,255,255,0.10);
  border-bottom: none;
  border-top: 1px solid rgba(255,255,255,0.08);
  transition: height 0.18s ease;
}

#sgz-hand-tray.sgz-expanded .sgz-tray-body {
  height: ${TRAY_HEIGHT}px;
}

.sgz-tray-cards {
  position: relative;
  width: 100%;
  height: 100%;
}

.sgz-hand-card {
  position: absolute;
  width: ${CARD_W}px;
  height: ${CARD_H}px;
  background: #f5f0e6;
  border: 2px solid #8a7a5a;
  border-radius: 8px;
  cursor: grab;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 6px;
  box-sizing: border-box;
  user-select: none;
  transition: box-shadow 0.1s, transform 0.1s;
  box-shadow: 0 2px 6px rgba(0,0,0,0.4);
}

.sgz-hand-card:hover {
  box-shadow: 0 4px 14px rgba(0,0,0,0.6);
  transform: translateY(-3px);
  z-index: 10;
}

.sgz-hand-card.sgz-dragging {
  cursor: grabbing;
  box-shadow: 0 8px 24px rgba(0,0,0,0.7);
  transform: rotate(2deg) scale(1.05);
  opacity: 0.9;
}

.sgz-hand-card.sgz-stack-dragging {
  box-shadow: 0 0 0 2px #efda06, 0 8px 24px rgba(0,0,0,0.7);
}

.sgz-hand-card.sgz-will-drop-canvas {
  border-color: #4898f5;
  box-shadow: 0 0 0 2px #4898f5, 0 8px 24px rgba(0,0,0,0.7);
}

.sgz-hand-card-torn {
  position: absolute;
  left: 0;
  top: 0;
  border-radius: 6px; /* matches .sgz-hand-card's border-radius minus its border width */
  overflow: hidden;
  pointer-events: none;
}

.sgz-hand-card-name {
  font-size: 0.78rem;
  font-weight: 700;
  color: #222;
  text-align: center;
  line-height: 1.2;
  word-break: break-word;
}

.sgz-hand-card-desc {
  font-size: 0.62rem;
  color: #555;
  text-align: center;
  margin-top: 4px;
  line-height: 1.3;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.sgz-stack-badge {
  position: absolute;
  top: -20px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(20,20,30,0.85);
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 8px;
  padding: 1px 7px;
  font-size: 0.65rem;
  font-weight: 700;
  color: #ccc;
  letter-spacing: 0.05em;
  white-space: nowrap;
  pointer-events: none;
}
    `;
    document.head.appendChild(s);
  }
}

// ── Module-level singleton + init export ────────────────────────────────────

let _trayInstance = null;

export function initHandTray() {
  Hooks.once("ready", async () => {
    _trayInstance = new HandTray();
    await _trayInstance.init();
  });

  Hooks.on("canvasReady", () => {
    if (_trayInstance) _trayInstance._render();
  });
}

export function getTrayInstance() {
  return _trayInstance;
}
