/**
 * Extend the base Actor entity by defining a custom roll data structure which is ideal for the Simple system.
 * @extends {Actor}
 */
export class StargazerActor extends Actor {

  // async _preCreate(data) {
  //   if (data.type === "character") {
  //     this.updateSource({ "prototypeToken.actorLink": true });
  //   }
  //   super._preCreate(data);
  // }
  /**
   * Augment the basic actor data with additional dynamic data.
   */
  prepareData() {
    super.prepareData();
    
  }

prepareDerivedData() {
  const actorData = this;
  const systemData = actorData.system;
  const flags = actorData.flags || {};

  
  this._prepareCharacterData(actorData)
  this._prepareNpcData(actorData);
}

  /**
   * Prepare Character type specific data
   */
  _prepareCharacterData(actorData) {
    if (actorData.type !== "character") return;

    const systemData = actorData.system;
    // Make modifications to data here.

  }

  _prepareNpcData(actorData) {
    if (actorData.type !== "npc") return;
    // Make modifications to data here. For example:
    const systemData = actorData.system;
  }

  getRollData() {
    const data = { ...this.system};

    // Prepare character roll data.
    this._getCharacterRollData(data);
    this._getNpcRollData(data);

    return data;
  }

  /**
   * Prepare character roll data.
   */
  _getCharacterRollData(data) {
    if (this.type !== 'character') return;

    // Copy the ability scores to the top level, so that rolls can use
    // formulas like `@str.mod + 4`.
    if (data.attributes) {
      for (let [k, v] of Object.entries(data.attributes)) {
        data[k] = foundry.utils.deepClone(v);
      }
    }

    // Add level for easier access, or fall back to 0.
    if (data.attributes.level) {
      data.lvl = data.attributes.level.value ?? 0;
    }
  }

  /**
   * Prepare NPC roll data.
   */
  _getNpcRollData(data) {
    if (this.type !== 'npc') return;

    // Process additional NPC data here.
  }

  toPlainObject() {
    const result = {...this};

    // Simplify system data.
    result.system = this.system.toPlainObject();

    // Add items.
    result.items = this.items?.size > 0 ? this.items.contents : [];

    // Add effects.
    result.effects = this.effects?.size > 0 ? this.effects.contents : [];

    return result;
  }


}