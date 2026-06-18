import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = join(__dirname, '..', '.data');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

let idCounter = 1;
function genId() { return (idCounter++).toString(); }

function clone(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj.getTime());
  return JSON.parse(JSON.stringify(obj));
}

/* === query matching === */
function compareValues(a, b) {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (a instanceof Date) return a.getTime() - new Date(b).getTime();
  if (b instanceof Date) return new Date(a).getTime() - b.getTime();
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function matchOp(value, op, condition) {
  if (op === '$eq') return value === condition;
  if (op === '$ne') return value !== condition;
  if (op === '$gt') return compareValues(value, condition) > 0;
  if (op === '$gte') return compareValues(value, condition) >= 0;
  if (op === '$lt') return compareValues(value, condition) < 0;
  if (op === '$lte') return compareValues(value, condition) <= 0;
  if (op === '$in') return Array.isArray(condition) && condition.includes(value);
  if (op === '$nin') return Array.isArray(condition) && !condition.includes(value);
  if (op === '$exists') return condition ? value !== undefined && value !== null : value === undefined || value === null;
  if (op === '$regex') { try { return new RegExp(condition).test(String(value)); } catch { return false; } }
  return true;
}

function matchCondition(value, condition) {
  if (condition === null || condition === undefined) return value === condition;
  if (typeof condition === 'object' && !Array.isArray(condition) && !(condition instanceof Date)) {
    const keys = Object.keys(condition);
    if (keys.length === 0) return true;
    if (keys.every(k => k.startsWith('$'))) return keys.every(k => matchOp(value, k, condition[k]));
    return false;
  }
  if (condition instanceof RegExp) return condition.test(String(value));
  return value === condition;
}

function matchDocument(doc, query) {
  for (const [key, condition] of Object.entries(query)) {
    if (key === '$and') { if (!condition.every(c => matchDocument(doc, c))) return false; continue; }
    if (key === '$or') { if (!condition.some(c => matchDocument(doc, c))) return false; continue; }
    const value = key.includes('.') ? key.split('.').reduce((o, k) => o?.[k], doc) : doc[key];
    if (!matchCondition(value, condition)) return false;
  }
  return true;
}

function sortDocs(docs, sortObj) {
  if (!sortObj) return docs;
  const keys = Object.keys(sortObj);
  return [...docs].sort((a, b) => {
    for (const key of keys) {
      const dir = sortObj[key];
      const av = a[key] ?? 0;
      const bv = b[key] ?? 0;
      if (av < bv) return dir > 0 ? -1 : 1;
      if (av > bv) return dir > 0 ? 1 : -1;
    }
    return 0;
  });
}

function isISODate(str) {
  return typeof str === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(str);
}

function hydrate(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && isISODate(v)) obj[k] = new Date(v);
    else if (Array.isArray(v)) obj[k] = v.map(i => hydrate(i));
    else if (v && typeof v === 'object' && !(v instanceof Date)) hydrate(v);
  }
  return obj;
}

function dehydrate(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === '_collection' || k === '_isNew' || k === 'save' || k === 'toObject' || k === 'toJSON') continue;
    if (v instanceof Date) out[k] = v.toISOString();
    else if (Array.isArray(v)) out[k] = v.map(i => dehydrate(i));
    else if (v && typeof v === 'object' && !(v instanceof Date)) out[k] = dehydrate(v);
    else out[k] = v;
  }
  return out;
}

/* === Collection (internal store) === */
class Collection {
  constructor(name) {
    this.name = name;
    this._docs = new Map();
    this._filePath = join(DATA_DIR, `${name}.json`);
    this._preHooks = [];
    this.load();
  }

  preSave(fn) { this._preHooks.push(fn); }

  load() {
    try {
      if (existsSync(this._filePath)) {
        const raw = readFileSync(this._filePath, 'utf8').trim();
        if (!raw) return;
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return;
        for (const item of arr) {
          if (item._id) {
            const n = parseInt(item._id, 10);
            if (n >= idCounter) idCounter = n + 1;
          }
          this._docs.set(item._id, hydrate(item));
        }
      }
    } catch (e) { console.error(`[DB] Load ${this.name}:`, e.message); }
  }

  saveToDisk() {
    try {
      const arr = Array.from(this._docs.values()).map(d => dehydrate(d));
      writeFileSync(this._filePath, JSON.stringify(arr, null, 2), 'utf8');
    } catch (e) { console.error(`[DB] Save ${this.name}:`, e.message); }
  }

