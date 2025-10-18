// Import Modules
import { StargazerActor } from "./actor/actor.js";
import { StargazerActorSheet } from "./actor/actor-sheet.js";
import { StargazerItem } from "./item/item.js";
import { StargazerItemSheet } from "./item/item-sheet.js";
import { preloadHandlebarsTemplates } from "./helpers/templates.js";
import { STARGAZER } from "./helpers/config.js";
import * as models from './data/_module.mjs';

Hooks.once("init", function () {

  console.log("Stargazer | Initializing system");




  // Add utility classes to the global game object so that they're more easily accessible in global contexts.
  game.stargazer = {
    StargazerActor,
    StargazerItem
  };

  // Add custom constants for configuration.
  CONFIG.Combat.initiative = {
    formula: "1d10 + @skills.Reflex.value",
    decimals: 2
  };

  // Define custom Document classes
  CONFIG.STARGAZER = STARGAZER;
  CONFIG.Actor.documentClass = StargazerActor;
  CONFIG.Item.documentClass = StargazerItem;

  CONFIG.Actor.dataModels = {
    character: models.StargazerCharacter,
    npc: models.StargazerNPC
  };

  CONFIG.Item.dataModels = {
    item: models.StargazerItem,
    container: models.StargazerContainer,
    feature: models.StargazerFeature,
    spell: models.StargazerSpell
  };

  // Register sheet application classes
  Actors.unregisterSheet("core", ActorSheet);
  Actors.registerSheet("stargazer", StargazerActorSheet, {
    makeDefault: true,
    label: "STARGAZER.SheetLabels.Actor"
  });

  Items.unregisterSheet("core", ItemSheet);
  Items.registerSheet("stargazer", StargazerItemSheet, {
    makeDefault: true,
    label: "STARGAZER.SheetLabels.Item"
  });

  // Handlebars helper for range (needed for wound segments)
Handlebars.registerHelper('range', function(start, end) {
  const result = [];
  for (let i = start; i < end; i++) {
    result.push(i);
  }
  return result;
});

Hooks.once("ready", async () => {
  console.log("Stargazer | Running Item migration for parentContainerId...");

  for (const actor of game.actors.contents) {
    const updates = [];

    for (const item of actor.items) {
      if (!("parentContainerId" in item.system)) {
        // Queue an update for this item
        updates.push({
          _id: item.id,
          "system.parentContainerId": null
        });
      }
    }

    // Apply batched updates per actor
    if (updates.length > 0) {
      console.log(`Migrating ${updates.length} item(s) for actor ${actor.name}`);
      await actor.updateEmbeddedDocuments("Item", updates);
    }
  }

  console.log("Stargazer | Item migration complete.");
});


Handlebars.registerHelper("eq", (a, b) => a === b);


// Defensive lookupItem helper: returns a plain object (toObject) or null.
// If an actor isn't provided, attempt to find which actor owns that item id.
if (!Handlebars.helpers.lookupItem) {
  Handlebars.registerHelper("lookupItem", function(maybeActor, id, options) {
    try {
      // If called as (id) or (null, id) adjust arguments
      if (typeof maybeActor === "string" && !id) {
        id = maybeActor;
        maybeActor = null;
      }

      let actor = null;

      // Common usage: (actor, id)
      if (maybeActor && typeof maybeActor === "object" && maybeActor.items) {
        actor = maybeActor;
      }
      // Fallback: some templates provide actor in root context
      else if (options && options.data && options.data.root && options.data.root.actor) {
        actor = options.data.root.actor;
      }

      // Last-resort: find the actor in the world that owns the item id
      if ((!actor || !actor.items) && id && game && game.actors) {
        // linear search — not common but safe for templates where actor is missing
        for (const a of game.actors.contents) {
          if (a.items?.get?.(id)) {
            actor = a;
            break;
          }
        }
      }

      if (!actor || !actor.items) return null;
      const item = actor.items.get(id);
      return item ? item.toObject(false) : null;
    } catch (err) {
      console.warn("lookupItem helper error:", err);
      return null;
    }
  });
}



  // Preload Handlebars templates
  return preloadHandlebarsTemplates();
});

// ✅ Data migration / initialization
Hooks.once("ready", async () => {
  for (const actor of game.actors.contents) {
    if (!Array.isArray(actor.system.wounds)) {
      await actor.update({ "system.wounds": [] });
    }
  }
});


