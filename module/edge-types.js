/**
 * Stargazer Edge Types
 *
 * The six Edge types are fixed in their mechanical role (each grants a free
 * die against its matching consequence type), but their display names are
 * world settings so a GM can rename them to fit their fiction.
 *
 * INSTALLATION:
 * 1. Drop this file into stargazer/module/ (alongside consequence-tracker.js)
 * 2. In stargazer.js, add at the top:
 *      import { EdgeTypes } from "./edge-types.js";
 * 3. Inside the Hooks.once("init") callback, add:
 *      EdgeTypes.registerSettings();
 */

import { ConsequenceTracker } from "./consequence-tracker.js";

const EDGE_TYPES = {
  skill:      { label: "Skill",      consequenceType: "failure"  },
  grit:       { label: "Grit",       consequenceType: "injury"   },
  finesse:    { label: "Finesse",    consequenceType: "friction" },
  vigilance:  { label: "Vigilance",  consequenceType: "loss"     },
  heart:      { label: "Heart",      consequenceType: "fatigue"  },
  providence: { label: "Providence", consequenceType: "threat"   },
};

// Settings key prefix — one world setting per Edge type, holding its display name
const SETTING_PREFIX = "edgeName_";

export class EdgeTypes {

  /** Registers one world-scoped, GM-configurable name setting per Edge type */
  static registerSettings() {
    for (const [key, def] of Object.entries(EDGE_TYPES)) {
      game.settings.register("stargazer", `${SETTING_PREFIX}${key}`, {
        name: `Edge Name: ${def.label}`,
        hint: `Display name for the ${def.label} Edge.`,
        scope: "world",
        config: true,
        type: String,
        default: def.label,
      });
    }
  }

  /** Bare Edge name only (e.g. "Grit"), honoring any GM rename */
  static label(key) {
    const fallback = EDGE_TYPES[key]?.label ?? key;
    try {
      const value = game.settings.get("stargazer", `${SETTING_PREFIX}${key}`);
      return value?.trim() ? value : fallback;
    } catch (e) {
      // Setting not registered yet (e.g. called before init) — fall back silently
      return fallback;
    }
  }

  /** Edge name plus its matching consequence type in parens, e.g. "Grit (Harm)" — both halves honor renames */
  static fullLabel(key) {
    const def = EDGE_TYPES[key];
    if (!def) return EdgeTypes.label(key);
    return `${EdgeTypes.label(key)} (${ConsequenceTracker.label(def.consequenceType)})`;
  }

  /** Ordered {key, label} list for building the Edge-type <select>, in the original dropdown order */
  static getOptions() {
    return Object.keys(EDGE_TYPES).map(key => ({ key, label: EdgeTypes.fullLabel(key) }));
  }
}
