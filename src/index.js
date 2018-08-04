const dotProp = require('dot-prop');

const _mathop = Symbol('mathop');
const _getHighestAutonum = Symbol('getHighestAutonum');
const _check = Symbol('check');

/**
 * A enhanced Map structure with additional utility methods.
 * Can be made persistent 
 * @extends {Map}
 */
class Enmap extends Map {

  constructor(iterable, options = {}) {
    if (!iterable || typeof iterable[Symbol.iterator] !== 'function') {
      options = iterable || {};
      iterable = null;
    }
    super(iterable);

    this.fetchAll = options.fetchAll !== undefined ? options.fetchAll : true;

    if (options.provider) {
      this.persistent = true;
      this.db = options.provider;
      this.db.fetchAll = this.fetchAll;
      this.defer = this.db.defer;
      this.db.init(this);
      this.name = this.db.name;
    } else {
      this.name = 'MemoryBasedEnmap';
    }
  }

  /* GENERAL-USE METHODS & HELPERS */

  /**
   * Initialize multiple Enmaps easily.
   * @param {Array<string>} names Array of strings. Each array entry will create a separate enmap with that name.
   * @param {EnmapProvider} Provider Valid EnmapProvider object.
   * @param {Object} options Options object to pass to the provider. See provider documentation for its options.
   * @example
   * // Using local variables and the mongodb provider.
   * const Enmap = require('enmap');
   * const Provider = require('enmap-mongo');
   * const { settings, tags, blacklist } = Enmap.multi(['settings', 'tags', 'blacklist'], Provider, { url: "some connection URL here" });
   * 
   * // Attaching to an existing object (for instance some API's client)
   * const Enmap = require("enmap");
   * const Provider = require("enmap-mongo");
   * Object.assign(client, Enmap.multi(["settings", "tags", "blacklist"], Provider, { url: "some connection URL here" }));
   * 
   * @returns {Array<Map>} An array of initialized Enmaps.
   */
  static multi(names, Provider, options = {}) {
    if (!names.length || names.length < 1) {
      throw new Error('"names" argument must be an array of string names.');
    }
    if (!Provider) {
      throw new Error('Second argument must be a valid EnmapProvider.');
    }

    const returnvalue = {};
    for (const name of names) {
      const enmap = new Enmap({ provider: new Provider(Object.assign(options, { name })) });
      returnvalue[name] = enmap;
    }
    return returnvalue;
  }

  /**
   * Fetches every key from the persistent enmap and loads them into the current enmap value.
   * @return {Map} The enmap containing all values.
   */
  fetchEverything() {
    return this.db.fetchEverything();
  }

  /**
   * Force fetch one or more key values from the enmap. If the database has changed, that new value is used.
   * @param {string|number} keyOrKeys A single key or array of keys to force fetch from the enmap database.
   * @return {*|Map} A single value if requested, or a non-persistent enmap of keys if an array is requested.
   */
  async fetch(keyOrKeys) {
    if (!Array.isArray(keyOrKeys)) {
      return this.db.fetch(keyOrKeys);
    }
    return new this.constructor(await Promise.all(keyOrKeys.map(async key => {
      const value = await this.db.fetch(key);
      super.set(key, value);
      return [key, value];
    })));
  }

  /**
   * Generates an automatic numerical key for inserting a new value. 
   * @return {number} The generated key number.
   */
  autonum() {
    const start = this.get('internal::autonum') || 0;
    let highest = this[_getHighestAutonum](start);
    this.set('internal::autonum', ++highest);
    return highest;
  }

  /**
   * Function called whenever data changes within Enmap after the initial load.
   * Can be used to detect if another part of your code changed a value in enmap and react on it.
   * @example
   * enmap.changed((keyName, oldValue, newValue) => {
   *   console.log(`Value of ${key} has changed from: \n${oldValue}\nto\n${newValue});
   * });
   * @param {Function} cb A callback function that will be called whenever data changes in the enmap.
   */
  changed(cb) {
    this.changedCB = cb;
  }

  /* METHODS THAT SET THINGS IN ENMAP */