  async runPreHooks(doc) {
    for (const fn of this._preHooks) {
      await fn.call(doc);
    }
  }

  insertOne(data) {
    const doc = clone(data);
    if (!doc._id) doc._id = genId();
    this._docs.set(doc._id, doc);
    this.saveToDisk();
    return doc;
  }

  find(query = {}) {
    return Array.from(this._docs.values()).filter(d => matchDocument(d, query));
  }

  findRaw(query = {}) {
    return this.find(query);
  }

  findOneRaw(query = {}) {
    for (const doc of this._docs.values()) {
      if (matchDocument(doc, query)) return doc;
    }
    return null;
  }

  applyUpdate(doc, update) {
    const keys = Object.keys(update);
    const hasOperators = keys.some(k => k.startsWith('$'));
    if (!hasOperators) {
      for (const [k, v] of Object.entries(update)) doc[k] = v;
      return;
    }
    if (update.$set) { for (const [k, v] of Object.entries(update.$set)) doc[k] = v; }
    if (update.$inc) { for (const [k, v] of Object.entries(update.$inc)) doc[k] = (doc[k] || 0) + v; }
    if (update.$push) {
      for (const [k, v] of Object.entries(update.$push)) {
        if (!doc[k]) doc[k] = [];
        doc[k].push(v);
      }
    }
    if (update.$unshift) {
      for (const [k, v] of Object.entries(update.$unshift)) {
        if (!doc[k]) doc[k] = [];
        doc[k].unshift(v);
      }
    }
    if (update.$pull) {
      for (const [k, v] of Object.entries(update.$pull)) {
        if (doc[k]) doc[k] = doc[k].filter(item => !matchDocument(item, v));
      }
    }
    if (update.$addToSet) {
      for (const [k, v] of Object.entries(update.$addToSet)) {
        if (!doc[k]) doc[k] = [];
        const items = v.$each || [v];
        for (const item of items) {
          if (!doc[k].some(ex => JSON.stringify(ex) === JSON.stringify(item))) doc[k].push(item);
        }
      }
    }
  }

  updateOne(query, update) {
    const doc = this.findOneRaw(query);
    if (!doc) return { matched: 0, modified: 0 };
    this.applyUpdate(doc, update);
    this.saveToDisk();
    return { matched: 1, modified: 1 };
  }

  updateMany(query, update) {
    let matched = 0;
    for (const doc of this._docs.values()) {
      if (matchDocument(doc, query)) { this.applyUpdate(doc, update); matched++; }
    }
    if (matched > 0) this.saveToDisk();
    return { matched, modified: matched };
  }

  deleteOne(query) {
    for (const [id, doc] of this._docs) {
      if (matchDocument(doc, query)) { this._docs.delete(id); this.saveToDisk(); return { deleted: 1 }; }
    }
    return { deleted: 0 };
  }

  deleteMany(query) {
    let deleted = 0;
    for (const [id, doc] of this._docs) {
      if (matchDocument(doc, query)) { this._docs.delete(id); deleted++; }
    }
    if (deleted > 0) this.saveToDisk();
    return { deleted };
  }

  count(query = {}) {
    let c = 0;
    for (const doc of this._docs.values()) { if (matchDocument(doc, query)) c++; }
    return c;
  }

  distinct(field, query = {}) {
    const s = new Set();
    for (const doc of this._docs.values()) {
      if (matchDocument(doc, query)) {
        const v = doc[field];
        if (Array.isArray(v)) v.forEach(x => s.add(x));
        else s.add(v);
      }
    }
    return Array.from(s);
  }

  aggregate(pipeline) {
    let docs = Array.from(this._docs.values()).map(d => clone(d));
    for (const stage of pipeline) {
      if (!stage) continue;
      if (stage.$match) docs = docs.filter(d => matchDocument(d, stage.$match));
      else if (stage.$group) docs = this._aggGroup(docs, stage.$group);
      else if (stage.$sort) docs = sortDocs(docs, stage.$sort);
      else if (stage.$limit) docs = docs.slice(0, stage.$limit);
      else if (stage.$skip) docs = docs.slice(stage.$skip);
      else if (stage.$project) {
        docs = docs.map(d => {
          const r = {};
          for (const [k, v] of Object.entries(stage.$project)) {
            if (v === 1) r[k] = d[k];
            else if (v === 0) continue;
            else if (typeof v === 'string') r[k] = this._evalExpr(v, d);
            else if (v && typeof v === 'object') r[k] = this._evalExpr(v, d);
            else r[k] = v;
          }
          return r;
        });
      }
    }
    return this._finalizeAgg(docs);
  }

