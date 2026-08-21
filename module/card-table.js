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
const DISCARD_PILE_FLAG = "discardForDeckId"; // marks a Cards "pile" doc as a specific deck's discard pile

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
// Inset from the card's top/bottom/side edges that name/description text
// must stay within — keeps both anchored inside the card's own rectangle.
const TEXT_PADDING = 10;

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
    // Cached live document reference — event handlers below read/write through
    // this instead of closing directly over the `card` parameter. Foundry can
    // swap in a fresh Card instance on update, and refreshCard()'s "ease into
    // place" path (position/stack-only changes) intentionally reuses this
    // existing container rather than rebuilding it — so without this cache,
    // every handler here would keep reading flags off the original,
    // increasingly stale object forever. refreshCard() updates this pointer
    // on every update so handlers always see current data.
    container.stargazerCard = card;
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
      wordWrapWidth: CARD_WIDTH - TEXT_PADDING * 2,
    });
    // Face-up: name sits at the top of the card, not centered. Face-down: the
    // card-back glyph stays centered — it's a symbol, not a name, so top-
    // anchoring it would look wrong.
    if (faceUp) {
      label.anchor.set(0.5, 0);
      label.y = -CARD_HEIGHT / 2 + TEXT_PADDING;
    } else {
      label.anchor.set(0.5);
    }
    container.addChild(label);
    // Cached so refreshCard()'s ease-in-place path (position/stack-only
    // updates, no rebuild) can still push a text edit onto the existing
    // sprite — see _refreshCardText. Without this, editing a card via the
    // double-click dialog updates the document but the on-screen card never
    // shows it until something else forces a full _renderCard rebuild.
    container.stargazerNameText = label;
    container.stargazerDescText = null;

    if (faceUp && card.description) {
      const descStyle = new PIXI.TextStyle({
        fontFamily: "Roboto, sans-serif",
        fontSize: 11,
        fill: 0x444444,
        align: "center",
        wordWrap: true,
        wordWrapWidth: CARD_WIDTH - TEXT_PADDING * 2,
        breakWords: true,
      });
      // Description starts right below the (possibly multi-line) name and is
      // truncated to whatever vertical room remains above the card's bottom
      // edge — long descriptions get an ellipsis instead of spilling past
      // the card's own rectangle.
      const descTop = label.y + label.height + 6;
      const descMaxHeight = Math.max(0, (CARD_HEIGHT / 2 - TEXT_PADDING) - descTop);
      const fittedText = this._truncateToFit(card.description, descStyle, descMaxHeight);
      const desc = new PIXI.Text(fittedText, descStyle);
      desc.anchor.set(0.5, 0);
      desc.y = descTop;
      console.log("[SGZ:debug] desc sizing", {
        cardName: card.name,
        labelY: label.y, labelHeight: label.height,
        descTop, descMaxHeight,
        originalLen: (card.description || "").length,
        fittedLen: fittedText.length,
        wasTruncated: fittedText !== card.description,
        descRenderedHeight: desc.height,
        descBottomEdge: desc.y + desc.height,
        cardBottomBoundary: CARD_HEIGHT / 2 - TEXT_PADDING,
        overflowsBy: (desc.y + desc.height) - (CARD_HEIGHT / 2 - TEXT_PADDING),
      });
      container.addChild(desc);
      container.stargazerDescText = desc;
    }

    const overlay = new PIXI.Graphics();
    container.stargazerOverlay = overlay;
    container.addChild(overlay);
    this._drawCardOverlay(container, card);

    this._wireDrag(container, card);

    container.on("rightclick", async (ev) => {
      ev.stopPropagation();
      const native = ev.nativeEvent ?? ev.data?.originalEvent;
      const liveCard = container.stargazerCard;
      if (native?.ctrlKey || native?.metaKey) {
        await this._discardOrDelete(liveCard);
        return;
      }
      if (native?.shiftKey) {
        const local = ev.getLocalPosition(container);
        await this._restoreCorner(liveCard, this._cornerAt(local));
        return;
      }
      await this._flipCard(liveCard);
    });

    // Double-click: open the name/description editor. PIXI has no native
    // dblclick event, so track two pointerdown's within a short window.
    let lastDownAt = 0;
    container.on("pointerdown", () => {
      const now = Date.now();
      if (now - lastDownAt < 350) {
        this._openCardEditor(container.stargazerCard);
        lastDownAt = 0;
      } else {
        lastDownAt = now;
      }
    });

    // Shift+mousewheel over a stack cycles which card sits on top. Only
    // intercept (stopPropagation/preventDefault) once we know it's actually a
    // shift-held wheel over a real stack — otherwise let it fall through to
    // Foundry's normal canvas zoom.
    container.on("wheel", async (ev) => {
      const native = ev.nativeEvent ?? ev.data?.originalEvent;
      if (!native?.shiftKey) return;
      const liveCard = container.stargazerCard;
      const pos = liveCard.getFlag(MODULE_NS, POS_FLAG_KEY) || {};
      const stackId = pos.stackId;
      if (!stackId || !this.tablePile) return;
      ev.stopPropagation();
      native.preventDefault?.();
      await this._cycleStack(stackId, native.deltaY > 0 ? 1 : -1);
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
    // Stack membership is already communicated by the floating count badge
    // (_setStackBadge), so the border itself no longer needs to change when
    // stacked — that was overriding the card's own color tag and hiding it
    // whenever the card sat on top of a stack.
    const borderColor = tagColor ?? (faceUp ? 0x8a7a5a : 0x6a6a8a);
    bg.lineStyle(tagColor != null ? 3 : 2, borderColor, 1);
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

  /**
   * Ctrl+right-click on a card: send it to its source deck's discard pile
   * (created lazily), or delete it outright if it's a standalone card with
   * no deck of origin. `card.origin` is Foundry's own tracking of which
   * Cards document a drawn card came from — it survives being passed
   * between piles/hands, which is also what makes deck.recall() able to
   * pull discarded cards back in later without any extra bookkeeping here.
   */
  async _discardOrDelete(card) {
    const deck = _resolveOriginDeck(card);
    if (!deck) {
      await card.delete();
      return;
    }
    try {
      const discard = await getOrCreateDiscardPile(deck);
      if (card.parent?.id === discard.id) return; // already discarded
      await card.parent.pass(discard, [card.id]);
    } catch (err) {
      console.error("Stargazer | Failed to discard card to deck's discard pile:", err);
      ui.notifications.error("Stargazer | Couldn't discard that card — see console.");
    }
  }

  /** Double-click: edit a card's name/description in place. Instance-only — never touches the deck prototype. */
  _openCardEditor(card) {
    new Dialog({
      title: `Edit Card — ${card.name}`,
      content: `
        <form>
          <div class="form-group">
            <label>Name</label>
            <input type="text" name="name" value="${foundry.utils.escapeHTML(card.name ?? "")}" />
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea name="description" rows="4">${foundry.utils.escapeHTML(card.description ?? "")}</textarea>
          </div>
        </form>`,
      buttons: {
        save: {
          icon: '<i class="fa-solid fa-check"></i>',
          label: "Save",
          callback: async (html) => {
            const nameEl = html.find ? html.find('[name="name"]')[0] : html.querySelector('[name="name"]');
            const descEl = html.find ? html.find('[name="description"]')[0] : html.querySelector('[name="description"]');
            const name = (nameEl?.value ?? "").trim();
            const description = descEl?.value ?? "";
            // card.name is a GETTER that resolves to faces[card.face].name whenever
            // the card has an active face (which every card here does — see
            // _createStandaloneCard's `faces: [{ name, img }], face: 0`). Writing
            // only the top-level `name` field updates data nothing reads from —
            // the face entry has to be updated too, or the display never changes.
            const faces = foundry.utils.deepClone(card.faces ?? []);
            const idx = card.face ?? 0;
            if (faces[idx]) faces[idx].name = name || card.name;
            else faces[idx] = { name: name || card.name, img: "icons/svg/card-joker.svg" };
            try {
              await card.update({ name: name || card.name, faces, description });
            } catch (err) {
              console.error("Stargazer | Failed to save card edit:", err);
              ui.notifications.error("Stargazer | Couldn't save that card edit — see console.");
            }
          },
        },
        cancel: { icon: '<i class="fa-solid fa-xmark"></i>', label: "Cancel" },
      },
      default: "save",
    }).render(true);
  }

  /** Advance the card's color tag through the preset palette, then back to "none" */
  async _cycleCardColor(card) {
    const current = card.getFlag(MODULE_NS, COLOR_FLAG_KEY);
    const idx = PRESET_COLORS.indexOf(current);
    const next = idx === -1 ? PRESET_COLORS[0] : (idx === PRESET_COLORS.length - 1 ? null : PRESET_COLORS[idx + 1]);
    await card.setFlag(MODULE_NS, COLOR_FLAG_KEY, next);
  }

  /**
   * Shift+wheel over a stack: rotate which card is on top without touching
   * stackId on anyone, just each member's stackZ — so this doesn't need the
   * _mergeInFlight guard the way stack-formation does, since every member
   * keeps a matching stackId the whole time and _refreshStackVisuals' "lone
   * card" cleanup never has a reason to fire mid-sequence.
   * direction > 0: current top moves to the bottom, revealing the card below.
   * direction < 0: current bottom moves to the top.
   */
  async _cycleStack(stackId, direction) {
    const pile = this.tablePile;
    if (!pile) return;
    const members = pile.cards
      .filter(c => c.getFlag(MODULE_NS, POS_FLAG_KEY)?.stackId === stackId)
      .sort((a, b) => (a.getFlag(MODULE_NS, POS_FLAG_KEY)?.stackZ ?? 0) - (b.getFlag(MODULE_NS, POS_FLAG_KEY)?.stackZ ?? 0));
    if (members.length < 2) return;

    const ordered = direction > 0
      ? [members[members.length - 1], ...members.slice(0, -1)]
      : [...members.slice(1), members[0]];

    for (let i = 0; i < ordered.length; i++) {
      const c = ordered[i];
      const cur = c.getFlag(MODULE_NS, POS_FLAG_KEY) || {};
      await c.setFlag(MODULE_NS, POS_FLAG_KEY, { ...cur, stackZ: i });
    }
    this._refreshStackVisuals();
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

      // Always read through the cached live reference, not the closed-over
      // `card` param — see the comment on container.stargazerCard above.
      const liveCard = container.stargazerCard;
      const pos = liveCard.getFlag(MODULE_NS, POS_FLAG_KEY) || {};
      const stackId = pos.stackId;
      const pile = this.tablePile;

      console.log("[SGZ:debug] pointerdown", { name: liveCard.name, ctrlHeld, shiftHeld, stackId, hasPile: !!pile, isLeftClick, button: nativeMod?.button });

      if (ctrlHeld && shiftHeld) {
        // Shift+Ctrl+drag: grab the whole stack together. (Not plain Alt+drag —
        // Alt+mouse gestures get intercepted by the OS/browser on enough
        // platforms — window-move on several Linux desktops, menu-access-key
        // handling on Windows/Firefox — that it isn't reliable here. Shift and
        // Ctrl are both already proven to reach us cleanly.)
        if (stackId && pile) {
          const stackCards = pile.cards.filter(c => c.getFlag(MODULE_NS, POS_FLAG_KEY)?.stackId === stackId);
          console.log("[SGZ:debug] group-drag check", { grabbedCard: liveCard.name, stackId, stackCardCount: stackCards.length, members: stackCards.map(c => ({ name: c.name, id: c.id, stackId: c.getFlag(MODULE_NS, POS_FLAG_KEY)?.stackId })) });
          if (stackCards.length >= 2) {
            this._startGroupDrag(container, ev, stackCards);
            return;
          }
        } else {
          console.log("[SGZ:debug] group-drag skipped: stackId or pile missing", { stackId, hasPile: !!pile });
        }
        // Not actually part of a multi-card stack — fall through to a normal
        // single-card drag below rather than doing nothing.
        console.log("[SGZ:debug] falling through to single-card drag");
      } else if (ctrlHeld) {
        // Ctrl(+Cmd)+left-click: cycle the card's color tag. Never starts a drag.
        this._cycleCardColor(liveCard);
        return;
      } else if (shiftHeld) {
        // Shift+left-click: tear whichever corner was clicked. Never starts a drag.
        const local = ev.getLocalPosition(container);
        this._tearCorner(liveCard, this._cornerAt(local));
        return;
      }

      // ── Normal single-card drag — peels this card off any stack it's in ──
      const local = ev.getLocalPosition(this);
      dragData = { offsetX: container.x - local.x, offsetY: container.y - local.y };
      lastPos = { x: container.x, y: container.y };

      // Reveal the next card in the stack immediately on pickup, since this
      // drag is about to leave it behind. _refreshStackVisuals excludes this
      // card entirely (that's what lets the sibling underneath become the
      // new visible top) — which also means it never touches this card's own
      // badge. Clear that badge directly, or it stays floating above the
      // card you're now dragging away, still showing the old stack count.
      if (stackId) {
        this._refreshStackVisuals(liveCard.id, { persist: false });
        this._removeStackBadge(container);
      }

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
              // computeIncomingDropPlacement may write the target's stackId
              // as the first of two sequential writes (this card's own
              // handPos flag, set below, is the second) — guard the whole
              // sequence with the tray's _mergeInFlight, or its own
              // _refreshStackBadges could see the target alone mid-sequence
              // and destructively clear it before this card's write lands.
              tray._mergeInFlight = true;
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
              tray._mergeInFlight = false;
              canvas.stargazerCards?.removeCard(card.id);
              return;
            } catch (err) {
              tray._mergeInFlight = false;
              console.error("Stargazer | Failed to pass card to hand:", err);
            }
          }
        }
      }

      await this._persistPosition(container.stargazerCard, lastPos);
    };
  }

  /** Shift+Ctrl+drag: pick up every member of a stack together and move them as one unit */
  _startGroupDrag(container, initialEv, stackCards) {
    const members = stackCards
      .map(c => ({ card: c, container: this.cardSprites.get(c.id) }))
      .filter(m => m.container);
    console.log("[SGZ:debug] _startGroupDrag entered", { requested: stackCards.length, resolvedMembers: members.length, ids: members.map(m => m.card.id) });
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

    // Both "pointerup" and "pointerupoutside" are bound below (a release can
    // dispatch either depending on exactly where the cursor ends up), and
    // .once() only unregisters the listener it's called on, not its sibling —
    // so without this guard, a single mouse release could run this whole
    // handler twice, double-passing cards to the hand tray and colliding on
    // their own already-migrated _id.
    let groupUpHandled = false;
    const onGroupUp = async (up) => {
      if (groupUpHandled) return;
      groupUpHandled = true;
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
              // Guard the whole multi-member sequence below — every member's
              // write shares sharedStackId, so mid-sequence each one looks
              // like an unpaired lone member to the tray's own
              // _refreshStackBadges until the rest land too.
              tray._mergeInFlight = true;
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
              tray._mergeInFlight = false;
              ids.forEach(id => this.removeCard(id));
              return;
            } catch (err) {
              tray._mergeInFlight = false;
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
      // The whole merge — the target's write (if joining a new stack) plus
      // every dragged member's write below — happens as a sequence of
      // separate document updates. Suppress the "lone stack member" cleanup
      // in _refreshStackVisuals for the whole sequence: with 2+ dragged
      // members, each one is momentarily peeled off its old groupmates and
      // not yet joined to the new ones as these writes land one at a time,
      // and without the guard each intermediate state gets destructively
      // nulled out by the cleanup before the next write ever lands.
      this._mergeInFlight = true;
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
      this._mergeInFlight = false;
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
        // Forming a brand-new stack takes two separate document writes (the
        // target, then this card) — suppress the "lone stack member" cleanup
        // in _refreshStackVisuals while both are in flight, or the target's
        // own updateCard hook sees a not-yet-paired stackId and destructively
        // nulls it out before this card's write ever lands.
        this._mergeInFlight = true;
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
    this._mergeInFlight = false;

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
        // Skip the destructive clear while a merge is still writing its
        // other member(s) — see _mergeInFlight in _persistPosition and
        // _startGroupDrag's onGroupUp.
        const lone = members[0];
        if (lone) {
          lone.container.visible = true;
          this._removeStackBadge(lone.container);
          if (persist && lone.pos.stackId && !this._mergeInFlight) {
            lone.card.setFlag(MODULE_NS, POS_FLAG_KEY, { ...lone.pos, stackId: null, stackZ: null });
          }
        }
        continue;
      }

      const top = members.reduce((a, b) => (b.pos.stackZ ?? 0) > (a.pos.stackZ ?? 0) ? b : a);
      console.log("[SGZ:debug] stack group", { stackId: top.pos.stackId, size: members.length, memberNames: members.map(m => m.card.name), topName: top.card.name });
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
    console.log("[SGZ:debug] refreshCard called", { name: card.name, id: card.id, parentId: card.parent?.id, tablePileId: this.tablePile?.id, pos: card.getFlag(MODULE_NS, POS_FLAG_KEY) });
    if (!this.tablePile || card.parent?.id !== this.tablePile.id) {
      console.log("[SGZ:debug] refreshCard EARLY RETURN (wrong pile or no pile)");
      return;
    }

    const existing = this.cardSprites.get(card.id);
    const pos = card.getFlag(MODULE_NS, POS_FLAG_KEY) || {};
    const faceUp = !!pos.faceUp;

    if (existing && existing.stargazerFaceUp === faceUp) {
      // Only position/stack-membership changed (a drag, snap, or unstack) —
      // ease the existing container into place instead of destroying and
      // rebuilding it, so drops and stack joins glide instead of popping.
      // Refresh the cached live-document pointer every time, even though the
      // container itself isn't rebuilt — otherwise every handler wired back
      // in _renderCard would keep reading flags off whatever Card instance
      // existed at creation time, permanently missing anything that changed
      // afterward (this was the actual cause of stack-drag never triggering:
      // stackId always read back as null post-merge).
      existing.stargazerCard = card;
      console.log("[SGZ:debug] refreshCard: ease-in-place, stargazerCard refreshed", { name: card.name, cachedStackId: existing.stargazerCard.getFlag(MODULE_NS, POS_FLAG_KEY)?.stackId });
      this._animateTo(existing, pos.x, pos.y);
      this._restyleStackBorder(existing, card, !!pos.stackId);
      this._drawCardOverlay(existing, card);
      this._refreshCardText(existing, card);
    } else {
      console.log("[SGZ:debug] refreshCard: rebuilding via _renderCard", { name: card.name, hadExisting: !!existing });
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

  /**
   * Push the card's current name/description onto its existing text
   * objects, without rebuilding the container. This is what the
   * ease-in-place path in refreshCard() was missing — a card.update() from
   * the edit dialog (or anything else) only reaches the screen through
   * this, since faceUp not changing means _renderCard is never called.
   */
  _refreshCardText(container, card) {
    const faceUp = container.stargazerFaceUp;

    const label = container.stargazerNameText;
    if (label) {
      label.text = faceUp ? (card.name || "Card") : "🂠";
      // Re-set position/anchor every refresh, not just at creation — a name
      // edit can change how many lines the label wraps to, which shifts
      // where the description needs to start below it.
      if (faceUp) {
        label.anchor.set(0.5, 0);
        label.y = -CARD_HEIGHT / 2 + TEXT_PADDING;
      } else {
        label.anchor.set(0.5);
        label.y = 0;
      }
    }

    const wantsDesc = faceUp && !!card.description;
    let desc = container.stargazerDescText;
    if (wantsDesc) {
      const descStyle = new PIXI.TextStyle({
        fontFamily: "Roboto, sans-serif",
        fontSize: 11,
        fill: 0x444444,
        align: "center",
        wordWrap: true,
        wordWrapWidth: CARD_WIDTH - TEXT_PADDING * 2,
        breakWords: true,
      });
      const descTop = label.y + label.height + 6;
      const descMaxHeight = Math.max(0, (CARD_HEIGHT / 2 - TEXT_PADDING) - descTop);
      const fitted = this._truncateToFit(card.description, descStyle, descMaxHeight);
      if (!desc) {
        desc = new PIXI.Text(fitted, descStyle);
        desc.anchor.set(0.5, 0);
        container.addChild(desc);
        container.stargazerDescText = desc;
      } else if (desc.text !== fitted) {
        desc.text = fitted;
      }
      desc.y = descTop;
    } else if (desc) {
      container.removeChild(desc);
      desc.destroy();
      container.stargazerDescText = null;
    }
  }

  /**
   * Wrap `text` against `style` and, if it wraps to more lines than fit
   * within `maxHeight`, cut it down to however many whole lines do fit and
   * append an ellipsis — so description text can never draw past the card's
   * own bottom edge, no matter how long the source text is.
   */
  _truncateToFit(text, style, maxHeight) {
    const source = text ?? "";
    const metrics = PIXI.TextMetrics.measureText(source, style);
    const lineHeight = metrics.lineHeight || Math.ceil(style.fontSize * 1.3);
    const maxLines = Math.max(1, Math.floor(maxHeight / lineHeight));
    if (metrics.lines.length <= maxLines) return source;

    const lines = metrics.lines.slice(0, maxLines);
    let last = lines[maxLines - 1];
    while (last.length > 1 && PIXI.TextMetrics.measureText(last + "…", style).width > style.wordWrapWidth) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = last.replace(/\s+$/, "") + "…";
    return lines.join("\n");
  }

  /** Remove a card's sprite (called from deleteCard hook) */
  removeCard(cardId) {
    this.cardSprites.get(cardId)?.destroy({ children: true });
    this.cardSprites.delete(cardId);
    this._refreshStackVisuals();
  }
}

/**
 * Ensure a Cards document (table pile / deck / discard pile) has at least
 * OWNER as its default permission, so every player — not just the GM — can
 * see it and write to it (move, stack, draw, discard...). Only a GM can
 * actually perform this update: a player with default:NONE has no
 * permission to elevate their own access, so this must run GM-side and
 * proactively, not be something a player triggers on first failure.
 */
async function _ensureOwnerDefault(doc) {
  if ((doc.ownership?.default ?? 0) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) return false;
  await doc.update({ ownership: { ...doc.ownership, default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER } });
  return true;
}

/**
 * GM-only, self-healing permission sweep over every Cards document this
 * module owns (table pile, demo deck, any decks' discard piles). Runs
 * automatically on world ready so a world whose table/deck was created
 * before the ownership fix existed gets repaired without anyone having to
 * remember to re-click "Deal Test Cards".
 */
async function migrateCardPermissions() {
  if (!game.user.isGM) return;
  const targets = game.cards.filter(c =>
    c.getFlag(MODULE_NS, TABLE_PILE_FLAG) ||
    (c.type === "deck" && c.getFlag(MODULE_NS, "isDemoDeck")) ||
    c.getFlag(MODULE_NS, DISCARD_PILE_FLAG)
  );
  let fixedCount = 0;
  for (const doc of targets) {
    try {
      if (await _ensureOwnerDefault(doc)) fixedCount++;
    } catch (err) {
      console.error(`Stargazer | Failed to repair ownership on Cards "${doc.name}" (${doc.id}):`, err);
    }
  }
  if (fixedCount) {
    console.log(`Stargazer | Repaired default ownership on ${fixedCount} Cards document(s) so all players can use them.`);
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

  // Self-healing permission repair — GM-only, runs once per world load.
  Hooks.once("ready", () => { migrateCardPermissions(); });

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

  // Scene controls: GM-only bootstrap button, plus deck/card actions any
  // player can use once the table and deck exist.
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!controls.tokens?.tools) return;

    if (game.user.isGM) {
      controls.tokens.tools.dealTestCards = {
        name: "dealTestCards",
        title: "Deal Test Cards (Stage 1 demo)",
        icon: "fa-solid fa-cards",
        order: Object.keys(controls.tokens.tools).length,
        button: true,
        visible: true,
        onChange: () => dealTestCards(),
      };
    }

    controls.tokens.tools.sgzDrawCard = {
      name: "sgzDrawCard",
      title: "Draw Card",
      icon: "fa-solid fa-hand-holding",
      order: Object.keys(controls.tokens.tools).length,
      button: true,
      visible: true,
      onChange: () => drawCardToTable(),
    };
    controls.tokens.tools.sgzShuffleDeck = {
      name: "sgzShuffleDeck",
      title: "Shuffle Deck",
      icon: "fa-solid fa-shuffle",
      order: Object.keys(controls.tokens.tools).length,
      button: true,
      visible: true,
      onChange: () => shuffleDeck(),
    };
    controls.tokens.tools.sgzRecallDeck = {
      name: "sgzRecallDeck",
      title: "Recall Deck",
      icon: "fa-solid fa-arrow-rotate-left",
      order: Object.keys(controls.tokens.tools).length,
      button: true,
      visible: true,
      onChange: () => recallDeck(),
    };
    controls.tokens.tools.sgzNewCard = {
      name: "sgzNewCard",
      title: "New Card",
      icon: "fa-solid fa-plus",
      order: Object.keys(controls.tokens.tools).length,
      button: true,
      visible: true,
      onChange: () => createStandaloneCard(),
    };
  });
}

