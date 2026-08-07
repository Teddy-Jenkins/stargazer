/**
 * Stargazer Hand Tray — Diagnostic Test Suite
 *
 * Usage (browser console, after the system has loaded):
 *   const diag = await import('/systems/stargazer/hand-tray-diagnostics.js');
 *   diag.runAll();          // run every suite
 *   diag.runSuite('pass');  // run one suite by key
 *   diag.stopAll();         // remove all listeners
 *
 * Each test logs PASS / FAIL / INFO to the console under the "SGZ-DIAG" group.
 * Tests are non-destructive: they observe, never permanently mutate world state.
 */

// ─── helpers ────────────────────────────────────────────────────────────────

const MODULE_NS    = "stargazer";
const HAND_FLAG    = "isPlayerHand";
const HAND_POS_FLAG = "handPos";
const TABLE_FLAG   = "isCardTable";
const POS_FLAG_KEY  = "cardPos";

let _cleanups = [];

function log(level, suite, msg, data) {
  const icon = level === "PASS" ? "✅" : level === "FAIL" ? "❌" : "ℹ️";
  if (data !== undefined) {
    console.log(`${icon} [SGZ-DIAG:${suite}] ${msg}`, data);
  } else {
    console.log(`${icon} [SGZ-DIAG:${suite}] ${msg}`);
  }
}

function assert(condition, suite, msgPass, msgFail, data) {
  if (condition) {
    log("PASS", suite, msgPass);
  } else {
    log("FAIL", suite, msgFail, data);
  }
}

function getHand() {
  const userId = game.user.id;
  return game.cards.find(c =>
    c.type === "hand" && c.getFlag(MODULE_NS, HAND_FLAG) === userId
  );
}

function getPile() {
  return game.cards.find(c => c.getFlag(MODULE_NS, TABLE_FLAG));
}

function getTray() {
  // Access the module singleton — relies on hand-tray.js exporting getTrayInstance
  // If imported differently in your build, adjust this path.
  return window.__sgzTrayDiag ?? null;
}

// ─── Suite 1: Hook firing order during pile.pass() ──────────────────────────
// Tests Bug 1: does the hand tray's DOM update when a card is passed from
// the Table pile into the player's Hand?

async function suitePassHook() {
  const SUITE = "pass-hook";
  console.group(`[SGZ-DIAG:${SUITE}] Hook firing order on pile.pass()`);

  const hand = getHand();
  const pile = getPile();

  if (!hand || !pile) {
    log("INFO", SUITE, "Need both a Hand and a Table pile. Run Deal Test Cards first.");
    console.groupEnd();
    return;
  }

  const tableCards = Array.from(pile.cards);
  if (tableCards.length === 0) {
    log("INFO", SUITE, "No cards on the table to test with. Deal some first.");
    console.groupEnd();
    return;
  }

  const testCard = tableCards[0];
  log("INFO", SUITE, `Testing with card: "${testCard.name}" (${testCard.id})`);

  // Instrument hooks BEFORE the pass so we capture the exact sequence.
  const events = [];

  const hCreateCard = Hooks.on("createCard", (card) => {
    events.push({
      hook: "createCard",
      cardId: card.id,
      cardName: card.name,
      parentId: card.parent?.id,
      parentType: card.parent?.type,
      isHand: card.parent?.id === hand.id,
    });
  });

  const hUpdateCard = Hooks.on("updateCard", (card, diff) => {
    events.push({
      hook: "updateCard",
      cardId: card.id,
      parentId: card.parent?.id,
      isHand: card.parent?.id === hand.id,
      diff,
    });
  });

  const hUpdateCards = Hooks.on("updateCards", (cards, diff) => {
    events.push({
      hook: "updateCards",
      cardsId: cards.id,
      cardsType: cards.type,
      isHand: cards.id === hand.id,
      isPile: cards.id === pile.id,
      cardCount: cards.cards.size,
      diff,
    });
  });

  const hDeleteCard = Hooks.on("deleteCard", (card) => {
    events.push({
      hook: "deleteCard",
      cardId: card.id,
      cardName: card.name,
      parentId: card.parent?.id,
    });
  });

  try {
    log("INFO", SUITE, "Calling pile.pass(hand, [testCard.id])…");
    await pile.pass(hand, [testCard.id]);
    // Small delay to let async hook callbacks settle
    await new Promise(r => setTimeout(r, 300));
  } catch (err) {
    log("FAIL", SUITE, `pile.pass() threw: ${err.message}`);
  }

  Hooks.off("createCard", hCreateCard);
  Hooks.off("updateCard", hUpdateCard);
  Hooks.off("updateCards", hUpdateCards);
  Hooks.off("deleteCard", hDeleteCard);

  log("INFO", SUITE, `Total hook events captured: ${events.length}`, events);

  // Assertions
  const handUpdateCards = events.find(e => e.hook === "updateCards" && e.isHand);
  assert(!!handUpdateCards, SUITE,
    "updateCards fired on the Hand document",
    "updateCards did NOT fire on the Hand document — this is the root cause of Bug 1",
    events
  );

  const createForHand = events.find(e => e.hook === "createCard" && e.isHand);
  assert(!!createForHand, SUITE,
    "createCard fired with parent === hand",
    "createCard did not fire with hand as parent — pass() may use update not create",
    events
  );

  // Check if tray DOM updated
  const tray = getTray();
  if (tray) {
    const cardInDOM = tray.cardEls?.has(testCard.id);
    // The id may change on pass (new instance), check by count instead
    const domCount = tray.cardEls?.size ?? 0;
    const handCount = hand.cards.size;
    assert(domCount === handCount, SUITE,
      `Tray DOM card count matches hand (${handCount})`,
      `Tray DOM has ${domCount} cards but hand has ${handCount} — DOM not updated`,
    );
  } else {
    log("INFO", SUITE, "Tray instance not accessible via window.__sgzTrayDiag — skipping DOM check. See setup note at top of file.");
  }

  // Put the card back so we don't leave state dirty
  try {
    const cardInHand = hand.cards.find(c => c.name === testCard.name);
    if (cardInHand && pile) {
      await hand.pass(pile, [cardInHand.id]);
      log("INFO", SUITE, "Card returned to pile (cleanup).");
    }
  } catch (e) {
    log("INFO", SUITE, `Cleanup pass failed (non-critical): ${e.message}`);
  }

  console.groupEnd();
}