  /**
   * Set the value in Enmap.
   * @param {string|number} key Required. The key of the element to add to The Enmap. 
   * If the Enmap is persistent this value MUST be a string or number.
   * @param {*} val Required. The value of the element to add to The Enmap. 
   * If the Enmap is persistent this value MUST be stringifiable as JSON.
   * @param {string} path Optional. The path to the property to modify inside the value object or array.
   * Can be a path with dot notation, such as "prop1.subprop2.subprop3"
   * @example
   * enmap.set('simplevalue', 'this is a string');
   * enmap.set('isEnmapGreat', true);
   * enmap.set('TheAnswer', 42);
   * enmap.set('IhazObjects', { color: 'black', action: 'paint', desire: true });
   * @return {Map} The Enmap.
   */
  set(key, val, path = null) {
    if (val == null) throw `Value provided for ${key} was null or undefined. Please provide a value.`;
    let data = super.get(key);
    if (path) {
      this[_check](key, ['Array', 'Object']);
      dotProp.set(data, path, val);
    } else {
      data = val;
    }
    let insert;
    if (data.constructor.name === 'Object') {
      const temp = {};
      for (const prop in data) {
        temp[prop] = data[prop];
      }
      insert = temp;
    }
    if (data.constructor.name === 'Array') {
      insert = [...data];
    } else {
      insert = data;
    }
    const oldValue = this.get(key) || null;
    if (typeof this.changedCB === 'function') {
      this.changedCB(key, oldValue, insert);
    }
    if (this.persistent) {
      this.db.set(key, insert);
    }
    return super.set(key, insert);
  }

  /**
   * Push to an array value in Enmap.
   * @param {string|number} key Required. The key of the array element to push to in Enmap. 
   * This value MUST be a string or number.
   * @param {*} val Required. The value to push to the array.
   * @param {string} path Optional. The path to the property to modify inside the value object or array.
   * Can be a path with dot notation, such as "prop1.subprop2.subprop3"
   * @param {boolean} allowDupes Optional. Allow duplicate values in the array (default: false).
   * @return {Map} The EnMap.
   */
  push(key, val, path = null, allowDupes = false) {
    this[_check](key, 'Array', path);
    const data = super.get(key);
    if (path) {
      const propValue = dotProp.get(data, path);
      if (!allowDupes && propValue.indexOf(val) > -1) return this;
      propValue.push(val);
      dotProp.set(data, path, propValue);
    } else {
      if (!allowDupes && data.indexOf(val) > -1) return this;
      data.push(val);
    }
    return this.set(key, data);
  }

  // AWESOME MATHEMATICAL METHODS

  /**
   * Executes a mathematical operation on a value and saves it in the enmap.
   * @param {string|number} key The enmap key on which to execute the math operation.
   * @param {string} operation Which mathematical operation to execute. Supports most
   * math ops: =, -, *, /, %, ^, and english spelling of those operations.
   * @param {number} operand The right operand of the operation.
   * @return {Map} The EnMap.
   */
  math(key, operation, operand) {
    this[_check](key, 'Number');
    if (operation === 'random' || operation === 'rand') {
      return this.set(key, Math.round(Math.random() * operand));
    }
    return this.set(key, this[_mathop](this.get(key), operation, operand));
  }

  /**
   * Increments a key's value or property by 1. Value must be a number, or a path to a number.
   * @param {string|number} key The enmap key where the value to increment is stored.
   * @param {string} path Optional. The property path to increment, if the value is an object or array.
   * @return {Map} The EnMap.
   */
  inc(key, path = null) {
    this[_check](key, 'Number', path);
    if (!path) {
      let val = this.get(key);
      return this.set(key, ++val);
    } else {
      const data = this.get(key);
      let propValue = dotProp.get(data, path);
      dotProp.set(data, path, ++propValue);
      return this.set(key, data);
    }
  }

  /**
   * Decrements a key's value or property by 1. Value must be a number, or a path to a number.
   * @param {string|number} key The enmap key where the value to decrement is stored.
   * @param {string} path Optional. The property path to decrement, if the value is an object or array.
   * @return {Map} The EnMap.
   */
  dec(key, path = null) {
    this[_check](key, 'Number', path);
    if (!path) {
      let val = this.get(key);
      return this.set(key, --val);
    } else {
      const data = this.get(key);
      let propValue = dotProp.get(data, path);
      dotProp.set(data, path, --propValue);
      return this.set(key, data);
    }
  }

