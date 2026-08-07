/**
 * Extend the basic ActorSheet with some very simple modifications
 * @extends {ActorSheet}
 */
export class StargazerActorSheet extends ActorSheet {

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["stargazer", "sheet", "actor", "character"],
      width: 800,
      height: 800,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "stats", }]
    });
  }

  /** @override */
  get template() {
    return `systems/stargazer/templates/actor/actor-${this.actor.type}-sheet.hbs`;
  }
  
  // async _renderOuter() {
//   const html = await super._renderOuter();
//   const theme = document.body.dataset.theme ?? "dark";
//   html[0].dataset.theme = theme;
//   html[0].classList.remove("theme-light", "theme-dark");
//   html[0].classList.add(`theme-${theme}`);
//   return html;
// }
  /* -------------------------------------------- */
  /** @override */
  async getData() {

    if (!Array.isArray(this.actor.system.wounds)) {
        await this.actor.update({ "system.wounds": [] });
    }
    // Use a safe clone of the actor data for further operations.
    const context = super.getData();
    const prototypeToken = {};

    // Use a safe clone of the actor data for further operations.
    const actorData = this.actor.toObject(false);

    // Add the actor's data to context.data for easier access, as well as flags.
    context.system = actorData.system;
    context.flags = actorData.flags;
    context.config = CONFIG.STARGAZER;

    // Prepare character data and items.
    if (actorData.type == 'character') {
      // Ensure prototype tokens are linked by default
    if (this.actor.prototypeToken.actorLink !== true) {
      await this.actor.update({ "prototypeToken.actorLink": true });
    }
      this._prepareCharacterData(context);
    }
    

    // Enrich biography info for display
    // Enrichment turns text like `[[/r 1d20]]` into buttons
    context.enrichedcharacterNotes = await TextEditor.enrichHTML(
      this.actor.system.notes.characterNotes
    );
    context.enrichedextraNotes = await TextEditor.enrichHTML(
      this.actor.system.notes.extraNotes
    );
    context.enrichedwoundNotes = await TextEditor.enrichHTML(
      this.actor.system.notes.woundNotes
    );

    // Add roll data for TinyMCE editors.
    context.rollData = context.actor.getRollData();

    context.system.enrichedHTML = await TextEditor.enrichHTML(
      context.system.description
    );
    
    // Retrieve saved active action point index
    const activeActionIndex = this.actor.getFlag("stargazer", "activeActionPoint") || 0;
    context.activeActionPoint = activeActionIndex;

    const activeResolveIndex = this.actor.getFlag("stargazer", "activeResolvePoint") || 0;
    context.activeResolvePoint = activeResolveIndex;

    const activeHeartIndex = this.actor.getFlag("stargazer", "activeHeartPoint") || 0;
    context.activeHeartPoint = activeHeartIndex;

    // Free dice value persisted across re-renders
    context.freeDiceValue = this.actor.getFlag("stargazer", "freeDice") || "";

    // Bar customisation
    context.resolveName  = this.actor.getFlag("stargazer", "resolveName")  || "";
    context.resolveColor = this.actor.getFlag("stargazer", "resolveColor") || "#ff482b";
    context.heartName    = this.actor.getFlag("stargazer", "heartName")    || "";
    context.heartColor   = this.actor.getFlag("stargazer", "heartColor")   || "#efda06";

    // --- Actions & Edges (flag-backed) ---
    const rawActions = Array.isArray(this.actor.getFlag("stargazer", "actions"))
      ? this.actor.getFlag("stargazer", "actions")
      : [];
    context.actions = rawActions.map(a => ({
      name: (a && typeof a.name === "string") ? a.name : "",
      edges: Array.isArray(a?.edges) ? a.edges.map(e => ({
        type: e?.type || "skill",
        dulled: !!e?.dulled
      })) : []
    }));

    // --- Inventory: Catalogues & Stuff (flag-backed) ---
    const rawCatalogues = Array.isArray(this.actor.getFlag("stargazer", "catalogues"))
      ? this.actor.getFlag("stargazer", "catalogues")
      : [];
    context.catalogues = rawCatalogues.map(c => ({
      name: (c && typeof c.name === "string") ? c.name : "",
      boxes: Array.isArray(c?.boxes) ? c.boxes.map(b => ({ checked: !!b?.checked })) : []
    }));
    context.stuffNotes = this.actor.getFlag("stargazer", "stuffNotes") || "";


// --- prepare wounds for the template: build segments so template is helper-free ---
context.system = context.system || {};
const rawWounds = Array.isArray(this.actor.getFlag("stargazer", "wounds"))
  ? this.actor.getFlag("stargazer", "wounds")
  : (Array.isArray(context.system.wounds) ? context.system.wounds : []);

context.system.wounds = rawWounds.map(w => {
  const name = (w && typeof w.name === "string") ? w.name : "";
  const value = Number.isFinite(Number(w?.value)) ? Number(w.value) : 0;
  const thresholds = Array.isArray(w?.thresholds) ? w.thresholds : ["", "", "", "", ""];
  const boxes = [];
  for (let i = 1; i <= 6; i++) {
    boxes.push({
      n: i,
      filled: i <= value,
      skull: i === 6,
      threshold: i < 6 ? (thresholds[i - 1] ?? "") : null,
      thresholdIndex: i - 1,
      hasThreshold: i < 6
    });
  }
  return { name, value, thresholds, boxes };
});

    
    return context;
  }
  
  /**
   * Organize and classify Items for Character sheets.
   *
   * @param {Object} actorData The actor to prepare.
   *
   * @return {undefined}
   */