// ─── Suite 2: Stack z-index cycling ──────────────────────────────────────────
// Tests Bug 2: does mousewheel correctly cycle z-index for stacked cards?

async function suiteStackScroll() {
  const SUITE = "stack-scroll";
  console.group(`[SGZ-DIAG:${SUITE}] Stack z-index cycling`);

  const hand = getHand();
  if (!hand) {
    log("INFO", SUITE, "No hand found."); console.groupEnd(); return;
  }

  const tray = getTray();
  if (!tray) {
    log("INFO", SUITE, "Tray instance not accessible. See setup note."); console.groupEnd(); return;
  }

  const cardEls = tray.cardEls;
  if (!cardEls || cardEls.size < 2) {
    log("INFO", SUITE, `Need ≥2 cards in hand (have ${cardEls?.size ?? 0}). Add more cards first.`);
    console.groupEnd(); return;
  }

  // Inspect current z-indices
  const zReport = [];
  for (const [id, el] of cardEls) {
    const card = hand.cards.get(id);
    const pos = card?.getFlag(MODULE_NS, HAND_POS_FLAG) ?? {};
    zReport.push({
      cardId: id,
      name: card?.name,
      stackId: pos.stackId ?? null,
      elZIndex: el.style.zIndex || "(none)",
    });
  }
  log("INFO", SUITE, "Current card state:", zReport);

  // Check 1: Are any z-indices set at all? If all are "" the rotation is a no-op.
  const anyZSet = zReport.some(r => r.elZIndex !== "(none)" && r.elZIndex !== "0");
  assert(anyZSet, SUITE,
    "At least one card has a non-zero z-index set",
    "All cards have z-index '0' or unset — wheel rotation will be a visual no-op (Bug 2 root cause)"
  );

  // Check 2: Are there any stacked cards (shared stackId)?
  const stackIds = zReport.map(r => r.stackId).filter(Boolean);
  const hasStacks = stackIds.length > 0;
  assert(hasStacks, SUITE,
    `Found ${new Set(stackIds).size} stack group(s)`,
    "No stacked cards (stackId is null on all cards) — wheel will always early-return"
  );

  if (hasStacks) {
    // Check 3: For each stack, simulate what the wheel handler does and verify
    // that z-indices actually change.
    const byStack = new Map();
    for (const r of zReport) {
      if (!r.stackId) continue;
      if (!byStack.has(r.stackId)) byStack.set(r.stackId, []);
      byStack.get(r.stackId).push(r);
    }

    for (const [sid, entries] of byStack) {
      const zsBefore = entries.map(e => parseInt(e.elZIndex || "0", 10));
      log("INFO", SUITE, `Stack "${sid}" z-indices before rotate:`, zsBefore);

      // Simulate the rotation logic from _wireTrayDrag wheel handler
      const sorted = [...entries].sort((a, b) =>
        parseInt(a.elZIndex || "0") - parseInt(b.elZIndex || "0")
      );
      const zVals = sorted.map(e => parseInt(e.elZIndex || "0"));
      const bottom = zVals.shift();
      zVals.push(bottom);
      const zsAfter = zVals;

      log("INFO", SUITE, `Stack "${sid}" z-indices after simulated rotate:`, zsAfter);

      const changed = JSON.stringify(zsBefore.sort()) !== JSON.stringify([...zsAfter].sort()) ||
                      JSON.stringify(zsBefore) !== JSON.stringify(zsAfter);

      assert(changed, SUITE,
        `Stack "${sid}": simulated rotation produces visible change`,
        `Stack "${sid}": simulated rotation is a no-op (all z-indices identical) — this is Bug 2`
      );
    }
  }

  console.groupEnd();
}