  /* METHODS THAT GETS THINGS FROM ENMAP */

  /**
   * Retrieves a key from the enmap. If fetchAll is false, returns a promise.
   * @param {string|number} key The key to retrieve from the enmap.
   * @param {string} path Optional. The property to retrieve from the object or array.
   * Can be a path with dot notation, such as "prop1.subprop2.subprop3"
   * @example
   * const myKeyValue = enmap.get("myKey");
   * console.log(myKeyValue);
   * @return {*} The value for this key.
   */
  get(key, path = null) {
    if (path) {
      this[_check](key, 'Object');
      const data = super.get(key);
      return dotProp.get(data, path);
    }
    return super.get(key);
  }

  /* BOOLEAN METHODS THAT CHECKS FOR THINGS IN ENMAP */

  /**
   * Returns whether or not the key exists in the Enmap.
   * @param {string|number} key Required. The key of the element to add to The Enmap or array. 
   * @param {string} path Optional. The property to verify inside the value object or array.
   * Can be a path with dot notation, such as "prop1.subprop2.subprop3"
   * This value MUST be a string or number.
   * @returns {boolean}
   */
  has(key, path = null) {
    if (path) {
      this[_check](key, 'Object');
      const data = super.get(key);
      return dotProp.has(data, path);
    }
    return super.has(key);
  }

  /* METHODS THAT DELETE THINGS FROM ENMAP */

  /**
   * Deletes a key in the Enmap.
   * @param {string|number} key Required. The key of the element to delete from The Enmap.
   * @param {string} path Optional. The name of the property to remove from the object.
   * Can be a path with dot notation, such as "prop1.subprop2.subprop3"
   */
  delete(key, path = null) {
    if (path) {
      this[_check](key, 'Object', path);
      const data = super.get(key);
      dotProp.delete(data, path);
      this.set(key, data);
    } else {
      super.delete(key);
    }
    if (this.persistent && !path) {
      this.db.delete(key);
    }
    const oldValue = this.get(key) || null;
    if (typeof this.changedCB === 'function') {
      this.changedCB(key, oldValue, null);
    }
  }

  /**
   * Calls the `delete()` method on all items that have it.
   * @param {boolean} bulk Optional. Defaults to True. whether to use the provider's "bulk" delete feature if it has one.
   */
  deleteAll(bulk = true) {
    if (this.persistent) {
      if (bulk) {
        this.db.bulkDelete();
      } else {
        for (const key of this.keys()) {
          this.db.delete(key);
        }
      }
    }
    super.clear();
  }

  clear(bulk = true) { return this.deleteAll(bulk); }

  /**
   * Remove a value in an Array or Object element in Enmap. Note that this only works for
   * values, not keys. Complex values such as objects and arrays will not be removed this way.
   * @param {string|number} key Required. The key of the element to remove from in Enmap. 
   * This value MUST be a string or number.
   * @param {*} val Required. The value to remove from the array or object.
   * @param {string} path Optional. The name of the array property to remove from.
   * Can be a path with dot notation, such as "prop1.subprop2.subprop3".
   * If not presents, removes directly from the value.
   * @return {Map} The EnMap.
   */
  remove(key, val, path = null) {
    this[_check](key, ['Array', 'Object']);
    const data = super.get(key);
    if (path) {
      const propValue = dotProp.get(data, path);
      if (propValue.constructor.name === 'Array') {
        propValue.splice(propValue.indexOf(val), 1);
        dotProp.set(data, path, propValue);
      } else if (propValue.constructor.name === 'Object') {
        dotProp.delete(data, `${path}.${val}`);
      }
    } else if (data.constructor.name === 'Array') {
      const index = data.indexOf(val);
      data.splice(index, 1);
    } else if (data.constructor.name === 'Object') {
      delete data[val];
    }
    return this.set(key, data);
  }

  /* INTERNAL (Private) METHODS */


  /**
   * INTERNAL method used by autonum().
   * Loops on incremental numerical values until it finds a free key
   * of that value in the Enamp. 
   * @param {Integer} start The starting value to look for.
   * @return {Integer} The first non-existant value found.
   */
  [_getHighestAutonum](start = 0) {
    let highest = start;
    while (this.has(highest)) {
      highest++;
    }
    return highest;
  }