/**
 * Resolve a Card's origin deck to an actual Cards document. `card.origin`
 * is Foundry's built-in tracking of which deck a card was drawn from, but
 * whether it resolves to the live document or just its id string has
 * varied across API versions — handle both rather than assume.
 */
function _resolveOriginDeck(card) {
  const origin = card.origin;
  if (!origin) return null;
  return typeof origin === "string" ? (game.cards.get(origin) ?? null) : origin;
}

/** Find the registered table Pile and demo Deck, if they've been set up yet */
function _getTableAndDeck() {
  const pile = game.cards.find(c => c.getFlag(MODULE_NS, TABLE_PILE_FLAG));
  const deck = game.cards.find(c => c.type === "deck" && c.getFlag(MODULE_NS, "isDemoDeck"));
  return { pile, deck };
}

/** A scattered position near the current view center, for newly placed cards */
function _scatterPosition() {
  const center = { x: canvas.stage.pivot.x || 1000, y: canvas.stage.pivot.y || 1000 };
  return {
    x: center.x + (Math.random() - 0.5) * 300,
    y: center.y + (Math.random() - 0.5) * 300,
  };
}

/** Find-or-create the discard Pile for a given deck. Any player can discard, so it's owner-for-all like the table pile. */
async function getOrCreateDiscardPile(deck) {
  let discard = game.cards.find(c => c.getFlag(MODULE_NS, DISCARD_PILE_FLAG) === deck.id);
  if (!discard) {
    discard = await Cards.create({
      name: `${deck.name} — Discard`,
      type: "pile",
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
      flags: { [MODULE_NS]: { [DISCARD_PILE_FLAG]: deck.id } },
    });
  }
  return discard;
}

