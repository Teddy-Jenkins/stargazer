/**
 * Extend the base Actor entity by defining a custom roll data structure which is ideal for the Simple system.
 * @extends {Actor}
 */
export class StargazerActor extends Actor {


  /** @override */
  static async create(data, options={}) {
    data.token = data.token || {};
    let defaults = {};
    if (data.type === "character") {
      defaults = {
        actorLink: true,
        disposition: 1,
        vision: true,
        dimSight: 0,
        brightSight: 0,
      };
    }
    mergeObject(data.token, defaults, {overwrite: false});
    return super.create(data, options);
  }
  /**
   * Augment the basic actor data with additional dynamic data.
   */
  prepareData() {
    super.prepareData();

    const actorData = this.data;
    const data = actorData.data;
    const flags = actorData.flags;

    

    // Make separate methods for each Actor type (character, npc, etc.) to keep
    // things organized.
    if (actorData.type === 'character') this._prepareCharacterData(actorData);
  }

  /**
   * Prepare Character type specific data
   */
  _prepareCharacterData(actorData) {
    const data = actorData.data;


  //   (function() {
  //     Handlebars.registerHelper('stripScripts', function(param) {
  //         var regex = /(<([^>]+)>)/ig
  //         return param.replace(regex, "");
  //     });
  
  // })();
    // Make modifications to data here. For example:

    // Loop through ability scores, and add their modifiers to our sheet output.
    // for (let [key, skill] of Object.entries(data.skills)) {
    //   // Calculate the modifier using d20 rules.
    //   ability.value + skill.value = ability.value;
    // }
  }

}