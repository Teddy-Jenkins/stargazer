/**
 * Extend the basic ItemSheet with some very simple modifications
 * @extends {ItemSheet}
 */
export class StargazerItemSheet extends ItemSheet {

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["stargazer", "sheet", "item"],
      width: 520,
      height: 480,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "description" }]
    });
  }

  /** @override */
  get template() {
    
    const path = "systems/stargazer/templates/item";
    // Return a single sheet for all item types.
    // return `${path}/item-sheet.html`;

    // Alternatively, you could use the following return statement to do a
    // unique item sheet by type, like `weapon-sheet.html`.
    return `${path}/item-${this.item.type}-sheet.html`;
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

  /** @override */
  async getData() {
    const context = super.getData();

    // Use a safe clone of the item data for further operations.
    const itemData = this.document.toObject(false);

    context.enrichedDescription = await TextEditor.enrichHTML(
      this.item.system.description
    );

    context.system = itemData.system;
    context.flags = itemData.flags;

    // Adding a pointer to CONFIG.BOILERPLATE
    context.config = CONFIG.STARGAZER;

    // For containers, get contents
    if (this.item.type === "container" && this.item.actor) {
      const contents = this.item.actor.items.filter(i =>
        i.system.parentContainerId === this.item.id
      ).map(i => {
        const obj = i.toObject(false);
        obj.isItem = obj.type === "item";
        obj.isContainer = obj.type === "container";
        return obj;
      });
      context.contents = contents;
      context.usedSlots = contents.reduce((sum, i) => sum + (i.system?.slots || 0), 0);
      context.effectiveCapacity = this.item.system.packed ? 5 : 3;
    }

    return context;
  }

  

  /* -------------------------------------------- */

  /** @override */
  setPosition(options = {}) {
    const position = super.setPosition(options);
    const sheetBody = this.element.find(".sheet-body");
    const bodyHeight = position.height - 192;
    sheetBody.css("height", bodyHeight);
    return position;
  }

  /* -------------------------------------------- */

  /** @override */
  activateListeners(html) {
    
    super.activateListeners(html);

    // Everything below here is only needed if the sheet is editable
    if (!this.options.editable) return;

    // For container sheets - allow editing items within
    if (this.item.type === "container") {
      html.on("click", ".container-item-edit", (ev) => {
        ev.preventDefault();
        const itemId = $(ev.currentTarget).closest(".container-item").data("itemId");
        const item = this.item.actor?.items.get(itemId);
        if (item) item.sheet.render(true);
      });

      html.on("click", ".container-item-delete", async (ev) => {
        ev.preventDefault();
        const itemId = $(ev.currentTarget).closest(".container-item").data("itemId");
        const item = this.item.actor?.items.get(itemId);
        if (item) {
          await item.delete();
          this.render();
        }
      });
    }
  }
}
