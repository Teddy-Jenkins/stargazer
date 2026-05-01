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
  //   html[0].classList.remove("theme-light", "theme-dark"); // ← new
  //   html[0].classList.add(`theme-${theme}`);               // ← new
  //   return html;
  // }
  /* -------------------------------------------- */
/**
 * Manually fetches and registers a template partial.
 * This is a robust fallback when the static preloadTemplates method fails.
 * @private
 */
async _registerItemEntryPartial() {
    const templatePath = "systems/stargazer/templates/actor/parts/item-entry.hbs";
    if (Handlebars.partials[templatePath] || Handlebars.partials["item-entry"]) {
      if (this.constructor.DEBUG) console.debug("Stargazer | item-entry partial already registered.");
      return;
    }
    try {
      const res = await fetch(templatePath);
      const content = await res.text();
      // register under both full path and a friendly alias for templates
      Handlebars.registerPartial(templatePath, content);
      Handlebars.registerPartial("item-entry", content);
      if (this.constructor.DEBUG) console.debug("Stargazer | Registered partial:", templatePath);
    } catch (err) {
      console.error("Stargazer | Failed to register item-entry partial:", err);
    }
  }
  
  /** @override */
  async getData() {

    await this._registerItemEntryPartial();
    await this._migrateItemData();

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
      await this._prepareItems(context);
      this._prepareCharacterData(context);
    }

    // Prepare NPC data and items.
    if (actorData.type == 'npc') {
      await this._prepareItems(context);

    }
    

    // Enrich biography info for display
    // Enrichment turns text like `[[/r 1d20]]` into buttons
    context.enrichedskillNotes = await TextEditor.enrichHTML(
      this.actor.system.notes.skillNotes
    );
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


// --- prepare wounds for the template: build segments so template is helper-free ---
context.system = context.system || {};
const rawWounds = Array.isArray(this.actor.getFlag("stargazer","wounds"))
  ? this.actor.getFlag("stargazer","wounds")
  : (Array.isArray(context.system.wounds) ? context.system.wounds : []);

