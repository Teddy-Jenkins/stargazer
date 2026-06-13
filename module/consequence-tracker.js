/**
 * Stargazer Consequence Tracker
 * 
 * INSTALLATION:
 * 1. Drop this file into stargazer/module/
 * 2. In stargazer.js, add at the top:
 *      import { ConsequenceTracker } from "./consequence-tracker.js";
 * 3. Inside the Hooks.once("init") callback, add:
 *      ConsequenceTracker.init();
 * 4. In system.json, ensure "socket": true is set.
 */

const CONSEQUENCE_TYPES = {
  failure:  { label: "Failure",  color: "#0e0e0e" },
  injury:   { label: "Harm",     color: "#cc2200" },
  friction: { label: "Friction", color: "#ccaa00" },
  loss:     { label: "Loss",     color: "#2e7d32" },
  fatigue:  { label: "Fatigue",  color: "#1565c0" },
  threat:   { label: "Threat",   color: "#6a1f9a" },
};

const SOCKET_NAME = "system.stargazer";

// Runtime state: messageId -> consequences array (remaining counts)
// Avoids setFlag which triggers re-renders that reset the DOM
const FLAG_NS     = "stargazer";
const FLAG_KEY    = "consequences";

// ─── Public API ─────────────────────────────────────────────────────────────

export class ConsequenceTracker {

  static init() {
    // Inject styles and seed live state from flags on ready
    Hooks.once("ready", () => {
      ConsequenceTracker._injectStyles();
      // Load persisted state for all existing consequence messages
      
    });


    // 1. THE SOCKET LISTENER
    game.socket.on(SOCKET_NAME, (data) => {
      
      if (data.action === "cancelConsequence") {
        if (game.user.isGM) {
          ConsequenceTracker._handleCancel(data.messageId, data.type);
        } else {
        }
      }
    });

    // 2. THE CLICK LISTENER
    document.addEventListener("click", async (ev) => {
      const token = ev.target.closest(".consequence-token.cancelable");
      if (token) {
        const msgEl = token.closest("[data-message-id]");
        if (!msgEl) return;
        
        const messageId = msgEl.dataset.messageId;
        const type = token.dataset.type;

        if (game.user.isGM) {
          ConsequenceTracker._handleCancel(messageId, type);
        } else {
          game.socket.emit(SOCKET_NAME, { action: "cancelConsequence", messageId, type });
        }
        return;
      }

      const btn = ev.target.closest(".consequence-reset");
      if (btn && game.user.isGM) {
        const msgEl = btn.closest("[data-message-id]");
        if (!msgEl) return;
        const messageId = msgEl.dataset.messageId;
        const message = game.messages.get(messageId);
        if (!message) return;
        const flagData = message.getFlag(FLAG_NS, FLAG_KEY);
        if (!flagData?.consequences) return;

        const consequences = foundry.utils.deepClone(flagData.consequences);

        consequences.forEach(c => {
          c.remaining = c.total;
        });

        await message.setFlag(
          FLAG_NS,
          FLAG_KEY,
          { consequences }
        );
      }
    });

    // Scene controls button (v13/v14 object API)
    Hooks.on("getSceneControlButtons", (controls) => {
      if (!game.user.isGM) return;
      if (!controls.tokens?.tools) return;
      controls.tokens.tools.consequences = {
        name:    "consequences",
        title:   "Set Consequences",
        icon:    "fa-solid fa-skull",
        order:   Object.keys(controls.tokens.tools).length,
        button:  true,
        visible: true,
        onChange: () => ConsequenceTracker.openGMDialog(),
      };
    });

    Hooks.on("renderChatMessageHTML", (message, html) => {
      const flagData = message.getFlag(FLAG_NS, FLAG_KEY);
      if (!flagData?.consequences) return;

      const card = html.querySelector(".consequence-card");
      if (!card) return;

      const wrapper = document.createElement("div");

      wrapper.innerHTML = ConsequenceTracker._buildCardHTML({
        consequences: flagData.consequences
      });

      card.replaceWith(wrapper.firstElementChild);
    });

  }