  /**
   * INTERNAL method to verify the type of a key or property
   * Will THROW AN ERROR on wrong type, to simplify code.
   * @param {string|number} key Required. The key of the element to check
   * @param {string} type Required. The javascript constructor to check
   * @param {string} path Optional. The dotProp path to the property in the object enmap.
   */
  [_check](key, type, path = '') {
    if (!this.has(key)) throw `The key "${key}" does not exist in the enmap "${this.name}"`;
    if (!type) return;
    if (type.constructor.name !== 'Array') type = [type];
    if (path) {
      this[_check](key, 'Object');
      const data = super.get(key);
      if (!data) {
        throw `The property "${path}" does not exist in the key "${key}" in the enmap "${this.name}"`;
      }
      if (!type.includes(dotProp.get(data, path).constructor.name)) {
        throw `The property "${path}" in "${key}" is not of type "${type}" in the enmap "${this.name}" (key was of type "${dotProp.get(data, path).constructor.name}")`;
      }
    } else if (!type.includes(this.get(key).constructor.name)) {
      throw new Error(`The key "${key}" is not of correct type in the enmap "${this.name}" (key was of type "${this.get(key).constructor.name}")`);
    }
  }

  /**
  * INTERNAL method to execute a mathematical operation. Cuz... javascript. 
  * And I didn't want to import mathjs!
  * @param {number} base the lefthand operand.
  * @param {string} op the operation.
  * @param {number} opand the righthand operand.
  * @return {number} the result.
  */
  [_mathop](base, op, opand) {
    if (!base || !op) throw 'Math Operation requires base and operation';
    switch (op) {
    case 'add' :
    case 'addition' :
    case '+' :
      return base + opand;
    case 'sub' :
    case 'subtract' :
    case '-' :
      return base - opand;
    case 'mult' :
    case 'multiply' :
    case '*' :
      return base * opand;
    case 'div' :
    case 'divide' :
    case '/' :
      return base / opand;
    case 'exp' :
    case 'exponent' :
    case '^' :
      return Math.pow(base, opand);
    case 'mod' :
    case 'modulo' :
    case '%' :
      return base % opand;
    }
    return null;
  }


  /*
  BELOW IS DISCORD.JS COLLECTION CODE
  Per notes in the LICENSE file, this project contains code from Amish Shah's Discord.js
  library. The code is from the Collections object, in discord.js version 11. 

  All below code is sourced from Collections.
  https://github.com/discordjs/discord.js/blob/stable/src/util/Collection.js
  */

  /**
   * Creates an ordered array of the values of this Enmap.
   * The array will only be reconstructed if an item is added to or removed from the Enmap,
   * or if you change the length of the array itself. If you don't want this caching behaviour, 
   * use `Array.from(enmap.values())` instead.
   * @returns {Array}
   */
  array() {
    return Array.from(this.values());
  }

  /**
     * Creates an ordered array of the keys of this Enmap
     * The array will only be reconstructed if an item is added to or removed from the Enmap, 
     * or if you change the length of the array itself. If you don't want this caching behaviour, 
     * use `Array.from(enmap.keys())` instead.
     * @returns {Array}
     */
  keyArray() {
    return Array.from(this.keys());
  }

  /**
     * Obtains random value(s) from this Enmap. This relies on {@link Enmap#array}.
     * @param {number} [count] Number of values to obtain randomly
     * @returns {*|Array<*>} The single value if `count` is undefined,
     * or an array of values of `count` length
     */
  random(count) {
    let arr = this.array();
    if (count === undefined) return arr[Math.floor(Math.random() * arr.length)];
    if (typeof count !== 'number') throw new TypeError('The count must be a number.');
    if (!Number.isInteger(count) || count < 1) throw new RangeError('The count must be an integer greater than 0.');
    if (arr.length === 0) return [];
    const rand = new Array(count);
    arr = arr.slice();
    for (let i = 0; i < count; i++) {
      rand[i] = [arr.splice(Math.floor(Math.random() * arr.length), 1)];
    }
    return rand;
  }

