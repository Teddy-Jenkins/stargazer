// Import Modules
import { StargazerActor } from "./actor/actor.js";
import { StargazerActorSheet } from "./actor/actor-sheet.js";
import { StargazerItem } from "./item/item.js";
import { StargazerItemSheet } from "./item/item-sheet.js";
import { preloadHandlebarsTemplates } from "./helpers/templates.js";
import { STARGAZER } from "./helpers/config.js";
import * as models from './data/_module.mjs';

Hooks.once('init', function() {

  // Add utility classes to the global game object so that they're more easily
  // accessible in global contexts.
  game.stargazer = {
    StargazerActor,
    StargazerItem
  };

  // Add custom constants for configuration.
  

  /**
   * Set an initiative formula for the system
   * @type {String}
   */
   CONFIG.Combat.initiative = {
    formula: "1d10 + @skills.Reflex.value",
    decimals: 2
  };

  // Define custom Document classes
  CONFIG.STARGAZER = STARGAZER;
  CONFIG.Actor.documentClass = StargazerActor;
  CONFIG.Item.documentClass = StargazerItem;

    // Note that you don't need to declare a DataModel
  // for the base actor/item classes - they are included
  // with the Character/NPC as part of super.defineSchema()
  CONFIG.Actor.dataModels = {
    character: models.StargazerCharacter,
    npc: models.StargazerNPC
  }
  CONFIG.Item.documentClass = StargazerItem;
  CONFIG.Item.dataModels = {
    item: models.StargazerItem,
    feature: models.StargazerFeature,
    spell: models.StargazerSpell
  }

  // Register sheet application classes
  Actors.unregisterSheet('core', ActorSheet);
  Actors.registerSheet('stargazer', StargazerActorSheet, { 
    makeDefault: true,
    label: 'STARGAZER.SheetLabels.Actor', 
  });
  Items.unregisterSheet('core', ItemSheet);
  Items.registerSheet('stargazer', StargazerItemSheet, { 
    makeDefault: true,
    label: 'STARGAZER.SheetLabels.Item',  
  });

  // Preload Handlebars templates.
  return preloadHandlebarsTemplates();
});