context.system.wounds = rawWounds.map(w => {
  const name = (w && typeof w.name === "string") ? w.name : "";
  const value = Number.isFinite(Number(w?.value)) ? Number(w.value) : 0;
  const segments = [];
  for (let i = 1; i <= 16; i++) {
    segments.push({
      n: i,
      filled: i <= value,
      skull: i === 16
    });
  }
  return { name, value, segments };
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
/**
 * Organize and classify Items for Character sheets.
 * Ensures container contents are accessible and only top-level items are shown in the main list.
 */
async _prepareItems(context) {
  const allItems = this.actor.items.map((i) => i.toObject(false));
  const itemMap = new Map();

  // First pass: initialize all items
  for (const item of allItems) {
    item.isContainer = item.type === "container";
    item.isItem = item.type === "item";
    if (item.isContainer) {
      item.contents = [];
      item.usedSlots = 0;
      // Calculate effective capacity based on packed status
      item.effectiveCapacity = item.system.packed ? 5 : 3;
    }
    itemMap.set(item._id, item);
  }

  const topLevelItems = [];

  // Second pass: organize hierarchy and calculate container usage
  for (const item of allItems) {
    const parentId = item.system?.parentContainerId;
    if (parentId && itemMap.has(parentId)) {
      const parent = itemMap.get(parentId);
      parent.contents.push(item);
      // Calculate used slots in container
      if (item.isItem) {
        parent.usedSlots += Number(item.system?.slots || 1);
      }
    } else {
      topLevelItems.push(item);
    }
  }

  console.log("Stargazer | PrepareItems: All items:", allItems.map(i => ({
    id: i._id,
    name: i.name,
    type: i.type,
    parentContainerId: i.system?.parentContainerId
  })));

  console.log("Stargazer | PrepareItems: Top-level items:",
    topLevelItems.map((i) => ({
      id: i._id,
      name: i.name,
      type: i.type,
      parent: i.system?.parentContainerId || "top-level",
      contents: i.contents?.map((c) => ({ id: c._id, name: c.name })),
      usedSlots: i.usedSlots,
      capacity: i.system?.capacity
    }))
  );

  context.topLevelItems = topLevelItems;
}

  _prepareCharacterData(context) {
    // Handle ability scores.
    
  }
  /* -------------------------------------------- */

  /** @override */
async activateListeners(html) {
  
  super.activateListeners(html);
  // Await the initialization call before adding listeners
  await this._ensureWoundsInitialized().catch(e => console.error("Wounds init failed", e));

  // Calculate carry capacity on initial render
  await this._calculateCarryCapacity(this.actor);

  // -------------------------------------------------------------
  // Everything below here is only needed if the sheet is editable
  if (!this.isEditable) return;

// -------------------- INVENTORY HANDLERS (FIXED) --------------------

const sheet = this;
    const actor = this.actor;

    // Initialize expanded items tracking on the sheet instance
    if (!this._expandedItems) {
      this._expandedItems = new Set();
    }

    // COLLAPSIBLE - with state persistence (stored in memory to avoid render loops)
    html.on("click", ".collapsible-name", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const btn = $(ev.currentTarget);
      const li = btn.closest(".inventory-entry");
      const itemId = li.attr("data-item-id") || li.data("itemId");
      const content = li.find(".item-content").first();
      if (!content.length) return;

      // Check current state
      const isCurrentlyExpanded = content.hasClass("expanded");

      // Toggle UI immediately
      if (isCurrentlyExpanded) {
        // Collapse
        content.removeClass("expanded");
        this._expandedItems.delete(itemId);
      } else {
        // Expand
        content.addClass("expanded");
        this._expandedItems.add(itemId);
      }
    });

    // Note: Drag and drop handlers are set up below using jQuery event delegation
    // This provides better compatibility and easier debugging


    // CREATE TOP-LEVEL
    html.on("click", ".inventory-create", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const type = ev.currentTarget.dataset.type;
      if (!type) return ui.notifications.error("No item type specified.");
      const systemData = type === "item"
        ? { slots: 1, description: "", parentContainerId: null }
        : { capacity: 10, packed: false, parentContainerId: null };
      try {
        const created = await actor.createEmbeddedDocuments("Item", [{
          name: type === "item" ? "New Item" : "New Container",
          type,
          system: systemData
        }]);
        if (this.constructor.DEBUG) console.debug("Create top-level returned:", created);
        await this._calculateCarryCapacity(actor);
        this.render();
      } catch (err) {
        console.error("Create failed:", err);
        ui.notifications.error("Item creation failed (see console).");
      }
    });

    // CREATE IN CONTAINER
    html.on("click", ".container-add-item", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const containerId = ev.currentTarget.dataset.containerId;
      if (!containerId) return ui.notifications.error("No container id specified.");
      try {
        const created = await actor.createEmbeddedDocuments("Item", [{
          name: "New Item",
          type: "item",
          system: { slots: 1, description: "", parentContainerId: containerId }
        }]);
        if (this.constructor.DEBUG) console.debug("Create in container returned:", created);
        await this._calculateCarryCapacity(actor);
        this.render();
      } catch (err) {
        console.error("Create in container failed:", err);
        ui.notifications.error("Create-in-container failed (see console).");
      }
    });

    // EDIT
    html.on("click", ".inventory-edit", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const li = $(ev.currentTarget).closest(".inventory-entry");
      const itemId = li.attr("data-item-id") || li.data("itemId");
      const item = actor.items.get(itemId);
      if (!item) {
        ui.notifications.warn("Item not found on actor for editing. See console.");
        console.warn("inventory-edit: item not found", { itemId, actorItemIds: actor.items.map(i => i.id) });
        return;
      }
      item.sheet.render(true);
    });

    // DELETE (deleteEmbeddedDocuments ensures server sync)
    html.on("click", ".inventory-delete", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const li = $(ev.currentTarget).closest(".inventory-entry");
      const itemId = li.attr("data-item-id") || li.data("itemId");
      const item = actor.items.get(itemId);
      if (!item) return ui.notifications.warn("Item not found for delete.");

      if (item.type === "container") {
        const contents = actor.items.filter(i => i.system?.parentContainerId === item.id);
        if (contents.length > 0) {
          const confirm = await Dialog.confirm({
            title: "Delete Container",
            content: `<p>This container has ${contents.length} item(s). Delete the container and contents?</p>`,
            yes: () => true,
            no: () => false
          });
          if (!confirm) return;
          // Delete contents first
          await actor.deleteEmbeddedDocuments("Item", contents.map(i => i.id));
        }
      }

      try {
        await actor.deleteEmbeddedDocuments("Item", [item.id]);
        // Carry capacity will be recalculated on render
        // No need to call it explicitly
      } catch (err) {
        console.error("Delete failed:", err);
        ui.notifications.error("Delete failed (see console).");
      }
    });

    // REMOVE FROM CONTAINER (un-parent)
    html.on("click", ".container-remove-item", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const li = $(ev.currentTarget).closest("li.inventory-entry");
      const itemId = li.attr("data-item-id") || li.data("itemId");
      const item = actor.items.get(itemId);
      if (!item) return ui.notifications.warn("Item not found for remove.");
      await item.update({ "system.parentContainerId": null });
      await this._calculateCarryCapacity(actor);
      this.render();
    });

    // TOGGLE PACKED
    html.on("click", ".inventory-toggle-packed", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const li = $(ev.currentTarget).closest(".inventory-entry");
      const itemId = li.attr("data-item-id") || li.data("itemId");
      const container = actor.items.get(itemId);
      if (!container) return;
      await container.update({ "system.packed": !container.system.packed });
      this.render();
    });

    // ---------------------- DRAG & DROP ----------------------
    // Ensure items are drag-enabled in DOM (keeps consistent after re-render)
    html.find(".inventory-entry").attr("draggable", "true");
    html.find(".inventory-entry, .container-item").css("touch-action", "none"); // mobile safety

    // Delegate dragstart -> _onDragStart
    if (this.actor.isOwner) {
      html.on("dragstart", ".inventory-entry", (ev) => {
        // jQuery wraps native; pass the jQuery event
        this._onDragStart(ev);
      });
    }

    // dragend cleanup
    html.on("dragend", ".inventory-entry", (ev) => {
      const li = $(ev.currentTarget);
      li.removeClass("dragging");
      delete this._draggedItemId;
    });

    // dragover visuals + allow drop
    html.on("dragover", ".inventory-list, .container-contents, .inventory-entry[data-item-type='container']", (ev) => {
      ev.preventDefault();
      ev.originalEvent.dataTransfer.dropEffect = "move";

      // Find the actual container or list element to highlight
      const $element = $(ev.originalEvent.target);
      const $container = $element.closest(".inventory-entry[data-item-type='container']");
      const $contents = $element.closest(".container-contents");
      const $list = $element.closest(".inventory-list");

      if ($container.length && !$contents.length) {
        // Dropped on container header - highlight the container
        $container.addClass("highlight-drop");
      } else if ($contents.length) {
        // Dropped in container contents area - highlight the contents area
        $contents.addClass("highlight-drop");
      } else if ($list.length) {
        // Dropped on main inventory list
        $list.addClass("highlight-drop");
      }

      return false;
    });

    html.on("dragleave", ".inventory-list, .container-contents, .inventory-entry[data-item-type='container']", (ev) => {
      const $target = $(ev.currentTarget);
      const related = ev.originalEvent.relatedTarget;
      if (!$target[0].contains(related)) {
        $target.removeClass("highlight-drop");
      }
    });

    // Drop: robust parsing of dataTransfer + fallbacks
    html.on("drop", ".inventory-list, .container-contents, .inventory-entry[data-item-type='container']", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      console.log("Stargazer | DROP EVENT FIRED");
      $(ev.currentTarget).removeClass("highlight-drop");
      html.find(".highlight-drop").removeClass("highlight-drop");

      // Attempt to parse the dataTransfer payload
      let raw = "";
      try { raw = ev.originalEvent.dataTransfer.getData("text/plain"); } catch (err) { raw = ""; }

      console.log("Stargazer | Drop raw payload:", raw);

      let parsed = null;
      let itemId = null;
      let originActorId = null;

      if (raw) {
        try {
          parsed = JSON.parse(raw);
          // support shapes: { type:'Item', id:'..', actorId:'..' } or { id: '...' }
          if (parsed && typeof parsed === "object") {
            itemId = parsed.id || parsed.itemId || parsed._id;
            originActorId = parsed.actorId || parsed.actor;
          } else if (typeof parsed === "string") {
            itemId = parsed;
          }
        } catch (err) {
          // not JSON — plain string id
          itemId = raw;
        }
      }

      // Fallback to sheet-held id (set on dragstart)
      if (!itemId && sheet._draggedItemId) itemId = sheet._draggedItemId;

      // Fallback: find dragging element in DOM
      if (!itemId) {
        const dragging = html.find(".inventory-entry.dragging").first();
        if (dragging.length) itemId = dragging.attr("data-item-id") || dragging.data("itemId");
      }

      if (!itemId) {
        console.warn("Stargazer | Drop could not resolve item id.", { raw, parsed, sheetDragged: sheet._draggedItemId });
        return;
      }

      console.log("Stargazer | Resolved itemId:", itemId);

      // Determine destination container id
      const $target = $(ev.currentTarget);
      const $dropElement = $(ev.originalEvent.target);
      let destContainerId = null;

      // Check if dropped inside container-contents area (takes priority)
      const $containerContents = $dropElement.closest(".container-contents");
      if ($containerContents.length) {
        destContainerId = $containerContents.attr("data-container-id") || $containerContents.data("containerId");
      }
      // Check if dropped on a container entry itself (anywhere on the container row)
      else {
        const $containerEntry = $dropElement.closest(".inventory-entry[data-item-type='container']");
        if ($containerEntry.length) {
          destContainerId = $containerEntry.attr("data-item-id") || $containerEntry.data("itemId");
        }
        // If not dropped on a container, check if dropped on main inventory or regular item
        else {
          const $inventoryList = $dropElement.closest(".inventory-list");
          if ($inventoryList.length) {
            // Dropped on main inventory list (or a regular item) - remove from any container
            destContainerId = null;
          }
        }
      }

      console.log("Stargazer | Drop destination containerId:", destContainerId);
      console.log("Stargazer | Drop $dropElement:", $dropElement[0]);
      console.log("Stargazer | Drop $target:", $target[0]);

      // CASE A: Item belongs to this actor: just update parentContainerId
      let itemDoc = actor.items.get(itemId);
      if (itemDoc) {
        try {
          // Prevent dropping item onto itself
          if (itemDoc.id === destContainerId) {
            if (this.constructor.DEBUG) console.warn("Drop aborted: cannot drop item into itself.");
            return;
          }
          const currentParent = itemDoc.system?.parentContainerId ?? null;
          if ((currentParent ?? null) === (destContainerId ?? null)) {
            if (this.constructor.DEBUG) console.debug("Drop: location unchanged.");
            return;
          }

          // Prevent nesting containers inside containers
          if (destContainerId && itemDoc.type === "container") {
            ui.notifications.warn("Cannot place a container inside another container.");
            return;
          }

          // Capacity check if destination is container
          if (destContainerId && itemDoc.type === "item") {
            const container = actor.items.get(destContainerId);
            if (!container || container.type !== "container") {
              ui.notifications.warn("Invalid container target.");
              return;
            }
            const currentContents = actor.items.filter(i => i.system?.parentContainerId === destContainerId && i.id !== itemId);
            const usedSlots = currentContents.reduce((s, i) => s + Number(i.system?.slots || 1), 0);
            const itemSlots = Number(itemDoc.system?.slots || 1);
            const capacity = container.system.packed ? 5 : 3;
            if (usedSlots + itemSlots > capacity) {
              ui.notifications.warn(`Container is full! (${usedSlots}/${capacity})`);
              return;
            }
          }

          console.log("Stargazer | About to update item, current parent:", itemDoc.system?.parentContainerId, "-> new parent:", destContainerId);
          console.log("Stargazer | Item system data before update:", itemDoc.system);
          console.log("Stargazer | Has parentContainerId field?", "parentContainerId" in itemDoc.system);

          const updateResult = await itemDoc.update({ "system.parentContainerId": destContainerId });

          console.log("Stargazer | Update returned:", updateResult);
          console.log("Stargazer | Item system data after update:", itemDoc.system);
          console.log("Stargazer | Item after update:", itemDoc.system?.parentContainerId);
          await this._calculateCarryCapacity(actor);
          this.render();
          console.log(`Stargazer | Successfully moved item ${itemId} -> ${destContainerId}`);
          return;
        } catch (err) {
          console.error("Drop update error (same actor):", err);
          ui.notifications.error("Item move failed (see console).");
          return;
        }
      }

      // CASE B: Item comes from other actor (parsed.actorId) or is raw item data
      try {
        // Attempt cross-actor copy if origin provided
        if (originActorId && originActorId !== actor.id) {
          if (this.constructor.DEBUG) console.debug("Drop: cross-actor copy requested:", parsed);
          const sourceActor = game.actors.get(originActorId);
          if (sourceActor) {
            const sourceItem = sourceActor.items.get(itemId);
            if (sourceItem) {
              const itemData = foundry.utils.deepClone(sourceItem.toObject(false));
              delete itemData._id;
              itemData.system = itemData.system || {};
              itemData.system.parentContainerId = destContainerId ?? null;
              const created = await actor.createEmbeddedDocuments("Item", [itemData]);
              if (this.constructor.DEBUG) console.debug("Drop: created copy from other actor:", created);
              await this._calculateCarryCapacity(actor);
              this.render();
              ui.notifications.info("Item copied to this actor.");
              return;
            }
          }
        }

        // If parsed looked like raw item data e.g. from a compendium or other UI
        if (parsed && (parsed.name || parsed.type)) {
          if (this.constructor.DEBUG) console.debug("Drop: raw item data create:", parsed);
          const itemData = {
            name: parsed.name || "New Item",
            type: parsed.type || "item",
            system: {
              slots: parsed.system?.slots ?? 1,
              description: parsed.system?.description ?? "",
              parentContainerId: destContainerId ?? null
            }
          };
          const created = await actor.createEmbeddedDocuments("Item", [itemData]);
          if (this.constructor.DEBUG) console.debug("Drop: created from raw data:", created);
          await this._calculateCarryCapacity(actor);
          this.render();
          return;
        }

        // Unknown origin
        console.warn("Drop: item not found on actor and no valid origin data.", { parsed, raw });
      } catch (err) {
        console.error("Drop: cross-actor or create flow failed:", err);
      }
    });


