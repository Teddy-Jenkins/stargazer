import StargazerActorBase from "./base-actor.mjs";

export default class StargazerCharacter extends StargazerActorBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    schema.action = new fields.SchemaField({
        value: new fields.NumberField({ ...requiredInteger, initial: 30 }),
        max: new fields.NumberField({ required: true, initial: 30 }),
        score: new fields.NumberField({ required: true, initial: 0 })
    });


    return schema;
  }

  prepareDerivedData() {
    // Loop through ability scores, and add their modifiers to our sheet output.
    for (const key in this.abilities) {
      // Handle ability label localization.
      this.abilities[key].label = game.i18n.localize(CONFIG.STARGAZER.attributes[key]) ?? key;
    }
  }

  getRollData() {
    const data = {};

    // Copy the ability scores to the top level, so that rolls can use
    // formulas like `@str.mod + 4`.
    if (this.attributes) {
      for (let [k,v] of Object.entries(this.attributes)) {
        data[k] = foundry.utils.deepClone(v);
      }
    }

    data.lvl = this.attributes.value;

    return data
  }
}