/** Player-facing: draw one card from the registered deck onto the table at a scattered position */
async function drawCardToTable() {
  const { pile, deck } = _getTableAndDeck();
  if (!pile || !deck) {
    return ui.notifications.warn("No table pile or deck set up yet — ask the GM to deal test cards first.");
  }
  if (!deck.availableCards.length) {
    return ui.notifications.info(`${deck.name} is empty. Shuffle or recall it first.`);
  }
  try {
    // deal()'s return value isn't reliable — snapshot ids before/after and
    // treat the difference as "newly dealt", same technique used elsewhere
    // in this module for pass().
    const idsBefore = new Set(pile.cards.map(c => c.id));
    await deck.deal([pile], 1, { how: 0 });
    const newCard = pile.cards.find(c => !idsBefore.has(c.id));
    if (!newCard) {
      console.error("Stargazer | drawCardToTable: deal() completed but no new card was found in the pile.");
      return;
    }
    const { x, y } = _scatterPosition();
    await newCard.setFlag(MODULE_NS, POS_FLAG_KEY, { x, y, rotation: 0, faceUp: true });
  } catch (err) {
    console.error("Stargazer | drawCardToTable failed:", err);
    ui.notifications.error("Stargazer | Couldn't draw a card — see console.");
  }
}

/** Player-facing: shuffle the registered deck */
async function shuffleDeck() {
  const { deck } = _getTableAndDeck();
  if (!deck) return ui.notifications.warn("No deck set up yet — ask the GM to deal test cards first.");
  await deck.shuffle();
  ui.notifications.info(`${deck.name} shuffled.`);
}