  _aggGroup(docs, spec) {
    const makeKey = (doc) => {
      if (spec._id === null || spec._id === undefined) return '__all__';
      return String(this._evalExpr(spec._id, doc) ?? 'null');
    };

    const groups = new Map();
    for (const doc of docs) {
      const key = makeKey(doc);
      if (!groups.has(key)) {
        const entry = { _id: key === '__all__' ? null : key };
        for (const [k, v] of Object.entries(spec)) {
          if (k === '_id') continue;
          entry[`_s_${k}`] = this._aggInit(v);
        }
        groups.set(key, entry);
      }
      const entry = groups.get(key);
      for (const [k, v] of Object.entries(spec)) {
        if (k === '_id') continue;
        this._aggAccum(entry, k, v, doc);
      }
    }

    return Array.from(groups.values()).map(entry => {
      const r = { _id: entry._id };
      for (const [k, v] of Object.entries(spec)) {
        if (k === '_id') continue;
        r[k] = this._aggFin(entry[`_s_${k}`], v);
      }
      return r;
    });
  }

  // Evaluate an aggregation expression against a document
  _evalExpr(expr, doc) {
    if (typeof expr === 'number') return expr;
    if (typeof expr === 'boolean') return expr;
    if (typeof expr === 'string') {
      if (expr.startsWith('$')) return doc[expr.slice(1)];
      return expr;
    }
    if (!expr || typeof expr !== 'object') return expr;
    if (Array.isArray(expr)) return expr.map(e => this._evalExpr(e, doc));
    const op = Object.keys(expr)[0];
    const args = expr[op];

    if (op === '$cond') {
      const [condExpr, tVal, fVal] = args;
      return this._evalExpr(condExpr, doc) ? this._evalExpr(tVal, doc) : this._evalExpr(fVal, doc);
    }
    if (op === '$ifNull') {
      const [checkExpr, defaultVal] = args;
      const val = this._evalExpr(checkExpr, doc);
      return val != null ? val : this._evalExpr(defaultVal, doc);
    }
    if (op === '$eq') return this._evalExpr(args[0], doc) === this._evalExpr(args[1], doc);
    if (op === '$ne') return this._evalExpr(args[0], doc) !== this._evalExpr(args[1], doc);
    if (op === '$gte') return this._evalExpr(args[0], doc) >= this._evalExpr(args[1], doc);
    if (op === '$lte') return this._evalExpr(args[0], doc) <= this._evalExpr(args[1], doc);
    if (op === '$gt') return this._evalExpr(args[0], doc) > this._evalExpr(args[1], doc);
    if (op === '$lt') return this._evalExpr(args[0], doc) < this._evalExpr(args[1], doc);
    return expr;
  }

  _aggInit(spec) {
    if (!spec || typeof spec !== 'object') return 0;
    const op = Object.keys(spec)[0];
    if (op === '$sum') return 0;
    if (op === '$avg') return { count: 0, sum: 0 };
    if (op === '$max') return -Infinity;
    if (op === '$min') return Infinity;
    if (op === '$push') return [];
    if (op === '$addToSet') return new Set();
    return undefined;
  }

  _aggAccum(entry, field, spec, doc) {
    if (!spec || typeof spec !== 'object') return;
    const op = Object.keys(spec)[0];
    const expr = spec[op];
    const val = this._evalExpr(expr, doc);
    const state = entry[`_s_${field}`];

    if (op === '$sum') {
      if (typeof val === 'number') entry[`_s_${field}`] += val;
    } else if (op === '$avg') {
      if (typeof val === 'number') { state.sum += val; state.count++; }
    } else if (op === '$max') {
      if (val > state) entry[`_s_${field}`] = val;
    } else if (op === '$min') {
      if (state === Infinity || val < state) entry[`_s_${field}`] = val;
    } else if (op === '$push') {
      state.push(val);
    } else if (op === '$addToSet') {
      state.add(val);
    }
  }

  _aggFin(state, spec) {
    if (!spec || typeof spec !== 'object') return state;
    const op = Object.keys(spec)[0];
    if (op === '$avg') return state.count > 0 ? state.sum / state.count : 0;
    if (op === '$addToSet') return Array.from(state);
    if (state === -Infinity || state === Infinity) return 0;
    return state;
  }

  _finalizeAgg(results) {
    return results.map(r => {
      for (const k of Object.keys(r)) { if (k.startsWith('_s_')) delete r[k]; }
      return r;
    });
  }
}