/**
 * Organize and classify Items for Character sheets.
 * Ensures container contents are accessible and only top-level items are shown in the main list.
 */
  _prepareCharacterData(context) {
    // Handle ability scores.
    
  }
  /* -------------------------------------------- */

  /** @override */
async activateListeners(html) {
  
  super.activateListeners(html);
  // Await the initialization call before adding listeners
  await this._ensureWoundsInitialized().catch(e => console.error("Wounds init failed", e));

  // -------------------------------------------------------------
  // Everything below here is only needed if the sheet is editable
  if (!this.isEditable) return;


  // Rollable abilities.
  html.on('click', '.rollable, .dice-roll-btn', this._onRoll.bind(this));

  // Free dice — persist to flag on change so value survives re-renders
  html.on("change", ".free-dice-input", async (ev) => {
    const val = parseInt(ev.currentTarget.value, 10);
    await this.actor.setFlag("stargazer", "freeDice", isNaN(val) ? "" : val);
  });

  // Retrieve saved index
  const activeActionIndex = this.actor.getFlag("stargazer", "activeActionPoint") || 0;
  const activeResolveIndex = this.actor.getFlag("stargazer", "activeResolvePoint") || 0;
  const activeHeartIndex = this.actor.getFlag("stargazer", "activeHeartPoint") || 0;

  // Apply bar colors from flags
  const resolveColor = this.actor.getFlag("stargazer", "resolveColor") || "#ff482b";
  const heartColor   = this.actor.getFlag("stargazer", "heartColor")   || "#efda06";

  // Inject scoped style overrides — inline styles can't beat the `~ *` CSS sibling rule
  const styleId = `sgz-bar-colors-${this.actor.id}`;
  document.getElementById(styleId)?.remove();
  const styleEl = document.createElement("style");
  styleEl.id = styleId;
  styleEl.textContent = `
    .resolve-number.active, .resolve-number.active ~ * { background-color: ${resolveColor} !important; }
    .heart-number.active,   .heart-number.active ~ *   { background-color: ${heartColor}   !important; }
  `;
  document.head.appendChild(styleEl);

  const _updateBarStyles = (resColor, htColor) => {
    styleEl.textContent = `
      .resolve-number.active, .resolve-number.active ~ * { background-color: ${resColor} !important; }
      .heart-number.active,   .heart-number.active ~ *   { background-color: ${htColor}  !important; }
    `;
  };

  // Bar name inputs — auto-size width to content, save on change
  const _sizeNameInput = (el) => {
    el.style.width = Math.max(1.7, el.value.length) + "ch";
  };
  html.find(".resource-name-input").each((_, el) => _sizeNameInput(el));
  html.on("input", ".resource-name-input", (ev) => _sizeNameInput(ev.currentTarget));
  html.on("change", ".resource-name-input", async (ev) => {
    const resource = ev.currentTarget.dataset.resource;
    await this.actor.setFlag("stargazer", `${resource}Name`, ev.currentTarget.value);
  });

  // Color pickers — update style tag live and save on change
  let currentResolveColor = resolveColor;
  let currentHeartColor   = heartColor;
  html.on("input", ".resource-color-input", (ev) => {
    const resource = ev.currentTarget.dataset.resource;
    const color = ev.currentTarget.value;
    if (resource === "resolve") currentResolveColor = color;
    else currentHeartColor = color;
    _updateBarStyles(currentResolveColor, currentHeartColor);
  });
  html.on("change", ".resource-color-input", async (ev) => {
    const resource = ev.currentTarget.dataset.resource;
    const color = ev.currentTarget.value;
    await this.actor.setFlag("stargazer", `${resource}Color`, color);
  });


  // Find all action-number elements
    const actionPoints = html.find(".action-number");

    if (actionPoints.length > 0 && activeActionIndex < actionPoints.length) {
      actionPoints.removeClass("active"); // Remove all active classes
      actionPoints.eq(activeActionIndex).addClass("active"); // Add active to saved index
    }

    // Attach click event
    html.on("click", ".action-number", (event) => this._onAction(event));

  // Find all resolve-number elements
    const resolvePoints = html.find(".resolve-number");

    if (resolvePoints.length > 0 && activeResolveIndex < resolvePoints.length) {
      resolvePoints.removeClass("active"); // Remove all active classes
      resolvePoints.eq(activeResolveIndex).addClass("active"); // Add active to saved index
    }

    // Attach click event
    html.on("click", ".resolve-number", (event) => this._onResolve(event));

  // Find all heart-number elements
    const heartPoints = html.find(".heart-number");

    if (heartPoints.length > 0 && activeHeartIndex < heartPoints.length) {
      heartPoints.removeClass("active"); // Remove all active classes
      heartPoints.eq(activeHeartIndex).addClass("active"); // Add active to saved index
    }

    // Attach click event
    html.on("click", ".heart-number", (event) => this._onHeart(event));

  // Add wound
// --- WOUNDS: robust handlers (drop-in replacement) ---
/* Ensure handler uses live actor data, duplicates before writing,
   and logs so we can verify behavior in the console. */
// Replace the id string below with the actor id from previous step


// --- WOUNDS (flag-backed, robust handlers) ---
html.on("click", ".add-wound", async (ev) => {
  ev.preventDefault();
  console.log("Stargazer | add-wound clicked for actor", this.actor?.name);

  // Read the latest wounds from flags
  const current = Array.isArray(this.actor.getFlag("stargazer", "wounds"))
    ? foundry.utils.deepClone(this.actor.getFlag("stargazer", "wounds"))
    : [];

  current.push({ name: "", value: 0, thresholds: ["", "", "", "", ""] });

  // Save into an actor flag (persistent per-actor)
  await this.actor.setFlag("stargazer", "wounds", current);

  // Re-render so the sheet updates immediately
  this.render();
});

html.on("click", ".remove-wound", async (ev) => {
  ev.preventDefault();
  const woundEl = $(ev.currentTarget).closest(".wound");
  const index = Number(woundEl.data("index"));
  console.log("Stargazer | remove-wound idx", index, "actor", this.actor?.name);

  const current = Array.isArray(this.actor.getFlag("stargazer", "wounds"))
    ? foundry.utils.deepClone(this.actor.getFlag("stargazer", "wounds"))
    : [];

  if (Number.isInteger(index) && current[index]) {
    current.splice(index, 1);
    await this.actor.setFlag("stargazer", "wounds", current);
    this.render();
  } else ui.notifications.warn("Could not remove wound (index not found).");
});

html.on("click", ".wound .wound-tracker .box", async (ev) => {
  ev.preventDefault();
  const box = $(ev.currentTarget);
  const woundEl = box.closest(".wound");
  const index = Number(woundEl.data("index"));
  const value = Number(box.data("value"));

  const current = Array.isArray(this.actor.getFlag("stargazer", "wounds"))
    ? foundry.utils.deepClone(this.actor.getFlag("stargazer", "wounds"))
    : [];

  if (!current[index]) current[index] = { name: "", value: 0, thresholds: ["", "", "", "", ""] };
  current[index].value = (current[index].value === value) ? value - 1 : value;

  await this.actor.setFlag("stargazer", "wounds", current);
  this.render();
});

html.on("change", ".wound-threshold", async (ev) => {
  const input = ev.currentTarget;
  const woundEl = $(input).closest(".wound");
  const index = Number(woundEl.data("index"));
  const threshIdx = Number(input.dataset.thresholdIndex);

  const current = Array.isArray(this.actor.getFlag("stargazer", "wounds"))
    ? foundry.utils.deepClone(this.actor.getFlag("stargazer", "wounds"))
    : [];

  if (!current[index]) current[index] = { name: "", value: 0, thresholds: ["", "", "", "", ""] };
  if (!Array.isArray(current[index].thresholds)) current[index].thresholds = ["", "", "", "", ""];

  // If a value was entered, clear all other threshold fields for this wound
  if (input.value.trim() !== "") {
    current[index].thresholds = ["", "", "", "", ""];
    current[index].thresholds[threshIdx] = input.value;
    // Clear the other inputs in the DOM immediately
    woundEl.find(".wound-threshold").not(input).val("");
  } else {
    current[index].thresholds[threshIdx] = "";
  }

  await this.actor.setFlag("stargazer", "wounds", current);
});

// -------------------- ACTIONS & EDGES --------------------

const _getActions = () => Array.isArray(this.actor.getFlag("stargazer", "actions"))
  ? foundry.utils.deepClone(this.actor.getFlag("stargazer", "actions"))
  : [];

// Add a new Action
html.on("click", ".action-create", async (ev) => {
  ev.preventDefault();
  const actions = _getActions();
  actions.push({ name: "", edges: [] });
  await this.actor.setFlag("stargazer", "actions", actions);
  this.render();
});

// Remove an Action
html.on("click", ".action-delete", async (ev) => {
  ev.preventDefault();
  const index = Number($(ev.currentTarget).closest(".action-entry").data("index"));
  const actions = _getActions();
  if (Number.isInteger(index) && actions[index]) {
    actions.splice(index, 1);
    await this.actor.setFlag("stargazer", "actions", actions);
    this.render();
  }
});

// Rename an Action
html.on("change", ".action-name", async (ev) => {
  const index = Number($(ev.currentTarget).closest(".action-entry").data("index"));
  const actions = _getActions();
  if (!actions[index]) return;
  actions[index].name = ev.currentTarget.value;
  await this.actor.setFlag("stargazer", "actions", actions);
});

// Add an Edge to an Action
html.on("click", ".edge-add", async (ev) => {
  ev.preventDefault();
  const entry = $(ev.currentTarget).closest(".action-entry");
  const index = Number(entry.data("index"));
  const type = entry.find(".edge-type-select").val() || "skill";
  const actions = _getActions();
  if (!actions[index]) return;
  if (!Array.isArray(actions[index].edges)) actions[index].edges = [];
  actions[index].edges.push({ type, dulled: false });
  await this.actor.setFlag("stargazer", "actions", actions);
  this.render();
});

// Remove an Edge from an Action
html.on("click", ".edge-remove", async (ev) => {
  ev.preventDefault();
  ev.stopPropagation();
  const pip = $(ev.currentTarget).closest(".edge-pip");
  const actionIndex = Number(pip.closest(".action-entry").data("index"));
  const edgeIndex = Number(pip.data("edge-index"));
  const actions = _getActions();
  if (!actions[actionIndex]?.edges?.[edgeIndex]) return;
  actions[actionIndex].edges.splice(edgeIndex, 1);
  await this.actor.setFlag("stargazer", "actions", actions);
  this.render();
});

// Toggle an Edge's dulled state (click the pip itself, not the remove icon)
html.on("click", ".edge-pip", async (ev) => {
  if ($(ev.target).closest(".edge-remove").length) return; // handled above
  ev.preventDefault();
  const pip = $(ev.currentTarget);
  const actionIndex = Number(pip.closest(".action-entry").data("index"));
  const edgeIndex = Number(pip.data("edge-index"));
  const actions = _getActions();
  const edge = actions[actionIndex]?.edges?.[edgeIndex];
  if (!edge) return;
  edge.dulled = !edge.dulled;
  await this.actor.setFlag("stargazer", "actions", actions);
  this.render();
});

// -------------------- INVENTORY: CATALOGUES & STUFF --------------------

const _getCatalogues = () => Array.isArray(this.actor.getFlag("stargazer", "catalogues"))
  ? foundry.utils.deepClone(this.actor.getFlag("stargazer", "catalogues"))
  : [];

// Add a new Catalogue
html.on("click", ".catalogue-create", async (ev) => {
  ev.preventDefault();
  const catalogues = _getCatalogues();
  catalogues.push({ name: "", boxes: [] });
  await this.actor.setFlag("stargazer", "catalogues", catalogues);
  this.render();
});

// Remove a Catalogue
html.on("click", ".catalogue-delete", async (ev) => {
  ev.preventDefault();
  const index = Number($(ev.currentTarget).closest(".catalogue-entry").data("index"));
  const catalogues = _getCatalogues();
  if (Number.isInteger(index) && catalogues[index]) {
    catalogues.splice(index, 1);
    await this.actor.setFlag("stargazer", "catalogues", catalogues);
    this.render();
  }
});

// Rename a Catalogue
html.on("change", ".catalogue-name", async (ev) => {
  const index = Number($(ev.currentTarget).closest(".catalogue-entry").data("index"));
  const catalogues = _getCatalogues();
  if (!catalogues[index]) return;
  catalogues[index].name = ev.currentTarget.value;
  await this.actor.setFlag("stargazer", "catalogues", catalogues);
});

// Add a checkbox to a Catalogue
html.on("click", ".catalogue-box-add", async (ev) => {
  ev.preventDefault();
  const index = Number($(ev.currentTarget).closest(".catalogue-entry").data("index"));
  const catalogues = _getCatalogues();
  if (!catalogues[index]) return;
  if (!Array.isArray(catalogues[index].boxes)) catalogues[index].boxes = [];
  catalogues[index].boxes.push({ checked: false });
  await this.actor.setFlag("stargazer", "catalogues", catalogues);
  this.render();
});

// Remove the last checkbox from a Catalogue
html.on("click", ".catalogue-box-remove", async (ev) => {
  ev.preventDefault();
  const index = Number($(ev.currentTarget).closest(".catalogue-entry").data("index"));
  const catalogues = _getCatalogues();
  if (!catalogues[index]?.boxes?.length) return;
  catalogues[index].boxes.pop();
  await this.actor.setFlag("stargazer", "catalogues", catalogues);
  this.render();
});

// Toggle a Catalogue checkbox
html.on("change", ".catalogue-box", async (ev) => {
  const box = $(ev.currentTarget);
  const catalogueIndex = Number(box.closest(".catalogue-entry").data("index"));
  const boxIndex = Number(box.data("box-index"));
  const catalogues = _getCatalogues();
  if (!catalogues[catalogueIndex]?.boxes?.[boxIndex]) return;
  catalogues[catalogueIndex].boxes[boxIndex].checked = ev.currentTarget.checked;
  await this.actor.setFlag("stargazer", "catalogues", catalogues);
});

// Stuff notes (free text)
html.on("change", ".stuff-notes", async (ev) => {
  await this.actor.setFlag("stargazer", "stuffNotes", ev.currentTarget.value);
});

}