  /**
     * Obtains random key(s) from this Enmap. This relies on {@link Enmap#keyArray}
     * @param {number} [count] Number of keys to obtain randomly
     * @returns {*|Array<*>} The single key if `count` is undefined, 
     * or an array of keys of `count` length
     */
  randomKey(count) {
    let arr = this.keyArray();
    if (count === undefined) return arr[Math.floor(Math.random() * arr.length)];
    if (typeof count !== 'number') throw new TypeError('The count must be a number.');
    if (!Number.isInteger(count) || count < 1) throw new RangeError('The count must be an integer greater than 0.');
    if (arr.length === 0) return [];
    const rand = new Array(count);
    arr = arr.slice();
    for (let i = 0; i < count; i++) {
      rand[i] = [arr.splice(Math.floor(Math.random() * arr.length), 1)];
    }
    return rand;
  }

  /**
     * Searches for all items where their specified property's value is identical to the given value
     * (`item[prop] === value`).
     * @param {string} prop The property to test against
     * @param {*} value The expected value
     * @returns {Array}
     * @example
     * enmap.findAll('username', 'Bob');
     */
  findAll(prop, value) {
    if (typeof prop !== 'string') throw new TypeError('Key must be a string.');
    if (typeof value === 'undefined') throw new Error('Value must be specified.');
    const results = [];
    for (const item of this.values()) {
      if (item[prop] === value) results.push(item);
    }
    return results;
  }

  /**
     * Searches for a single item where its specified property's value is identical to the given value
     * (`item[prop] === value`), or the given function returns a truthy value. In the latter case, this is identical to
     * [Array.find()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/find).
     * <warn>All Enmap used in Discord.js are mapped using their `id` property, and if you want to find by id you
     * should use the `get` method. See
     * [MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map/get) for details.</warn>
     * @param {string|Function} propOrFn The property to test against, or the function to test with
     * @param {*} [value] The expected value - only applicable and required if using a property for the first argument
     * @returns {*}
     * @example
     * enmap.find('username', 'Bob');
     * @example
     * enmap.find(val => val.username === 'Bob');
     */
  find(propOrFn, value) {
    if (typeof propOrFn === 'string') {
      if (typeof value === 'undefined') throw new Error('Value must be specified.');
      for (const item of this.values()) {
        if (item[propOrFn] === value) return item;
      }
      return null;
    } else if (typeof propOrFn === 'function') {
      for (const [key, val] of this) {
        if (propOrFn(val, key, this)) return val;
      }
      return null;
    }
    throw new Error('First argument must be a property string or a function.');
  }

  /* eslint-disable max-len */
  /**
     * Searches for the key of a single item where its specified property's value is identical to the given value
     * (`item[prop] === value`), or the given function returns a truthy value. In the latter case, this is identical to
     * [Array.findIndex()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/findIndex).
     * @param {string|Function} propOrFn The property to test against, or the function to test with
     * @param {*} [value] The expected value - only applicable and required if using a property for the first argument
     * @returns {*}
     * @example
     * enmap.findKey('username', 'Bob');
     * @example
     * enmap.findKey(val => val.username === 'Bob');
     */
  /* eslint-enable max-len */
  findKey(propOrFn, value) {
    if (typeof propOrFn === 'string') {
      if (typeof value === 'undefined') throw new Error('Value must be specified.');
      for (const [key, val] of this) {
        if (val[propOrFn] === value) return key;
      }
      return null;
    } else if (typeof propOrFn === 'function') {
      for (const [key, val] of this) {
        if (propOrFn(val, key, this)) return key;
      }
      return null;
    }
    throw new Error('First argument must be a property string or a function.');
  }

  /**
     * Searches for the existence of a single item where its specified property's value is identical to the given value
     * (`item[prop] === value`).
     * <warn>Do not use this to check for an item by its ID. Instead, use `enmap.has(id)`. See
     * [MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map/has) for details.</warn>
     * @param {string} prop The property to test against
     * @param {*} value The expected value
     * @returns {boolean}
     * @example
     * if (enmap.exists('username', 'Bob')) {
     *  console.log('user here!');
     * }
     */
  exists(prop, value) {
    return Boolean(this.find(prop, value));
  }