// -------------------- END INVENTORY HANDLERS --------------------

  // html.find(".item-content, .nested-items").on("dragover", (ev) => ev.preventDefault());

  // Rollable abilities.
  html.on('click', '.rollable', this._onRoll.bind(this));

  
  // Retrieve saved index
  const activeActionIndex = this.actor.getFlag("stargazer", "activeActionPoint") || 0;
  const activeResolveIndex = this.actor.getFlag("stargazer", "activeResolvePoint") || 0;
  const activeHeartIndex = this.actor.getFlag("stargazer", "activeHeartPoint") || 0;


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
    ? foundry.utils.duplicate(this.actor.getFlag("stargazer", "wounds"))
    : [];

  current.push({ name: "", value: 0 });

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
    ? foundry.utils.duplicate(this.actor.getFlag("stargazer", "wounds"))
    : [];

  if (Number.isInteger(index) && current[index]) {
    current.splice(index, 1);
    await this.actor.setFlag("stargazer", "wounds", current);
    this.render();
  } else ui.notifications.warn("Could not remove wound (index not found).");
});

html.on("click", ".wound .wound-tracker .segment", async (ev) => {
  ev.preventDefault();
  const seg = $(ev.currentTarget);
  const woundEl = seg.closest(".wound");
  const index = Number(woundEl.data("index"));
  const value = Number(seg.data("value"));
  console.log("Stargazer | segment click idx", index, "val", value, "actor", this.actor?.name);

  const current = Array.isArray(this.actor.getFlag("stargazer", "wounds"))
    ? foundry.utils.duplicate(this.actor.getFlag("stargazer", "wounds"))
    : [];

  if (!current[index]) current[index] = { name: "", value: 0 };
  current[index].value = Number.isFinite(value) ? value : 0;

  await this.actor.setFlag("stargazer", "wounds", current);
  this.render();
});

