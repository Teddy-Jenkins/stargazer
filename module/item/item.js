/**
 * Extend the basic Item with some very simple modifications.
 * @extends {Item}
 */

export class StargazerItem extends Item {
  /**
   * Augment the basic Item data model with additional dynamic data.
   */
  prepareData() {
    super.prepareData();

    // Get the Item's data
    const itemData = this;
    const actorData = this.actor ? this.actor : {};
    const data = itemData.system;
    const system = this.system;

    // Ensure parentContainerId exists for items and containers (read-only check)
    // Note: The actual migration happens in actor-sheet.js _migrateItemData()
    if (this.type === "item" || this.type === "container") {
      if (!("parentContainerId" in this.system)) {
        // Just set it on the runtime object, don't persist yet
        this.system.parentContainerId = null;
      }
    }
  }

  /**
   * Handle clickable rolls.
   * @param {Event} event   The originating click event
   * @private
   */
  async roll() {
    // Basic template rendering data
    const token = this.actor.token;
    const item = this.system;
    const actorData = this.actor ? this.actor.system : {};
    const itemData = item.system;

    let roll = new Roll('d20+@abilities.str.mod', actorData);
    let label = `Rolling ${item.name}`;
    roll.roll().toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: label
    });
  }
}