  /**
     * Identical to
     * [Array.filter()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/filter),
     * but returns a Enmap instead of an Array.
     * @param {Function} fn Function used to test (should return a boolean)
     * @param {Object} [thisArg] Value to use as `this` when executing function
     * @returns {Enmap}
     */
  filter(fn, thisArg) {
    if (thisArg) fn = fn.bind(thisArg);
    const results = new Enmap();
    for (const [key, val] of this) {
      if (fn(val, key, this)) results.set(key, val);
    }
    return results;
  }

  /**
     * Identical to
     * [Array.filter()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/filter).
     * @param {Function} fn Function used to test (should return a boolean)
     * @param {Object} [thisArg] Value to use as `this` when executing function
     * @returns {Array}
     */
  filterArray(fn, thisArg) {
    if (thisArg) fn = fn.bind(thisArg);
    const results = [];
    for (const [key, val] of this) {
      if (fn(val, key, this)) results.push(val);
    }
    return results;
  }

  /**
     * Identical to
     * [Array.map()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map).
     * @param {Function} fn Function that produces an element of the new array, taking three arguments
     * @param {*} [thisArg] Value to use as `this` when executing function
     * @returns {Array}
     */
  map(fn, thisArg) {
    if (thisArg) fn = fn.bind(thisArg);
    const arr = new Array(this.size);
    let i = 0;
    for (const [key, val] of this) arr[i++] = fn(val, key, this);
    return arr;
  }

  /**
     * Identical to
     * [Array.some()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/some).
     * @param {Function} fn Function used to test (should return a boolean)
     * @param {Object} [thisArg] Value to use as `this` when executing function
     * @returns {boolean}
     */
  some(fn, thisArg) {
    if (thisArg) fn = fn.bind(thisArg);
    for (const [key, val] of this) {
      if (fn(val, key, this)) return true;
    }
    return false;
  }

  /**
     * Identical to
     * [Array.every()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/every).
     * @param {Function} fn Function used to test (should return a boolean)
     * @param {Object} [thisArg] Value to use as `this` when executing function
     * @returns {boolean}
     */
  every(fn, thisArg) {
    if (thisArg) fn = fn.bind(thisArg);
    for (const [key, val] of this) {
      if (!fn(val, key, this)) return false;
    }
    return true;
  }

  /**
     * Identical to
     * [Array.reduce()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/reduce).
     * @param {Function} fn Function used to reduce, taking four arguments; `accumulator`, `currentValue`, `currentKey`,
     * and `enmap`
     * @param {*} [initialValue] Starting value for the accumulator
     * @returns {*}
     */
  reduce(fn, initialValue) {
    let accumulator;
    if (typeof initialValue !== 'undefined') {
      accumulator = initialValue;
      for (const [key, val] of this) accumulator = fn(accumulator, val, key, this);
    } else {
      let first = true;
      for (const [key, val] of this) {
        if (first) {
          accumulator = val;
          first = false;
          continue;
        }
        accumulator = fn(accumulator, val, key, this);
      }
    }
    return accumulator;
  }

  /**
     * Creates an identical shallow copy of this Enmap.
     * @returns {Enmap}
     * @example const newColl = someColl.clone();
     */
  clone() {
    return new this.constructor(this);
  }

  /**
     * Combines this Enmap with others into a new Enmap. None of the source Enmaps are modified.
     * @param {...Enmap} enmaps Enmaps to merge
     * @returns {Enmap}
     * @example const newColl = someColl.concat(someOtherColl, anotherColl, ohBoyAColl);
     */
  concat(...enmaps) {
    const newColl = this.clone();
    for (const coll of enmaps) {
      for (const [key, val] of coll) newColl.set(key, val);
    }
    return newColl;
  }

  /**
     * Checks if this Enmap shares identical key-value pairings with another.
     * This is different to checking for equality using equal-signs, because
     * the Enmaps may be different objects, but contain the same data.
     * @param {Enmap} enmap Enmap to compare with
     * @returns {boolean} Whether the Enmaps have identical contents
     */
  equals(enmap) {
    if (!enmap) return false;
    if (this === enmap) return true;
    if (this.size !== enmap.size) return false;
    return !this.find((value, key) => {
      const testVal = enmap.get(key);
      return testVal !== value || (testVal === undefined && !enmap.has(key));
    });
  }

}

module.exports = Enmap;

/**
 * @external forEach
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map/forEach}
 */

/**
 * @external keys
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map/keys}
 */

/**
 * @external values
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map/values}
 */