/** Player-facing: recall the registered deck — returns every dealt/discarded instance and restores default order */
async function recallDeck() {
  const { deck } = _getTableAndDeck();
  if (!deck) return ui.notifications.warn("No deck set up yet — ask the GM to deal test cards first.");
  await deck.recall();
  ui.notifications.info(`${deck.name} recalled — all drawn and discarded cards returned.`);
}

/** Player-facing: create a freeform standalone card (no deck, no prototype) directly on the table */
async function createStandaloneCard() {
  const { pile } = _getTableAndDeck();
  if (!pile) return ui.notifications.warn("No table pile set up yet — ask the GM to deal test cards first.");

  new Dialog({
    title: "New Card",
    content: `
      <form>
        <div class="form-group">
          <label>Name</label>
          <input type="text" name="name" value="New Card" />
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea name="description" rows="4"></textarea>
        </div>
      </form>`,
    buttons: {
      create: {
        icon: '<i class="fa-solid fa-check"></i>',
        label: "Create",
        callback: async (html) => {
          const name = html.find('[name="name"]').val().trim() || "New Card";
          const description = html.find('[name="description"]').val();
          const [created] = await pile.createEmbeddedDocuments("Card", [{
            name,
            description,
            faces: [{ name, img: "icons/svg/card-joker.svg" }],
            face: 0,
            back: { name: "Card Back", img: "icons/svg/card-hand.svg" },
          }]);
          const { x, y } = _scatterPosition();
          await created.setFlag(MODULE_NS, POS_FLAG_KEY, { x, y, rotation: 0, faceUp: true });
        },
      },
      cancel: { icon: '<i class="fa-solid fa-xmark"></i>', label: "Cancel" },
    },
    default: "create",
  }).render(true);
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
        // The table pile has to be writable by every player, not just the
        // GM who happened to create it — any player can pick up, move,
        // stack, or pass a card off the table (see design doc: "Pile —
        // cards on the table, visible/ownable by anyone"). Without this,
        // Cards.create() defaults to OWNER for the creator only and NONE
        // for everyone else, meaning non-GM players never even receive the
        // pile's data.
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
        flags: { [MODULE_NS]: { [TABLE_PILE_FLAG]: true } },
      });
    } else {
      await _ensureOwnerDefault(pile);
    }

    let deck = game.cards.find(c => c.type === "deck" && c.getFlag(MODULE_NS, "isDemoDeck"));
    if (!deck) {
      deck = await Cards.create({
        name: "Demo Deck",
        type: "deck",
        // Same reasoning as the table pile above: players need to draw,
        // shuffle, and recall this deck themselves, not just the GM.
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
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
    } else {
      await _ensureOwnerDefault(deck);
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
        rotation: 0,
        faceUp: false,
      });
    }

    ui.notifications.info(`Dealt ${newCards.length} card(s) to the table.`);

  } catch (err) {
    console.error("Stargazer | dealTestCards failed:", err);
    ui.notifications.error(`Stargazer | Deal Test Cards failed: ${err.message} (see console for details)`);
  }
}