/** Ensure wounds flag exists and migrate any system.wounds into the flag store */
async _ensureWoundsInitialized() {
  // If flags already have wounds and it's an array, nothing to do
  const flagWounds = this.actor.getFlag("stargazer", "wounds");
  if (Array.isArray(flagWounds)) return;

  // If old system.wounds exists and is an array, migrate it
  const systemWounds = foundry.utils.getProperty(this.actor.system, "wounds");
  if (Array.isArray(systemWounds)) {
    await this.actor.setFlag("stargazer", "wounds", foundry.utils.deepClone(systemWounds));
    console.log(`Stargazer | migrated system.wounds -> flags for actor ${this.actor.name}`);
    return;
  }

  // Otherwise, create an empty wounds array on the flag to be safe
  await this.actor.setFlag("stargazer", "wounds", []);
}


  /**
   * Handle creating a new Owned Item for the actor using initial data defined in the HTML dataset
   * @param {Event} event   The originating click event
   * @private
   */





async _onRoll(event) {
  event.preventDefault();
  const element = event.currentTarget;
  const dataset = element.dataset;

  if (!dataset.roll) return;

  const rollTemplate = dataset.roll;
  const match = rollTemplate.match(/\(@([\w.]+)\)/);
  if (!match) {
    ui.notifications.warn("Invalid roll formula.");
    return;
  }

  const path = match[1];
  const rollData = this.actor.getRollData();
  const diceCount = foundry.utils.getProperty(rollData, path);
  if (!Number.isNumeric(diceCount)) {
    ui.notifications.warn("Invalid number of dice.");
    return;
  }

  // Read free dice from flag (persisted) — DOM input is just the UI
  const freeDice = parseInt(this.actor.getFlag("stargazer", "freeDice") || 0, 10) || 0;

  const baseDice  = Number(diceCount);
  const totalDice = baseDice + freeDice;

  // Roll all dice in one roll for DSN to pick up, but track which are free
  const formula = `${totalDice}d6`;
  const roll = new Roll(formula, rollData);
  await roll.evaluate({ async: true });

  // Split results: first baseDice are action dice, remainder are free dice
  const allResults = roll.dice[0].results.map(r => r.result);
  const actionResults = allResults.slice(0, baseDice);
  const freeResults   = allResults.slice(baseDice);

  const countSuccesses = (arr) => arr.filter(v => v >= 4).length;
  const actionSuccesses = countSuccesses(actionResults);
  const freeSuccesses   = countSuccesses(freeResults);

  // Build pip HTML helper
  const pipHTML = (results, colorClass) =>
    results.map(v => {
      const success = v >= 4;
      return `<span class="roll-pip ${colorClass} ${success ? "success" : "fail"}" title="${v}">${v}</span>`;
    }).join("");

  const actionPips = pipHTML(actionResults, "pip-action");
  const freePips   = freeDice > 0 ? pipHTML(freeResults, "pip-free") : "";

  const label = dataset.label ? `${dataset.score} Dice` : "Roll";

  const chatContent = `
    <div class="stargazer-roll-card">
      <div class="roll-header">${label}</div>
      <div class="roll-section">
        <span class="roll-section-label">Action (${baseDice}d6):</span>
        <span class="roll-pips">${actionPips}</span>
        <span class="roll-successes">${actionSuccesses} ${actionSuccesses !== 1 ? "" : ""}</span>
      </div>
      ${freeDice > 0 ? `
      <div class="roll-section roll-section-free">
        <span class="roll-section-label">Free (${freeDice}d6):</span>
        <span class="roll-pips">${freePips}</span>
        <span class="roll-successes">${freeSuccesses} ${freeSuccesses !== 1 ? "" : ""}</span>
      </div>
      ` : ""}
      <div class="roll-total">Total: <strong>${actionSuccesses + freeSuccesses}</strong> successes</div>
    </div>`;

  await ChatMessage.create({
    content: chatContent,
    speaker: ChatMessage.getSpeaker({ actor: this.actor }),
    rolls: [roll],
    sound: CONFIG.sounds?.dice,
  });

  return roll;
}

