import StargazerItemBase from "./base-item.mjs";

export default class StargazerContainer extends StargazerItemBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema();

    schema.capacity = new fields.NumberField({ required: true, nullable: false, integer: true, initial: 3, min: 1 });
    schema.packed = new fields.BooleanField({ required: true, initial: false });

    return schema;
  }

  prepareDerivedData() {
    super.prepareDerivedData();

    // If container is packed, increase capacity to 5, otherwise it's 3
    // Note: This doesn't change the stored value, just the effective capacity
    this.effectiveCapacity = this.packed ? 5 : 3;
  }
}