  static openGMDialog() {
    if (!game.user.isGM) return ui.notifications.warn("Only the GM can set consequences.");

    // Build state object to track counts
    const state = Object.fromEntries(Object.keys(CONSEQUENCE_TYPES).map(k => [k, 0]));

    const rows = Object.entries(CONSEQUENCE_TYPES).map(([key, def]) => `
      <div class="consequence-row">
        <span class="con-color-swatch" style="background:${def.color}"></span>
        <span class="con-label">${def.label}${def.allOrNothing ? ' <span class="con-tag">all-or-nothing</span>' : ''}</span>
        <div class="con-stepper">
          <button type="button" class="con-dec" data-type="${key}">−</button>
          <span class="con-count" id="count-${key}">0</span>
          <button type="button" class="con-inc" data-type="${key}">+</button>
        </div>
      </div>
    `).join("");

    const content = `
      <div class="consequence-dialog-inner">
        <p class="con-instructions">Set the consequence spread, then post to chat.</p>
        <div class="consequence-list">${rows}</div>
      </div>
    `;

    // Use DialogV2 (AppV2-based, v13+)
    // state is mutated live by stepper buttons; callback reads it directly
    const dialog = new foundry.applications.api.DialogV2({
      window: { title: "Set Consequences" },
      content,
      buttons: [
        {
          label: "Post to Chat",
          action: "post",
          default: true,
          callback: () => foundry.utils.deepClone(state),
        },
      ],
      form: { closeOnSubmit: false },
      submit: async (result) => {
        const consequences = Object.entries(result)
          .filter(([, count]) => count > 0)
          .map(([type, count]) => ({ type, total: count, remaining: count }));

        if (!consequences.length) {
          return ui.notifications.warn("Add at least one consequence before posting.");
        }

        const msg = await ChatMessage.create({
          content: ConsequenceTracker._buildCardHTML({ consequences }),
          speaker: { alias: "GM" },
          flags: { [FLAG_NS]: { [FLAG_KEY]: { consequences } } },
        });

        // Reset state and DOM counts in place — dialog stays open
        Object.keys(state).forEach(k => {
          state[k] = 0;
          dialog.element.querySelector(`#count-${k}`).textContent = "0";
        });
      },
    });

    dialog.render({ force: true });

    // Wire stepper buttons after render — html is a plain HTMLElement in v14
    Hooks.once("renderDialogV2", (app, html) => {
      if (app !== dialog) return;
      const root = html instanceof HTMLElement ? html : html[0];
      root.querySelectorAll(".con-inc").forEach(btn => {
        btn.addEventListener("click", () => {
          const type = btn.dataset.type;
          state[type] = Math.min(10, (state[type] || 0) + 1);
          root.querySelector(`#count-${type}`).textContent = state[type];
        });
      });
      root.querySelectorAll(".con-dec").forEach(btn => {
        btn.addEventListener("click", () => {
          const type = btn.dataset.type;
          state[type] = Math.max(0, (state[type] || 0) - 1);
          root.querySelector(`#count-${type}`).textContent = state[type];
        });
      });
    });
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  // --- Inside ConsequenceTracker class ---

  static async _handleCancel(messageId, type) {
    
    if (!game.user.isGM) {
      return;
    }

    const message = game.messages.get(messageId);
    if (!message) {
      return;
    }

    const flagData = message.getFlag(FLAG_NS, FLAG_KEY);
    if (!flagData?.consequences) {
      return;
    }

    const consequences = foundry.utils.deepClone(flagData.consequences);
    const entry = consequences.find(c => c.type === type);
    if (!entry || entry.remaining <= 0) return;
    
    entry.remaining--;
    
    // Using setFlag is slightly safer for Foundry's internal schema routing
    await message.setFlag(FLAG_NS, FLAG_KEY, { consequences });
    
  }



  static _buildCardHTML({ consequences }) {
    const rows = consequences.map(({ type, total, remaining }) => {
      const def = CONSEQUENCE_TYPES[type];
      const tokens = Array.from({ length: total }, (_, i) => {
        const cancelled = i >= remaining;
        return `<span class="consequence-token ${cancelled ? "cancelled" : "cancelable"}"
                      data-type="${type}"
                      title="${cancelled ? "Cancelled" : "Click to cancel with a success"}"
                      style="--con-color:${def.color}"></span>`;
      }).join("");

      const severity = remaining === 0 ? "resolved"
                     : remaining === 1 ? "low"
                     : remaining <= 3  ? "mid" : "high";

      return `
        <div class="con-card-row" data-severity="${severity}">
          <div class="con-card-label">
            <span class="con-color-swatch" style="background:${def.color}"></span>
            <span class="con-remaining-count">${remaining}</span>
            <span>${def.label}</span>
            ${def.allOrNothing ? '<span class="con-tag">all-or-nothing</span>' : ''}
          </div>
          <div class="con-card-tokens">${tokens}</div>
        </div>`;
    }).join("");

    const hasFailure = consequences.some(c => CONSEQUENCE_TYPES[c.type].allOrNothing);

    return `
      <div class="consequence-card">
        <div class="con-card-header">
          <span class="con-card-title">Consequences</span>
          <button type="button" class="consequence-reset" title="Reset all (GM only)">↺</button>
        </div>
        <div class="con-card-body">${rows}</div>
        <div class="con-card-footer">
          Click a consequence to cancel it with a success.
          ${hasFailure ? '<br><em>✕ Failure: any remaining = action fails.</em>' : ''}
        </div>
      </div>`;
  }

  static _injectStyles() {
    if (document.getElementById("stargazer-consequence-styles")) return;
    const style = document.createElement("style");
    style.id = "stargazer-consequence-styles";
    style.textContent = `
/* ── Shared ──────────────────────────────── */
.con-color-swatch { display: inline-block; width: 12px; height: 12px; border-radius: 2px; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.2); }
.con-tag { font-size: 0.62rem; color: #aaa; border: 1px solid #555; border-radius: 2px; padding: 1px 4px; text-transform: uppercase; letter-spacing: 0.04em; margin-left: 4px; }

/* ── Consequence Dialog ─────────────────── */
.consequence-dialog-inner { padding: 2px 0 4px; font-family: "Roboto", sans-serif; }
.con-instructions { display: none; }
.consequence-list { display: flex; flex-direction: column; gap: 2px; }
.consequence-row { display: flex; align-items: center; gap: 6px; padding: 3px 6px; background: rgba(0,0,0,0.15); border-radius: 2px; border: 1px solid rgba(255,255,255,0.07); }
.con-label { flex: 1; font-size: 0.8rem; }
.con-stepper { display: flex; align-items: center; gap: 4px; }
.con-stepper button { width: 18px; height: 18px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.15); border-radius: 2px; font-size: 0.85rem; line-height: 1; cursor: pointer; padding: 0; display: flex; align-items: center; justify-content: center; }
.con-stepper button:hover { background: rgba(255,255,255,0.1); }
.con-count { min-width: 16px; text-align: center; font-size: 0.8rem; font-weight: 500; }

/* ── Chat Card ───────────────────────────── */
.consequence-card { border: 1px solid #444; border-radius: 4px; overflow: hidden; font-family: "Roboto", sans-serif; background: #1a1a1a; color: #ddd; }
.con-card-header { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: #222; border-bottom: 1px solid #444; }
.con-card-title { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.1em; color: #aaa; font-weight: 500; }
.consequence-reset { background: none; border: 1px solid #555; border-radius: 2px; color: #aaa; cursor: pointer; font-size: 0.8rem; width: 20px; height: 20px; padding: 0; line-height: 1; display: flex; align-items: center; justify-content: center; opacity: 0.6; }
.consequence-reset:hover { opacity: 1; }
.con-card-body { padding: 7px 10px; display: flex; flex-direction: column; gap: 5px; }
.con-card-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 6px; border-radius: 3px; background: #222; border-left: 3px solid #444; transition: border-color 0.2s, opacity 0.2s; }
.con-card-row[data-severity="resolved"] { opacity: 0.4; }
.con-card-label { display: flex; align-items: center; gap: 6px; font-size: 0.82rem; color: #ddd; min-width: 100px; flex-shrink: 0; white-space: nowrap; }
.con-remaining-count { font-size: 0.85rem; font-weight: 700; color: #fff; min-width: 12px; text-align: right; }
.con-card-tokens { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
.consequence-token { width: 18px; height: 18px; border-radius: 2px; display: inline-block; transition: all 0.15s ease; user-select: none; flex-shrink: 0; }
.consequence-token.cancelable { background: var(--con-color); cursor: pointer; opacity: 1; }
.consequence-token.cancelable:hover { filter: brightness(1.3); transform: scale(1.15); }
.consequence-token.cancelled { background: #333; border: 1px solid #444; cursor: default; opacity: 0.3; }
.con-card-footer { font-size: 0.67rem; color: #999; padding: 5px 10px 7px; border-top: 1px solid #333; line-height: 1.4; }
    `;
    document.head.appendChild(style);
  }
}