html.on("change", 'input[name^="system.wounds."]', async (ev) => {
  const input = ev.currentTarget;
  const parts = input.name.split(".");
  const index = Number(parts[2]);
  const prop = parts[3]; // "name"
  console.log("Stargazer | wound name change idx", index, "prop", prop, "value", input.value);

  const current = Array.isArray(this.actor.getFlag("stargazer", "wounds"))
    ? foundry.utils.duplicate(this.actor.getFlag("stargazer", "wounds"))
    : [];

  if (!current[index]) current[index] = { name: "", value: 0 };
  current[index][prop] = input.value;

  await this.actor.setFlag("stargazer", "wounds", current);
  // no immediate re-render required; the input changed visually already
});

// Restore expanded state for collapsible items (from memory)
if (this._expandedItems && this._expandedItems.size > 0) {
  this._expandedItems.forEach(itemId => {
    const li = html.find(`.inventory-entry[data-item-id="${itemId}"]`);
    if (li.length) {
      const content = li.find(".item-content").first();
      if (content.length) {
        content.addClass("expanded");
      }
    }
  });
}

}

/** Ensure wounds flag exists and migrate any system.wounds into the flag store */
async _ensureWoundsInitialized() {
  // If flags already have wounds and it's an array, nothing to do
  const flagWounds = this.actor.getFlag("stargazer", "wounds");
  if (Array.isArray(flagWounds)) return;

  // If old system.wounds exists and is an array, migrate it
  const systemWounds = foundry.utils.getProperty(this.actor.system, "wounds");
  if (Array.isArray(systemWounds)) {
    await this.actor.setFlag("stargazer", "wounds", foundry.utils.duplicate(systemWounds));
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

  // Pull the roll template (e.g. "(@action.score)d6cs>=4")
  const rollTemplate = dataset.roll;
  const match = rollTemplate.match(/\(@([\w.]+)\)/);
  if (!match) {
    ui.notifications.warn("Invalid roll formula.");
    return;
  }

  const path = match[1];           // e.g. "action.score"
  const rollData = this.actor.getRollData();
  const diceCount = getProperty(rollData, path);
  if (!Number.isNumeric(diceCount)) {
    ui.notifications.warn("Invalid number of dice.");
    return;
  }

  // Flags in the "stargazer" namespace
  const hasAdvantage    = this.actor.getFlag("stargazer", "advantage");
  const hasDisadvantage = this.actor.getFlag("stargazer", "disadvantage");

  // Determine the success threshold
  let threshold = 4;
  if (hasAdvantage && !hasDisadvantage)    threshold = 3;
  else if (hasDisadvantage && !hasAdvantage) threshold = 5;

  // Build the final formula: e.g. "5d6cs>=3"
  const finalFormula = `${diceCount}d6cs>=${threshold}`;

  // Optional: annotate the chat with which mode was used
  let flavor = dataset.label ? `${dataset.score} Dice` : "";
  if (hasAdvantage && !hasDisadvantage)      flavor += " (Advantage: 3+)";
  else if (hasDisadvantage && !hasAdvantage) flavor += " (Disadvantage: 5+)";

  // Roll and send to chat
  const roll = new Roll(finalFormula, rollData);
  await roll.evaluate({ async: true });
  roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor: this.actor }),
    flavor: flavor,
    rollMode: game.settings.get("core", "rollMode"),
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

  // Remove "active" class from all action points
  allPoints.forEach((p) => p.classList.remove("active"));

  // Add "active" class to the clicked one
  point.classList.add("active");

  // Get the index of the selected action point
  const index = allPoints.indexOf(point);
  console.log("Saving active action point index:", index);

  // Save to actor's flags
  await this.actor.setFlag("stargazer", "activeResolvePoint", index);
}
async _onHeart(event) {
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
  await this.actor.setFlag("stargazer", "activeHeartPoint", index);
}

  /* Carry capacity recalc */
  async _calculateCarryCapacity(actor) {
    try {
      const max = actor.system?.carryCap?.maximum ?? actor.system?.carryCap?.max ?? 20;
      let used = 0;

      for (const it of actor.items) {
        // Only count items in main inventory (not in containers)
        if (!it.system?.parentContainerId) {
          if (it.type === "container") {
            // Containers always take 1 slot
            used += 1;
          } else if (it.type === "item") {
            // Items take their specified slots (ensure it's a valid number)
            const itemSlots = Number(it.system?.slots);
            used += (isNaN(itemSlots) || itemSlots < 0) ? 1 : itemSlots;
          }
        }
      }

      console.log("Stargazer | Carry capacity calculated:", {
        max,
        used,
        items: actor.items.filter(i => !i.system?.parentContainerId).map(i => ({
          name: i.name,
          type: i.type,
          slots: i.system?.slots,
          counted: i.type === "container" ? 1 : Number(i.system?.slots)
        }))
      });

      // Only update if the value actually changed to avoid render loops
      const currentUsed = actor.system?.carryCap?.current ?? 0;
      if (currentUsed !== used) {
        await actor.update({ "system.carryCap.current": used });
      }
    } catch (err) {
      console.error("Carry capacity calculation failed:", err);
    }
  }

