/**
 * Base Discovery Provider Interface
 */

export class BaseDiscoveryProvider {
  /**
   * @param {string} name
   * @param {string} type
   */
  constructor(name, type) {
    if (!name) throw new Error('Provider must have a name');
    this.name = name;
    this.type = type;
  }

  /**
   * Discovers candidate listings from this source
   * @param {object} [options]
   * @returns {Promise<Array<object>>} raw or normalized candidate records
   */
  async fetchCandidates(_options = {}) {
    throw new Error(`fetchCandidates not implemented for provider ${this.name}`);
  }
}
