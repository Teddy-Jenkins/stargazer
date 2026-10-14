/**
 * Investigation sheet for the Stargazer system — registered as an ALTERNATE
 * sheet for JournalEntry documents (not a JournalEntryPage subtype).
 *
 * Usage:
 *  1. Create a Folder in the Journal Entries sidebar tab, e.g. "Cases".
 *  2. Create a Journal Entry inside it for each case.
 *  3. Right-click the entry -> "Sheet Configuration" -> choose "Investigation Sheet".
 *     (This is a built-in Foundry feature; no extra code needed for that part.)
 *  4. The entry now opens as the fillable case form. Player permissions on the
 *     entry (Observer/Owner) work exactly as they do for any Journal Entry.
 *
 * Data is stored under flags.stargazer.investigation rather than a `system`
 * field, so no documentTypes/dataModels registration in system.json is needed.
 */

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { DocumentSheetV2 } = foundry.applications.api;

const FLAG_SCOPE = "stargazer";
const FLAG_KEY = "investigation";

function emptyPOI() {
  return { name: "", relationship: "", alibi: "", means: "", motive: "", opportunity: "", suspicious: "" };
}

function emptyData() {
  return {
    status: "open",
    client: "",
    victim: "",
    perpetrator: "",
    integrity: null,
    personsOfInterest: [],
    locations: "",
    documentaryEvidence: "",
    testimonialEvidence: "",
    forensicEvidence: ""
  };
}

class InvestigationSheetApp extends HandlebarsApplicationMixin(DocumentSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["stargazer", "investigation-sheet"],
    position: { width: 820, height: 760 },
    window: { title: "Investigation", resizable: true },
    form: {
      handler: InvestigationSheetApp.#onSubmitForm,
      submitOnChange: true,
      closeOnSubmit: false
    }
  };

  static PARTS = {
    content: {
      template: "systems/stargazer/templates/journal/investigation-sheet.hbs",
      // Marks this part's root as the scroll container and lets Foundry
      // remember/restore scroll position across re-renders.
      scrollable: [""]
    }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const stored = this.document.getFlag(FLAG_SCOPE, FLAG_KEY);
    context.data = foundry.utils.mergeObject(emptyData(), stored ?? {}, { inplace: false });
    context.entry = this.document;
    return context;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelectorAll(".row-add").forEach((el) =>
      el.addEventListener("click", this.#onAddRow.bind(this))
    );
    this.element.querySelectorAll(".row-delete").forEach((el) =>
      el.addEventListener("click", this.#onDeleteRow.bind(this))
    );
  }

  async #onAddRow(event) {
    event.preventDefault();
    const current = this.document.getFlag(FLAG_SCOPE, FLAG_KEY) ?? emptyData();
    const rows = foundry.utils.duplicate(current.personsOfInterest ?? []);
    rows.push(emptyPOI());
    await this.document.setFlag(FLAG_SCOPE, FLAG_KEY, { ...current, personsOfInterest: rows });
  }

  async #onDeleteRow(event) {
    event.preventDefault();
    const index = Number(event.currentTarget.dataset.index);
    const current = this.document.getFlag(FLAG_SCOPE, FLAG_KEY) ?? emptyData();
    const rows = foundry.utils.duplicate(current.personsOfInterest ?? []);
    rows.splice(index, 1);
    await this.document.setFlag(FLAG_SCOPE, FLAG_KEY, { ...current, personsOfInterest: rows });
  }

  /**
   * Save submitted form data to the JournalEntry.
   * DocumentSheetV2 supplies a FormDataExtended, not the legacy
   * FormApplication-style `formData.object`. Use the V2 processing method
   * to obtain the expanded data structure.
   */
  static async #onSubmitForm(event, form, formData) {
    const expanded = this._processFormData(event, form, formData);
    const update = {};

    if (expanded.name !== undefined) update.name = expanded.name;

    const incoming = foundry.utils.getProperty(
      expanded,
      `flags.${FLAG_SCOPE}.${FLAG_KEY}`
    ) ?? {};

    const current = this.document.getFlag(FLAG_SCOPE, FLAG_KEY) ?? emptyData();
    const merged = { ...current, ...incoming };

    // Replacing the array is intentional. A deep merge can leave stale POI
    // rows behind after one has been deleted.
    if (Object.prototype.hasOwnProperty.call(incoming, "personsOfInterest")) {
      const rows = incoming.personsOfInterest;
      merged.personsOfInterest = Array.isArray(rows) ? rows : Object.values(rows ?? {});
    }

    update[`flags.${FLAG_SCOPE}.${FLAG_KEY}`] = merged;

    console.debug("Stargazer | Investigation form submitted", {
      documentId: this.document.id,
      fieldCount: [...formData.keys()].length
    });

    await this.document.update(update);

    const saved = this.document.getFlag(FLAG_SCOPE, FLAG_KEY);
    console.debug("Stargazer | Investigation data saved", {
      documentId: this.document.id,
      flagPresent: Boolean(saved),
      poiCount: saved?.personsOfInterest?.length ?? 0
    });
  }
}

/* ---------------------------------- */
/*  Public export                     */
/* ---------------------------------- */
// Call this once from stargazer.js during its init sequence.
export function investigationSheet() {
  console.log("Stargazer | registering Investigation sheet");
  Handlebars.registerHelper("eq", (a, b) => String(a) === String(b));

  DocumentSheetConfig.registerSheet(JournalEntry, "stargazer", InvestigationSheetApp, {
    types: ["base"],
    label: "Investigation Sheet",
    makeDefault: false // GM opts in per-entry via Sheet Configuration
  });
}