async _handleDroppedItem(event, data) {
  // 1) Determine dragged payload (prefer event dataTransfer)
  let draggedPayload = null;
  try {
    const dt = event?.originalEvent?.dataTransfer;
    if (dt) {
      const raw = dt.getData("text/plain");
      // some code paths set JSON, some set a plain id — try parse but fall back to string
      try { draggedPayload = JSON.parse(raw); } catch { draggedPayload = raw; }
    }
  } catch (err) {
    // ignore
  }

  // Also accept a `data` parameter if caller already parsed dropData
  if (!draggedPayload && data) draggedPayload = data;

  // Normalize: if draggedPayload is an object with itemId or id, use it
  let draggedId = null;
  if (typeof draggedPayload === "string") draggedId = draggedPayload;
  else if (typeof draggedPayload === "object" && (draggedPayload.itemId || draggedPayload.id)) {
    draggedId = draggedPayload.itemId || draggedPayload.id;
  }

  // 2) Determine the drop target container id (if any)
  const containerLi = $(event.currentTarget).closest(".inventory-entry, .container-contents");
  const containerId = containerLi?.attr?.("data-container-id") || containerLi?.data?.("containerId") || (containerLi[0]?.dataset?.containerId ?? null);

  // 3) If we have an existing embedded item id on this actor, move it
  let itemDoc = null;
  if (draggedId && this.actor.items.get(draggedId)) {
    itemDoc = this.actor.items.get(draggedId);
    // If it's already where it should be, nothing to do
    const currentParent = itemDoc.system?.parentContainerId ?? null;
    if ((currentParent ?? null) === (containerId ?? null)) return;
    await itemDoc.update({ "system.parentContainerId": containerId });
    return;
  }

  // 4) If draggedPayload is a raw item data object (e.g., from compendium or external),
  // create it on the actor and set its parentContainerId.
  if (typeof draggedPayload === "object" && (draggedPayload.type || draggedPayload.name)) {
    // Prepare a sanitized itemData for creation
    const itemData = {
      name: draggedPayload.name ?? "New Item",
      type: draggedPayload.type ?? "item",
      system: {
        slots: draggedPayload.system?.slots ?? 1,
        description: draggedPayload.system?.description ?? "",
        parentContainerId: containerId ?? null,
        // copy other simple fields if present (be conservative)
      }
    };

    try {
      const created = await this.actor.createEmbeddedDocuments("Item", [itemData]);
      if (created?.length) {
        // created[0] is the new Item document; nothing further required
        return;
      }
    } catch (err) {
      console.error("Failed to create dropped item on actor:", err);
      return;
    }
  }

  // 5) If we get here, we couldn't resolve the dragged item — log for debugging
  console.warn("Dropped item could not be resolved to an actor item or valid item data:", draggedPayload);

}