/* === createModel: returns a mongoose-compatible Model class === */
const modelCache = new Map();

function createModel(collectionName) {
  if (modelCache.has(collectionName)) return modelCache.get(collectionName);

  const col = new Collection(collectionName);

  class Model {
    constructor(data) {
      if (!data) data = {};
      for (const [k, v] of Object.entries(data)) this[k] = v;
      if (!this._id) this._id = genId();
      this.id = this._id;
      this._isNew = true;
    }

    async save() {
      await col.runPreHooks(this);
      if (this._isNew && !this.createdAt) this.createdAt = new Date();
      this.updatedAt = new Date();
      this._isNew = false;
      if (col._docs.has(this._id)) {
        Object.assign(col._docs.get(this._id), this);
      } else {
        col._docs.set(this._id, this);
      }
      col.saveToDisk();
      return this;
    }

    toObject() { return clone(this); }
    toJSON() { return this; }
  }

  // Attach pre-save hooks
  Model.col = col;

  Model.preSave = function (fn) { col.preSave(fn); };

  function wrap(doc) {
    if (!doc) return null;
    const m = Object.assign(new Model(), doc);
    m.id = m._id;
    m._isNew = false;
    return m;
  }

  Model.find = async function (query = {}, sort = null, limit = null) {
    let docs = col.findRaw(query);
    if (sort) docs = sortDocs(docs, sort);
    if (limit) docs = docs.slice(0, limit);
    return docs.map(d => wrap(d));
  };

  Model.findOne = async function (query = {}) {
    return wrap(col.findOneRaw(query));
  };

  Model.findById = async function (id) {
    if (!id) return null;
    return wrap(col.findOneRaw({ _id: id.toString() }));
  };

  Model.findByIdAndUpdate = async function (id, update, options = {}) {
    const doc = col.findOneRaw({ _id: id?.toString() });
    if (!doc) {
      if (options.upsert) {
        const m = new Model();
        m._id = id?.toString();
        col.applyUpdate(m, update);
        col.insertOne(m);
        return m;
      }
      return null;
    }
    const before = clone(doc);
    if (!options.suppressTimestamps) doc.updatedAt = new Date();
    col.applyUpdate(doc, update);
    col.saveToDisk();
    return options.returnDocument === 'before' ? wrap(before) : wrap(doc);
  };

  Model.findOneAndUpdate = async function (query, update, options = {}) {
    const doc = col.findOneRaw(query);
    if (!doc) {
      if (options.upsert) {
        const m = new Model(query);
        if (!m.createdAt) m.createdAt = new Date();
        m.updatedAt = new Date();
        col.applyUpdate(m, update);
        col.insertOne(m);
        return m;
      }
      return null;
    }
    const before = clone(doc);
    if (!options.suppressTimestamps) doc.updatedAt = new Date();
    col.applyUpdate(doc, update);
    col.saveToDisk();
    return options.returnDocument === 'before' ? wrap(before) : wrap(doc);
  };

  Model.findOneAndDelete = async function (query) {
    const doc = col.findOneRaw(query);
    if (!doc) return null;
    col._docs.delete(doc._id);
    col.saveToDisk();
    return wrap(doc);
  };

  Model.findByIdAndDelete = async function (id) {
    return Model.findOneAndDelete({ _id: id?.toString() });
  };

  Model.create = async function (data) {
    if (Array.isArray(data)) {
      const results = [];
      for (const item of data) {
        const m = new Model(item);
        await m.save();
        results.push(m);
      }
      return results;
    }
    const m = new Model(data);
    await m.save();
    return m;
  };

  Model.insertMany = async function (dataArray) {
    const results = [];
    for (const item of dataArray) {
      const m = new Model(item);
      await m.save();
      results.push(m);
    }
    return results;
  };

  Model.updateOne = async function (query, update) {
    return col.updateOne(query, update);
  };

  Model.updateMany = async function (query, update) {
    return col.updateMany(query, update);
  };

  Model.deleteOne = async function (query) {
    return col.deleteOne(query);
  };

  Model.deleteMany = async function (query) {
    return col.deleteMany(query);
  };

  Model.countDocuments = async function (query = {}) {
    return col.count(query);
  };

  Model.distinct = async function (field, query = {}) {
    return col.distinct(field, query);
  };

  Model.aggregate = async function (pipeline) {
    return col.aggregate(pipeline);
  };

  Model.lean = function () { return this; };

  modelCache.set(collectionName, Model);
  return Model;
}

export { createModel, Collection };
