// Import Modules
import { StargazerActor } from "./actor/actor.js";
import { StargazerActorSheet } from "./actor/actor-sheet.js";
import { StargazerItem } from "./item/item.js";
import { StargazerItemSheet } from "./item/item-sheet.js";
import { preloadHandlebarsTemplates } from "./helpers/templates.js";
import { BOILERPLATE } from "./helpers/config.js";

Hooks.once('init', function() {

  // Add utility classes to the global game object so that they're more easily
  // accessible in global contexts.
  game.stargazer = {
    StargazerActor,
    StargazerItem,
  };

  // Add custom constants for configuration.
  CONFIG.BOILERPLATE = BOILERPLATE;

  /**
   * Set an initiative formula for the system
   * @type {String}
   */
   CONFIG.Combat.initiative = {
    formula: "1d10 + @skills.Reflex.value",
    decimals: 2
  };

  // Define custom Document classes
  CONFIG.Actor.documentClass = StargazerActor;
  CONFIG.Item.documentClass = StargazerItem;

  // Register sheet application classes
  Actors.unregisterSheet("core", ActorSheet);
  Actors.registerSheet("stargazer", StargazerActorSheet, { makeDefault: true });
  Items.unregisterSheet("core", ItemSheet);
  Items.registerSheet("stargazer", StargazerItemSheet, { makeDefault: true });

  // Preload Handlebars templates.
  return preloadHandlebarsTemplates();
});