/**
 * Handle dragging and dropping of an item from the sheet
 * @param {Event} event   The originating dragstart event
 * @private
 */
 /** Drag start - set dataTransfer payload and sheet-held fallback */
 _onDragStart(event) {
  const e = event?.originalEvent ? event.originalEvent : event;

  // Find the inventory-entry element
  const li = e?.target?.closest?.(".inventory-entry");
  if (!li) {
    console.warn("DragStart: no inventory-entry found", e?.target);
    return;
  }

  const itemId =
    li.getAttribute("data-item-id") ||
    li.dataset?.itemId ||
    $(li).attr("data-item-id");

  if (!itemId) {
    console.warn("DragStart: no data-item-id on element", li);
    return;
  }

  this._draggedItemId = itemId;
  window.__lastDraggedItemId = itemId; // for console debugging

  const dragData = {
    type: "Item",
    id: itemId,
    actorId: this.actor.id,
  };

  try {
    e.dataTransfer.setData("application/json", JSON.stringify(dragData));
    e.dataTransfer.setData("text/plain", JSON.stringify(dragData));
    e.dataTransfer.effectAllowed = "move";
  } catch (err) {
    console.warn("DragStart: failed to set dataTransfer", err);
  }

  li.classList.add("dragging");

  console.log("DragStart: itemId:", itemId, "payload:", dragData);
}

