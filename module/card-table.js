/**
 * Stargazer Card Table — Stage 1
 *
 * Scope of this stage:
 *  - A dedicated canvas layer ("stargazerCards") that renders Card documents
 *    living in a single world Pile ("Table") as draggable PIXI objects.
 *  - Cards can be face-up or face-down (click to flip, GM only for now).
 *  - Position (x/y/rotation) is stored on the Card document itself via flags,
 *    so it persists in the world database and is NOT scene-scoped — cards
 *    stick around across scene changes, exactly like the design doc calls for.
 *  - Dragging updates the Card document, which Foundry syncs to all clients
 *    automatically (no custom socket needed for this part — updateDocument
 *    broadcasts natively).
 *  - A GM-only "Deal Test Cards" scene control creates a deck (if missing),
 *    draws a few cards into the Table pile, and gives them scattered
 *    positions so there's something to drag immediately.
 *
 * Stage 2 addition: dropping a canvas card onto the hand tray passes it
 *   into the player's Hand document via getTrayInstance().
 */

import { getTrayInstance, CARD_W as HAND_CARD_W, CARD_H as HAND_CARD_H } from "./hand-tray.js";

const MODULE_NS = "stargazer";
const TABLE_PILE_FLAG = "isCardTable";
const POS_FLAG_KEY = "cardPos"; // { x, y, rotation, faceUp }
const TORN_FLAG_KEY = "tornCorners"; // ["tl","tr","bl","br"] subset — solid black corner triangles
const COLOR_FLAG_KEY = "cardColor"; // hex number or null — freeform tag color (card border)

// Preset palette cycled through by ctrl+click, matching the consequence-type
// color table: Failure/Black, Harm/Red, Friction/Yellow, Loss/Green,
// Fatigue/Blue, Threat/Purple.
const PRESET_COLORS = [0x1a1a1a, 0xc0392b, 0xd4b90a, 0x2e9e4f, 0x3d7fd6, 0x8e44ad];

// ── Card sprite dimensions (canvas px, independent of grid size) ───────────
const CARD_WIDTH = 140;
const CARD_HEIGHT = 196;
// Cards must overlap by at least this fraction of their own size in BOTH
// axes to snap into a stack — a passing/slight overlap should not stack.
const MIN_OVERLAP_FRACTION = 0.35;
// Visual size (in canvas px, along each edge) of a torn corner's black triangle.
const CORNER_ZONE = 26;
// How far in from the card's true edge the triangle's apex sits, so the
// color-tag border remains visible as a thin frame around each tear.
const CORNER_INSET = 6;