// ─── Suite 3: Long-press stack drag race condition ────────────────────────────
// Tests Bug 3: does the long-press path conflict with the normal drag path?

async function suiteLongPress() {
  const SUITE = "long-press";
  console.group(`[SGZ-DIAG:${SUITE}] Long-press drag race condition`);

  // This suite is static analysis — we inspect the closure state by examining
  // the rendered DOM and event listener count rather than triggering real drags.

  const tray = getTray();
  const hand = getHand();

  if (!tray || !hand) {
    log("INFO", SUITE, "Tray or hand not available."); console.groupEnd(); return;
  }

  // Check 1: Confirm the race window exists by tracing the mousedown handler structure.
  // The bug is that dragging = true and document listeners are registered at the TOP
  // of the mousedown handler, not inside the longPressTimer callback.
  // We can't inspect closures, but we can observe the symptom:
  // trigger a fast click vs slow hold and see if event counts differ.

  log("INFO", SUITE, "Static checks (code-level race analysis):");

  // Check 2: Are there stacked cards to test long-press on?
  const stackedCards = Array.from(hand.cards).filter(c =>
    c.getFlag(MODULE_NS, HAND_POS_FLAG)?.stackId
  );

  assert(stackedCards.length >= 2, SUITE,
    `${stackedCards.length} stacked cards available for long-press test`,
    `Need ≥2 stacked cards to test long-press — add cards and snap them together first`
  );

  // Check 3: Simulate the mousedown→timer→mouseup sequence timing conflict.
  // We count document-level mousemove/mouseup listeners before and after a
  // synthetic mousedown on a card element, then confirm they are cleaned up.
  const cardEls = tray.cardEls;
  if (cardEls.size === 0) {
    log("INFO", SUITE, "No cards in tray DOM to test with."); console.groupEnd(); return;
  }

  const firstCardEl = cardEls.values().next().value;

  // Count listeners is not directly inspectable in vanilla JS.
  // Instead: fire a synthetic mousedown, wait 0ms (shorter than long-press),
  // fire mouseup, and check that no group-drag handlers are lingering.

  let groupMoveCount = 0;
  let groupUpCount = 0;
  const origAddEL = document.addEventListener.bind(document);
  const origRemEL = document.removeEventListener.bind(document);

  // Temporarily shadow addEventListener to count calls
  const addedListeners = [];
  document.addEventListener = function(type, fn, opts) {
    addedListeners.push({ type, fn });
    return origAddEL(type, fn, opts);
  };

  // Dispatch synthetic mousedown
  const mdEvent = new MouseEvent("mousedown", {
    bubbles: true, cancelable: true, button: 0, clientX: 200, clientY: 200
  });
  firstCardEl.dispatchEvent(mdEvent);

  // Wait just past long-press threshold
  await new Promise(r => setTimeout(r, 550));

  // Restore addEventListener before firing mouseup
  document.addEventListener = origAddEL;

  const removedListeners = [];
  document.removeEventListener = function(type, fn, opts) {
    removedListeners.push({ type, fn });
    return origRemEL(type, fn, opts);
  };

  const muEvent = new MouseEvent("mouseup", {
    bubbles: true, cancelable: true, button: 0, clientX: 200, clientY: 200
  });
  document.dispatchEvent(muEvent);

  await new Promise(r => setTimeout(r, 100));
  document.removeEventListener = origRemEL;

  const addedTypes = addedListeners.map(l => l.type);
  const removedTypes = removedListeners.map(l => l.type);

  log("INFO", SUITE, "Listeners added during mousedown→longpress:", addedTypes);
  log("INFO", SUITE, "Listeners removed after mouseup:", removedTypes);

  const addedMoveCount = addedTypes.filter(t => t === "mousemove").length;
  const addedUpCount   = addedTypes.filter(t => t === "mouseup").length;
  const removedMoveCount = removedTypes.filter(t => t === "mousemove").length;
  const removedUpCount   = removedTypes.filter(t => t === "mouseup").length;

  assert(addedMoveCount <= 2, SUITE,
    `mousemove listeners added: ${addedMoveCount} (≤2 expected: 1 single, 1 group)`,
    `mousemove listeners added: ${addedMoveCount} — unexpected count (race condition may produce extra handlers)`
  );

  assert(addedMoveCount === removedMoveCount, SUITE,
    `All mousemove listeners cleaned up (${addedMoveCount} added, ${removedMoveCount} removed)`,
    `Listener leak: ${addedMoveCount} mousemove added but only ${removedMoveCount} removed — handlers are orphaned (Bug 3 root cause)`
  );

  assert(addedUpCount === removedUpCount, SUITE,
    `All mouseup listeners cleaned up (${addedUpCount} added, ${removedUpCount} removed)`,
    `Listener leak: ${addedUpCount} mouseup added but only ${removedUpCount} removed`
  );

  console.groupEnd();
}