async _onDropItem(event) {
  event.preventDefault();
  const e = event?.originalEvent ?? event;

  let data;
  try {
    data = JSON.parse(e.dataTransfer.getData("application/json"));
  } catch {
    try {
      data = JSON.parse(e.dataTransfer.getData("text/plain"));
    } catch {
      data = { id: this._draggedItemId };
    }
  }

  console.log("Drop event data:", data);

  const droppedItem = this.actor.items.get(data.id);
  if (!droppedItem) {
    console.warn("Drop: could not find item", data.id);
    return;
  }

  // Find target container
  const li = e.target.closest(".inventory-entry.container");
  if (!li) {
    console.warn("Drop: not dropped on a container");
    return;
  }
  const targetContainerId = li.dataset.itemId;
  const targetContainer = this.actor.items.get(targetContainerId);

  if (!targetContainer) {
    console.warn("Drop: invalid target container", targetContainerId);
    return;
  }

  console.log("Drop: moving", droppedItem.id, "into container", targetContainer.id);

  // Correct way in v10+: updateEmbeddedDocuments
  await this.actor.updateEmbeddedDocuments("Item", [
    { _id: droppedItem.id, "system.parentContainerId": targetContainer.id },
  ]);

  console.log("Drop: update complete", droppedItem.id, "->", targetContainer.id);

  // Refresh sheet
  this.render(true);
}