export class CardTableLayer extends CanvasLayer {

  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, {
      name: "stargazerCards",
      zIndex: 290,
    });
  }

  /** Map of Card.id -> PIXI.Container currently rendered on this layer */
  cardSprites = new Map();

  /** The world Pile (Cards document) representing the physical table */
  get tablePile() {
    return game.cards?.find(c => c.getFlag(MODULE_NS, TABLE_PILE_FLAG));
  }

  async _draw() {
    await super._draw();
    // CanvasLayer doesn't intercept events by default — set it to passthrough
    // so children can receive pointer events without needing layer activation.
    this.eventMode = "passive";
    this.interactiveChildren = true;

    this.cardSprites.forEach(c => c.destroy({ children: true }));
    this.cardSprites.clear();

    const pile = this.tablePile;
    if (!pile) return;

    for (const card of pile.cards) {
      this._renderCard(card);
    }
    this._refreshStackVisuals();
  }

  /** Create (or recreate) the PIXI representation of a single Card document */
  _renderCard(card, { fadeIn = false } = {}) {
    this.cardSprites.get(card.id)?.destroy({ children: true });

    const pos = card.getFlag(MODULE_NS, POS_FLAG_KEY) || { x: 100, y: 100, rotation: 0, faceUp: false };

    const container = new PIXI.Container();
    container.x = pos.x;
    container.y = pos.y;
    container.rotation = pos.rotation || 0;
    container.cardId = card.id;
    container.eventMode = "static";
    container.cursor = "pointer";
    container.hitArea = new PIXI.Rectangle(-CARD_WIDTH / 2, -CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT);
    if (fadeIn) container.alpha = 0;

    const bg = new PIXI.Graphics();
    const faceUp = !!pos.faceUp;
    const isStacked = !!pos.stackId;
    container.stargazerFaceUp = faceUp;
    const tagColor = card.getFlag(MODULE_NS, COLOR_FLAG_KEY);
    this._drawCardBg(bg, { faceUp, isStacked, tagColor });
    container.addChild(bg);

    const label = new PIXI.Text(faceUp ? (card.name || "Card") : "🂠", {
      fontFamily: "Roboto, sans-serif",
      fontSize: faceUp ? 16 : 42,
      fill: faceUp ? 0x222222 : 0xcccccc,
      align: "center",
      wordWrap: true,
      wordWrapWidth: CARD_WIDTH - 16,
    });
    label.anchor.set(0.5);
    container.addChild(label);

    if (faceUp && card.description) {
      const desc = new PIXI.Text(card.description, {
        fontFamily: "Roboto, sans-serif",
        fontSize: 11,
        fill: 0x444444,
        align: "center",
        wordWrap: true,
        wordWrapWidth: CARD_WIDTH - 16,
      });
      desc.anchor.set(0.5);
      desc.y = 30;
      container.addChild(desc);
    }

    const overlay = new PIXI.Graphics();
    container.stargazerOverlay = overlay;
    container.addChild(overlay);
    this._drawCardOverlay(container, card);

    this._wireDrag(container, card);

    container.on("rightclick", async (ev) => {
      ev.stopPropagation();
      const native = ev.nativeEvent ?? ev.data?.originalEvent;
      if (native?.shiftKey) {
        const local = ev.getLocalPosition(container);
        await this._restoreCorner(card, this._cornerAt(local));
        return;
      }
      await this._flipCard(card);
    });

    this.addChild(container);
    this.cardSprites.set(card.id, container);

    if (fadeIn) this._animateAlpha(container, 1, 160);
  }

  /** Which quadrant of the card (relative to its center) a container-local point falls in */
  _cornerAt(local) {
    return (local.y < 0 ? "t" : "b") + (local.x < 0 ? "l" : "r");
  }

  /** Shared background draw — used on initial render and on restyle-in-place */
  _drawCardBg(bg, { faceUp, isStacked, tagColor }) {
    bg.clear();
    bg.beginFill(faceUp ? 0xf5f0e6 : 0x2a2a3a, 1);
    // Stack membership (gold ring) takes visual priority over a card's own
    // color tag, matching how it already took priority over the plain
    // face-up/face-down border color.
    const borderColor = isStacked ? 0xd4a017 : (tagColor ?? (faceUp ? 0x8a7a5a : 0x6a6a8a));
    bg.lineStyle(isStacked ? 3 : (tagColor != null ? 3 : 2), borderColor, 1);
    bg.drawRoundedRect(-CARD_WIDTH / 2, -CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT, 10);
    bg.endFill();
  }

  /** Redraw torn-corner triangles on top of a card */
  _drawCardOverlay(container, card) {
    const overlay = container.stargazerOverlay;
    overlay.clear();

    const torn = card.getFlag(MODULE_NS, TORN_FLAG_KEY) || [];
    if (!torn.length) return;

    const w = CARD_WIDTH / 2, h = CARD_HEIGHT / 2;
    // Pull the triangle's apex in from the true corner by CORNER_INSET so the
    // color-tag border (drawn right at the card's edge) stays visible as a
    // thin frame around the tear, instead of being painted over entirely.
    const i = CORNER_INSET;
    const corners = {
      tl: [[-w + i, -h + i], [-w + i + CORNER_ZONE, -h + i], [-w + i, -h + i + CORNER_ZONE]],
      tr: [[w - i, -h + i], [w - i - CORNER_ZONE, -h + i], [w - i, -h + i + CORNER_ZONE]],
      bl: [[-w + i, h - i], [-w + i + CORNER_ZONE, h - i], [-w + i, h - i - CORNER_ZONE]],
      br: [[w - i, h - i], [w - i - CORNER_ZONE, h - i], [w - i, h - i - CORNER_ZONE]],
    };
    overlay.beginFill(0x000000, 1);
    for (const c of torn) {
      const tri = corners[c];
      if (!tri) continue;
      overlay.moveTo(tri[0][0], tri[0][1]);
      overlay.lineTo(tri[1][0], tri[1][1]);
      overlay.lineTo(tri[2][0], tri[2][1]);
      overlay.closePath();
    }
    overlay.endFill();
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

  /** Simple rAF alpha tween — used for new-card fade-in on the table */
  _animateAlpha(container, target, duration) {
    const start = container.alpha;
    const t0 = performance.now();
    const step = (now) => {
      if (!container.parent) return; // destroyed mid-tween
      const t = Math.min(1, (now - t0) / duration);
      container.alpha = start + (target - start) * t;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** Simple rAF position tween — used to ease a dropped card/stack into its final snapped spot */
  _animateTo(container, targetX, targetY, duration = 140) {
    const startX = container.x, startY = container.y;
    const t0 = performance.now();
    const step = (now) => {
      if (!container.parent) return; // destroyed mid-tween
      const t = Math.min(1, (now - t0) / duration);
      container.x = startX + (targetX - startX) * t;
      container.y = startY + (targetY - startY) * t;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /**
   * Drag handling — works for any client; permission check happens before persisting.
   * Plain drag on a card peels just that card off any stack it's part of.
   * Shift+Ctrl+drag on a stacked card instead grabs and moves the whole stack
   * together. This replaces an earlier long-press-based heuristic: holding
   * still for N ms before moving is inherently timing-fragile (real pointer
   * jitter, frame hitches, etc. all fight it) — an explicit modifier held at
   * the moment of pointerdown is unambiguous and never mis-fires.
   */
  _wireDrag(container, card) {
    let dragging = false;
    let dragData = null;
    let lastPos = { x: container.x, y: container.y };
    let lastClientPos = { x: 0, y: 0 };

    container.on("pointerdown", (ev) => {
      ev.stopPropagation();
      const nativeMod = ev.nativeEvent ?? ev.data?.originalEvent;
      const isLeftClick = nativeMod?.button === 0;
      const ctrlHeld = isLeftClick && (nativeMod.ctrlKey || nativeMod.metaKey);
      const shiftHeld = isLeftClick && nativeMod.shiftKey;

      const pos = card.getFlag(MODULE_NS, POS_FLAG_KEY) || {};
      const stackId = pos.stackId;
      const pile = this.tablePile;

      if (ctrlHeld && shiftHeld) {
        // Shift+Ctrl+drag: grab the whole stack together. (Not plain Alt+drag —
        // Alt+mouse gestures get intercepted by the OS/browser on enough
        // platforms — window-move on several Linux desktops, menu-access-key
        // handling on Windows/Firefox — that it isn't reliable here. Shift and
        // Ctrl are both already proven to reach us cleanly.)
        if (stackId && pile) {
          const stackCards = pile.cards.filter(c => c.getFlag(MODULE_NS, POS_FLAG_KEY)?.stackId === stackId);
          if (stackCards.length >= 2) {
            this._startGroupDrag(container, ev, stackCards);
            return;
          }
        }
        // Not actually part of a multi-card stack — fall through to a normal
        // single-card drag below rather than doing nothing.
      } else if (ctrlHeld) {
        // Ctrl(+Cmd)+left-click: cycle the card's color tag. Never starts a drag.
        this._cycleCardColor(card);
        return;
      } else if (shiftHeld) {
        // Shift+left-click: tear whichever corner was clicked. Never starts a drag.
        const local = ev.getLocalPosition(container);
        this._tearCorner(card, this._cornerAt(local));
        return;
      }

      // ── Normal single-card drag — peels this card off any stack it's in ──
      const local = ev.getLocalPosition(this);
      dragData = { offsetX: container.x - local.x, offsetY: container.y - local.y };
      lastPos = { x: container.x, y: container.y };

      // Reveal the next card in the stack immediately on pickup, since this
      // drag is about to leave it behind.
      if (stackId) this._refreshStackVisuals(card.id, { persist: false });

      dragging = true;
      container.alpha = 0.85;
      canvas.stage.on("pointermove", onMove);
      canvas.stage.once("pointerup", onUp);
      canvas.stage.once("pointerupoutside", onUp);
    });

    const onMove = (ev) => {
      if (!dragging) return;
      const local = ev.getLocalPosition(this);
      const newX = local.x + dragData.offsetX;
      const newY = local.y + dragData.offsetY;
      // Guard: container may have been destroyed by a re-render hook mid-drag
      if (!container.parent) return;
      container.x = newX;
      container.y = newY;
      lastPos = { x: newX, y: newY };
      const native = ev.nativeEvent ?? ev.data?.originalEvent;
      if (native) lastClientPos = { x: native.clientX, y: native.clientY };
    };

    const onUp = async (ev) => {
      if (!dragging) return;
      dragging = false;
      if (container.parent) container.alpha = 1;
      canvas.stage.off("pointermove", onMove);

      // Use native client coords captured during move (avoids reading destroyed container)
      const native = ev.nativeEvent ?? ev.data?.originalEvent;
      const clientX = native?.clientX ?? lastClientPos.x;
      const clientY = native?.clientY ?? lastClientPos.y;

      // Check if the pointer ended over the hand tray
      const tray = getTrayInstance();
      const trayEl = tray?.el;
      if (trayEl && clientX && clientY) {
        const trayRect = trayEl.getBoundingClientRect();
        const overTray = clientX >= trayRect.left && clientX <= trayRect.right
                      && clientY >= trayRect.top  && clientY <= trayRect.bottom;
        if (overTray && tray.hand) {
          const pile = canvas.stargazerCards?.tablePile;
          if (pile) {
            try {
              const cardsRect = (tray.cardsEl ?? trayEl).getBoundingClientRect();
              const dropX = clientX - cardsRect.left - HAND_CARD_W / 2;
              const dropY = clientY - cardsRect.top  - HAND_CARD_H / 2;
              const placement = await tray.computeIncomingDropPlacement(dropX, dropY);
              // pass()'s updateData forwarding and return value are both
              // unreliable in this Foundry version — snapshot ids before/
              // after instead (same technique dealTestCards already relies
              // on), then set the flag as a separate, verified step.
              const idsBefore = new Set(tray.hand.cards.map(c => c.id));
              await pile.pass(tray.hand, [card.id]);
              const newCard = tray.hand.cards.find(c => !idsBefore.has(c.id));
              if (newCard) {
                await newCard.setFlag(MODULE_NS, "handPos", placement);
              } else {
                console.error("Stargazer | Failed to find newly-passed card in hand after pass().");
              }
              canvas.stargazerCards?.removeCard(card.id);
              return;
            } catch (err) {
              console.error("Stargazer | Failed to pass card to hand:", err);
            }
          }
        }
      }

      await this._persistPosition(card, lastPos);
    };
  }

  /** Shift+Ctrl+drag: pick up every member of a stack together and move them as one unit */
  _startGroupDrag(container, initialEv, stackCards) {
    const members = stackCards
      .map(c => ({ card: c, container: this.cardSprites.get(c.id) }))
      .filter(m => m.container);
    members.forEach(m => { m.container.alpha = 0.85; m.container.visible = true; });

    const startLocal = initialEv.getLocalPosition(this);
    const groupOffset = { offsetX: container.x - startLocal.x, offsetY: container.y - startLocal.y };
    let lastGroupPos = { x: container.x, y: container.y };
    let lastClientPos = { x: 0, y: 0 };

    const onGroupMove = (mv) => {
      const local2 = mv.getLocalPosition(this);
      const newX = local2.x + groupOffset.offsetX;
      const newY = local2.y + groupOffset.offsetY;
      lastGroupPos = { x: newX, y: newY };
      members.forEach(m => { if (m.container.parent) { m.container.x = newX; m.container.y = newY; } });
      const native = mv.nativeEvent ?? mv.data?.originalEvent;
      if (native) lastClientPos = { x: native.clientX, y: native.clientY };
    };

    const onGroupUp = async (up) => {
      members.forEach(m => { if (m.container.parent) m.container.alpha = 1; });
      canvas.stage.off("pointermove", onGroupMove);

      const native = up.nativeEvent ?? up.data?.originalEvent;
      const clientX = native?.clientX ?? lastClientPos.x;
      const clientY = native?.clientY ?? lastClientPos.y;

      // Whole-stack drop into the hand tray
      const tray = getTrayInstance();
      const trayEl = tray?.el;
      if (trayEl && clientX && clientY) {
        const trayRect = trayEl.getBoundingClientRect();
        const overTray = clientX >= trayRect.left && clientX <= trayRect.right
                      && clientY >= trayRect.top  && clientY <= trayRect.bottom;
        if (overTray && tray.hand) {
          const pile2 = this.tablePile;
          if (pile2) {
            try {
              const ids = members.map(m => m.card.id);
              const cardsRect = (tray.cardsEl ?? trayEl).getBoundingClientRect();
              const dropX = clientX - cardsRect.left - HAND_CARD_W / 2;
              const dropY = clientY - cardsRect.top  - HAND_CARD_H / 2;
              const placement = await tray.computeIncomingDropPlacement(dropX, dropY);
              // All passed members share one stackId so the group arrives
              // in the tray still stacked together, exactly as it was on
              // the table — pass() only applies updateData uniformly, so
              // each member is passed individually for a distinct stackZ.
              const sharedStackId = placement.stackId ?? `stack-${Date.now()}`;
              let z = placement.stackZ ?? 1;
              for (const id of ids) {
                const idsBefore = new Set(tray.hand.cards.map(c => c.id));
                await pile2.pass(tray.hand, [id]);
                const newCard = tray.hand.cards.find(c => !idsBefore.has(c.id));
                if (newCard) {
                  await newCard.setFlag(MODULE_NS, "handPos", { x: placement.x, y: placement.y, stackId: sharedStackId, stackZ: z++ });
                } else {
                  console.error("Stargazer | Failed to find newly-passed card in hand after pass() (group drop).");
                }
              }
              ids.forEach(id => this.removeCard(id));
              return;
            } catch (err) {
              console.error("Stargazer | Failed to pass stack to hand:", err);
            }
          }
        }
      }

      // Otherwise: snap-merge against whatever's under the drop point,
      // then persist the whole stack at that (possibly merged) spot.
      const memberIds = new Set(members.map(m => m.card.id));
      const snap = this._findSnapTarget(lastGroupPos.x, lastGroupPos.y, memberIds);

      let mergeStackId = null;
      let mergeX = lastGroupPos.x, mergeY = lastGroupPos.y;
      if (snap) {
        const oPos = snap.other.getFlag(MODULE_NS, POS_FLAG_KEY);
        mergeX = oPos.x;
        mergeY = oPos.y;
        mergeStackId = oPos.stackId ?? `stack-${Date.now()}`;
        if (!oPos.stackId) {
          await snap.other.setFlag(MODULE_NS, POS_FLAG_KEY, { ...oPos, stackId: mergeStackId, stackZ: 0 });
        }
      }

      const baseZ = mergeStackId ? this._nextStackZ(mergeStackId, null) : 0;
      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        const cur = m.card.getFlag(MODULE_NS, POS_FLAG_KEY) || {};
        await m.card.setFlag(MODULE_NS, POS_FLAG_KEY, {
          ...cur,
          x: mergeX,
          y: mergeY,
          stackId: mergeStackId ?? cur.stackId,
          stackZ: mergeStackId ? baseZ + i : cur.stackZ,
        });
      }
      this._refreshStackVisuals();
    };

    canvas.stage.on("pointermove", onGroupMove);
    canvas.stage.once("pointerup", onGroupUp);
    canvas.stage.once("pointerupoutside", onGroupUp);
  }

  async _persistPosition(card, { x, y }) {
    const current = card.getFlag(MODULE_NS, POS_FLAG_KEY) || {};
    const snap = this._findSnapTarget(x, y, new Set([card.id]));

    let stackId = null;
    let snappedX = x, snappedY = y;

    if (snap) {
      const oPos = snap.other.getFlag(MODULE_NS, POS_FLAG_KEY) || {};
      snappedX = snap.x;
      snappedY = snap.y;
      stackId = oPos.stackId ?? `stack-${Date.now()}`;
      if (!oPos.stackId) {
        await snap.other.setFlag(MODULE_NS, POS_FLAG_KEY, { ...oPos, stackId, stackZ: oPos.stackZ ?? 0 });
      }
      console.log(`[SGZ:snap/canvas] "${card.name}" snapped to "${snap.other.name}" → stackId="${stackId}"`);
    }

    const stackZ = stackId ? this._nextStackZ(stackId, card.id) : null;

    await card.setFlag(MODULE_NS, POS_FLAG_KEY, {
      ...current,
      x: stackId ? snappedX : x,
      y: stackId ? snappedY : y,
      stackId: stackId ?? null,
      stackZ,
    });

    this._refreshStackVisuals();
  }

  /**
   * Find a card whose bbox overlaps the given point's card-sized box by at
   * least MIN_OVERLAP_FRACTION in both axes, excluding any card id in
   * excludeCardIds. Returns { other, x, y } (the target card's own position,
   * i.e. where the dropped card should land) or null if nothing qualifies.
   * A brushing/slight overlap deliberately does NOT count — this requires
   * real, deliberate overlap, not mere proximity.
   */
  _findSnapTarget(x, y, excludeCardIds) {
    const pile = this.tablePile;
    const ax1 = x - CARD_WIDTH / 2,  ay1 = y - CARD_HEIGHT / 2;
    const ax2 = x + CARD_WIDTH / 2,  ay2 = y + CARD_HEIGHT / 2;
    const minOverlapX = CARD_WIDTH * MIN_OVERLAP_FRACTION;
    const minOverlapY = CARD_HEIGHT * MIN_OVERLAP_FRACTION;

    for (const other of (pile?.cards ?? [])) {
      if (excludeCardIds.has(other.id)) continue;
      const oPos = other.getFlag(MODULE_NS, POS_FLAG_KEY);
      if (!oPos) continue;
      const bx1 = oPos.x - CARD_WIDTH / 2,  by1 = oPos.y - CARD_HEIGHT / 2;
      const bx2 = oPos.x + CARD_WIDTH / 2,  by2 = oPos.y + CARD_HEIGHT / 2;

      const overlapX = Math.min(ax2, bx2) - Math.max(ax1, bx1);
      const overlapY = Math.min(ay2, by2) - Math.max(ay1, by1);

      if (overlapX >= minOverlapX && overlapY >= minOverlapY) return { other, x: oPos.x, y: oPos.y };
    }
    return null;
  }

  /** Highest stackZ currently in use by a stack, +1 — newly placed card becomes the visible top */
  _nextStackZ(stackId, excludeCardId) {
    const pile = this.tablePile;
    let max = 0;
    for (const c of (pile?.cards ?? [])) {
      if (c.id === excludeCardId) continue;
      const p = c.getFlag(MODULE_NS, POS_FLAG_KEY);
      if (p?.stackId === stackId) max = Math.max(max, p.stackZ ?? 0);
    }
    return max + 1;
  }

  /**
   * Walk every Card on the table, group by stackId, and ensure only the
   * top-zIndex member of each stack is visible with a floating count badge.
   * Mirrors HandTray._refreshStackBadges — call after any render/move/remove
   * that could change stack membership or size.
   */
  _refreshStackVisuals(excludeCardId = null, { persist = true } = {}) {
    const pile = this.tablePile;
    if (!pile) return;

    const groups = new Map(); // stackId -> [{card, pos, container}]
    for (const card of pile.cards) {
      if (card.id === excludeCardId) continue;
      const pos = card.getFlag(MODULE_NS, POS_FLAG_KEY);
      const sid = pos?.stackId;
      if (!sid) continue;
      const container = this.cardSprites.get(card.id);
      if (!container) continue;
      if (!groups.has(sid)) groups.set(sid, []);
      groups.get(sid).push({ card, pos, container });
    }

    for (const [, members] of groups) {
      if (members.length <= 1) {
        // Stale/dissolved stack — show the lone card and clear its flag.
        const lone = members[0];
        if (lone) {
          lone.container.visible = true;
          this._removeStackBadge(lone.container);
          if (persist && lone.pos.stackId) {
            lone.card.setFlag(MODULE_NS, POS_FLAG_KEY, { ...lone.pos, stackId: null, stackZ: null });
          }
        }
        continue;
      }

      const top = members.reduce((a, b) => (b.pos.stackZ ?? 0) > (a.pos.stackZ ?? 0) ? b : a);
      for (const m of members) {
        const isTop = m === top;
        m.container.visible = isTop;
        if (isTop) this._setStackBadge(m.container, members.length);
        else this._removeStackBadge(m.container);
      }
    }
  }

  /** Attach/update a small floating count badge above a stack's top card container */
  _setStackBadge(container, count) {
    let badge = container.stargazerStackBadge;
    if (!badge) {
      badge = new PIXI.Container();
      const bg = new PIXI.Graphics();
      bg.beginFill(0x14141e, 0.9);
      bg.lineStyle(1, 0xd4a017, 1);
      bg.drawRoundedRect(-18, -12, 36, 20, 6);
      bg.endFill();
      badge.addChild(bg);
      const text = new PIXI.Text("", {
        fontFamily: "Roboto, sans-serif",
        fontSize: 12,
        fontWeight: "700",
        fill: 0xd4a017,
        align: "center",
      });
      text.anchor.set(0.5);
      badge.addChild(text);
      badge.stargazerText = text;
      badge.y = -CARD_HEIGHT / 2 - 14;
      container.addChild(badge);
      container.stargazerStackBadge = badge;
    }
    badge.stargazerText.text = `${count}`;
  }

  /** Remove a container's stack badge, if any */
  _removeStackBadge(container) {
    if (container.stargazerStackBadge) {
      container.stargazerStackBadge.destroy({ children: true });
      container.stargazerStackBadge = null;
    }
  }

  async _flipCard(card) {
    const current = card.getFlag(MODULE_NS, POS_FLAG_KEY) || {};
    await card.setFlag(MODULE_NS, POS_FLAG_KEY, { ...current, faceUp: !current.faceUp });
  }

  /** Re-render a single card when its document updates (called from the updateCard hook) */
  refreshCard(card) {
    if (!this.tablePile || card.parent?.id !== this.tablePile.id) return;

    const existing = this.cardSprites.get(card.id);
    const pos = card.getFlag(MODULE_NS, POS_FLAG_KEY) || {};
    const faceUp = !!pos.faceUp;

    if (existing && existing.stargazerFaceUp === faceUp) {
      // Only position/stack-membership changed (a drag, snap, or unstack) —
      // ease the existing container into place instead of destroying and
      // rebuilding it, so drops and stack joins glide instead of popping.
      this._animateTo(existing, pos.x, pos.y);
      this._restyleStackBorder(existing, card, !!pos.stackId);
      this._drawCardOverlay(existing, card);
    } else {
      this._renderCard(card);
    }
    this._refreshStackVisuals();
  }

  /** Redraw just a container's background/border in place (stack ring, face color, color tag) without rebuilding it */
  _restyleStackBorder(container, card, isStacked) {
    const bg = container.children[0];
    if (!(bg instanceof PIXI.Graphics)) return;
    const faceUp = container.stargazerFaceUp;
    const tagColor = card.getFlag(MODULE_NS, COLOR_FLAG_KEY);
    this._drawCardBg(bg, { faceUp, isStacked, tagColor });
  }

  /** Remove a card's sprite (called from deleteCard hook) */
  removeCard(cardId) {
    this.cardSprites.get(cardId)?.destroy({ children: true });
    this.cardSprites.delete(cardId);
    this._refreshStackVisuals();
  }
}

// ── Setup: register layer, hooks, scene control button ─────────────────────

export function initCardTable() {

  // Register the canvas layer directly — this function is called from inside
  // the system's Hooks.once("init"), so we're already in init context.
  CONFIG.Canvas.layers.stargazerCards = {
    layerClass: CardTableLayer,
    group: "interface",
  };
  console.log("Stargazer | Card table layer registered in CONFIG.Canvas.layers");

  Hooks.on("canvasReady", () => {
    if (!canvas.stargazerCards) {
      console.error(
        "Stargazer | canvas.stargazerCards does not exist after canvasReady. " +
        "The layer registration in CONFIG.Canvas.layers did not take effect — " +
        "check for a name collision or a Foundry version mismatch in the layer API."
      );
      return;
    }
    canvas.stargazerCards.draw();
  });

  // Live updates: a card moved/flipped by anyone re-renders for everyone
  Hooks.on("updateCard", (card) => {
    if (!canvas.stargazerCards) return;
    canvas.stargazerCards.refreshCard(card);
  });

  Hooks.on("createCard", (card) => {
    if (!canvas.stargazerCards) return;
    const pile = canvas.stargazerCards.tablePile;
    if (pile && card.parent?.id === pile.id) {
      canvas.stargazerCards._renderCard(card, { fadeIn: true });
      canvas.stargazerCards._refreshStackVisuals();
    }
  });

  Hooks.on("deleteCard", (card) => {
    if (!canvas.stargazerCards) return;
    canvas.stargazerCards.removeCard(card.id);
  });

  // GM scene control: bootstrap a test deck + table pile, deal a few cards
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;
    if (!controls.tokens?.tools) return;
    controls.tokens.tools.dealTestCards = {
      name: "dealTestCards",
      title: "Deal Test Cards (Stage 1 demo)",
      icon: "fa-solid fa-cards",
      order: Object.keys(controls.tokens.tools).length,
      button: true,
      visible: true,
      onChange: () => dealTestCards(),
    };
  });
}

/** GM-only bootstrap: ensure a Table pile exists, ensure a demo deck exists, draw a few cards onto the table at scattered positions */
async function dealTestCards() {
  if (!game.user.isGM) return ui.notifications.warn("Only the GM can deal test cards.");

  try {
    let pile = game.cards.find(c => c.getFlag(MODULE_NS, TABLE_PILE_FLAG));
    if (!pile) {
      pile = await Cards.create({
        name: "Table",
        type: "pile",
        flags: { [MODULE_NS]: { [TABLE_PILE_FLAG]: true } },
      });
    }

    let deck = game.cards.find(c => c.type === "deck" && c.getFlag(MODULE_NS, "isDemoDeck"));
    if (!deck) {
      deck = await Cards.create({
        name: "Demo Deck",
        type: "deck",
        flags: { [MODULE_NS]: { isDemoDeck: true } },
      });
      const demoCards = ["Harm", "Friction", "Loss", "Fatigue", "Threat"].map((n, i) => ({
        name: n,
        description: `Demo card: ${n}`,
        faces: [{ name: n, img: "icons/svg/card-joker.svg" }],
        face: 0,
        back: { name: "Card Back", img: "icons/svg/card-hand.svg" },
        sort: i,
      }));
      await deck.createEmbeddedDocuments("Card", demoCards);
    }

    // Draw 3 fresh cards from the deck into the Table pile (if deck has cards left)
    const drawCount = Math.min(3, deck.availableCards.length);
    if (drawCount === 0) {
      return ui.notifications.info("Demo deck is empty — recall it from the Cards sidebar to reset.");
    }

    // Cards.deal() does not reliably return the dealt card data across versions —
    // instead, snapshot the pile's card ids before and after, and treat the
    // difference as "newly dealt" so we know which ones to position.
    const idsBefore = new Set(pile.cards.map(c => c.id));
    await deck.deal([pile], drawCount, { how: 0 });
    const newCards = pile.cards.filter(c => !idsBefore.has(c.id));

    if (!newCards.length) {
      ui.notifications.warn("Stargazer | dealTestCards: deal() completed but no new cards were found in the table pile.");
      return;
    }

    if (!canvas.stargazerCards) {
      ui.notifications.error(
        "Stargazer | Cards were dealt to the Table pile, but the card-table canvas layer " +
        "isn't active, so nothing will render. Check the console for a layer registration error."
      );
      console.error("Stargazer | canvas.stargazerCards missing in dealTestCards — see initCardTable's canvasReady diagnostic.");
      return;
    }

    // Scatter the newly drawn cards near the center of the current view
    const center = { x: canvas.stage.pivot.x || 1000, y: canvas.stage.pivot.y || 1000 };
    for (const card of newCards) {
      await card.setFlag(MODULE_NS, POS_FLAG_KEY, {
        x: center.x + (Math.random() - 0.5) * 300,
        y: center.y + (Math.random() - 0.5) * 300,
        rotation: (Math.random() - 0.5) * 0.3,
        faceUp: false,
      });
    }

    ui.notifications.info(`Dealt ${newCards.length} card(s) to the table.`);

  } catch (err) {
    console.error("Stargazer | dealTestCards failed:", err);
    ui.notifications.error(`Stargazer | Deal Test Cards failed: ${err.message} (see console for details)`);
  }
}