async _onAction(event) {
  event.preventDefault();
  
  const point = event.currentTarget;
  const allPoints = Array.from(point.parentNode.children);

  // Remove "active" class from all action points
  allPoints.forEach((p) => p.classList.remove("active"));

  // Add "active" class to the clicked one
  point.classList.add("active");

  // Get the index of the selected action point
  const index = allPoints.indexOf(point);
  console.log("Saving active action point index:", index);

  // Save to actor's flags
  await this.actor.setFlag("stargazer", "activeActionPoint", index);
}
async _onResolve(event) {
  event.preventDefault();
  const point = event.currentTarget;
  const allPoints = Array.from(point.parentNode.children);
  allPoints.forEach((p) => { p.classList.remove("active"); p.style.backgroundColor = ""; });
  point.classList.add("active");
  const index = allPoints.indexOf(point);
  await this.actor.setFlag("stargazer", "activeResolvePoint", index);
}
async _onHeart(event) {
  event.preventDefault();
  const point = event.currentTarget;
  const allPoints = Array.from(point.parentNode.children);
  allPoints.forEach((p) => { p.classList.remove("active"); p.style.backgroundColor = ""; });
  point.classList.add("active");
  const index = allPoints.indexOf(point);
  await this.actor.setFlag("stargazer", "activeHeartPoint", index);
}


}