/** 
 * Handle a dropped Item on this actor sheet 
 * V12-compliant, with parentContainerId logic
 */
async _onDropItem(event, data) {
  event.preventDefault();
  
  // Reconstruct the Item from drop data
  const item = await Item.fromDropData(data);

  // Determine if dropped on a container
  const dropTarget = event.target.closest(".item-container");
  const containerId = dropTarget?.dataset?.itemId || null;

  if (containerId) {
    // Assign parentContainerId to the target container
    await item.update({ "system.parentContainerId": containerId });
    console.log(`${item.name} moved into container ${containerId}`);
  } else {
    // Dropped outside any container: clear parentContainerId
    if (item.system.parentContainerId) {
      await item.update({ "system.parentContainerId": null });
      console.log(`${item.name} removed from container`);
    }
  }

  // Call your usual PrepareItems to re-render the sheet
  this.prepareItems();
}

/**
 * Migrate old items to have parentContainerId field
 * This ensures items created before the field was added work correctly
 * Only runs once per actor by setting a flag
 */
async _migrateItemData() {
  // Check if migration already ran
  const migrationVersion = this.actor.getFlag("stargazer", "itemMigrationVersion") || 0;
  if (migrationVersion >= 1) {
    console.log("Stargazer | Migration already completed (v" + migrationVersion + ")");
    return; // Already migrated
  }

  console.log("Stargazer | Starting item migration...");
  const updates = [];

  for (const item of this.actor.items) {
    console.log(`Stargazer | Checking item ${item.name} (${item.type}):`, {
      hasField: "parentContainerId" in item.system,
      systemData: item.system
    });

    if ((item.type === "item" || item.type === "container") && !("parentContainerId" in item.system)) {
      updates.push({
        _id: item.id,
        "system.parentContainerId": null
      });
      console.log(`Stargazer | Will migrate item: ${item.name}`);
    }
  }

  if (updates.length > 0) {
    console.log(`Stargazer | Migrating ${updates.length} items to add parentContainerId field`, updates);
    const result = await this.actor.updateEmbeddedDocuments("Item", updates);
    console.log("Stargazer | Migration update result:", result);
  } else {
    console.log("Stargazer | No items need migration");
  }

  // Mark migration as complete
  await this.actor.setFlag("stargazer", "itemMigrationVersion", 1);
  console.log("Stargazer | Item data migration complete");
}

}