// ─── Suite 4: DOM sync sanity check ─────────────────────────────────────────
// Verifies that cardEls Map matches the live hand document at any point in time.

async function suiteDOMSync() {
  const SUITE = "dom-sync";
  console.group(`[SGZ-DIAG:${SUITE}] Tray DOM vs Hand document sync`);

  const hand = getHand();
  const tray = getTray();

  if (!hand || !tray) {
    log("INFO", SUITE, "Hand or tray unavailable."); console.groupEnd(); return;
  }

  const handIds   = new Set(hand.cards.map(c => c.id));
  const trayIds   = new Set(tray.cardEls?.keys() ?? []);
  const domEls    = document.querySelectorAll(".sgz-hand-card");
  const domIdSet  = new Set([...domEls].map(el => el.dataset.cardId));

  log("INFO", SUITE, `Hand document card count: ${handIds.size}`);
  log("INFO", SUITE, `tray.cardEls map size:    ${trayIds.size}`);
  log("INFO", SUITE, `DOM .sgz-hand-card count: ${domEls.length}`);

  assert(handIds.size === trayIds.size, SUITE,
    "Hand document and cardEls map are in sync",
    `MISMATCH: hand=${handIds.size}, cardEls=${trayIds.size}`,
    { inHandNotTray: [...handIds].filter(id => !trayIds.has(id)),
      inTrayNotHand: [...trayIds].filter(id => !handIds.has(id)) }
  );

  assert(trayIds.size === domEls.length, SUITE,
    "cardEls map and DOM element count match",
    `MISMATCH: cardEls=${trayIds.size}, DOM=${domEls.length}`,
    { inMapNotDOM: [...trayIds].filter(id => !domIdSet.has(id)),
      inDOMNotMap: [...domIdSet].filter(id => !trayIds.has(id)) }
  );

  // Check that every hand card has a valid handPos flag
  const missingPos = [];
  for (const card of hand.cards) {
    const pos = card.getFlag(MODULE_NS, HAND_POS_FLAG);
    if (!pos || pos.x === undefined) missingPos.push(card.name ?? card.id);
  }
  assert(missingPos.length === 0, SUITE,
    "All hand cards have a handPos flag",
    `${missingPos.length} card(s) missing handPos flag (will render at 0,0 overlap)`,
    missingPos
  );

  console.groupEnd();
}

// ─── Runner ──────────────────────────────────────────────────────────────────

const SUITES = {
  pass:       suitePassHook,
  stack:      suiteStackScroll,
  longpress:  suiteLongPress,
  domsync:    suiteDOMSync,
};

export async function runSuite(key) {
  const fn = SUITES[key];
  if (!fn) {
    console.warn(`[SGZ-DIAG] Unknown suite "${key}". Available: ${Object.keys(SUITES).join(", ")}`);
    return;
  }
  await fn();
}

export async function runAll() {
  console.group("=== SGZ Hand Tray Diagnostics ===");
  for (const [key, fn] of Object.entries(SUITES)) {
    await fn();
  }
  console.groupEnd();
}

export function stopAll() {
  _cleanups.forEach(fn => fn());
  _cleanups = [];
  log("INFO", "runner", "All diagnostic listeners removed.");
}

// ─── Setup note ──────────────────────────────────────────────────────────────
// To make the tray instance accessible to these tests, add ONE line at the
// bottom of hand-tray.js, inside initHandTray(), after _trayInstance is set:
//
//   window.__sgzTrayDiag = _trayInstance;
//
// Remove it before shipping to players.
