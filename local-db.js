const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const DATA_PATH = path.join(__dirname, "local-data.json");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeId(value) {
  return value === undefined || value === null ? value : String(value);
}

function pickFields(record, fields) {
  if (!fields) return record;
  const selected = {};
  fields.split(/\s+/).filter(Boolean).forEach((field) => {
    if (record[field] !== undefined) selected[field] = record[field];
  });
  selected._id = record._id;
  return selected;
}

function matchesFilter(record, filter = {}) {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = record[key];
    if (Array.isArray(actual)) return actual.map(String).includes(String(expected));
    return String(actual) === String(expected);
  });
}

function sortable(value) {
  if (value instanceof Date) return value.getTime();
  const date = new Date(value);
  if (!Number.isNaN(date.getTime()) && typeof value !== "number") return date.getTime();
  return value;
}

class LocalDocument {
  constructor(model, data) {
    this.__model = model;
    Object.assign(this, data);
  }

  toJSON() {
    const result = {};
    Object.entries(this).forEach(([key, value]) => {
      if (key !== "__model") result[key] = value;
    });
    return result;
  }

  async save() {
    this.updatedAt = new Date();
    this.__model.store.update(this.__model.name, this._id, this.toJSON());
    return this;
  }

  async populate(populates) {
    const specs = Array.isArray(populates) ? populates : [populates];
    for (const spec of specs) {
      const pathName = typeof spec === "string" ? spec : spec.path;
      const select = typeof spec === "string" ? undefined : spec.select;
      const model = this.__model.store.modelForPath(pathName);
      if (!model) continue;

      if (Array.isArray(this[pathName])) {
        this[pathName] = this[pathName].map((id) => model.findRawById(id)).filter(Boolean).map((item) => pickFields(item, select));
      } else if (this[pathName]) {
        const item = model.findRawById(this[pathName]);
        this[pathName] = item ? pickFields(item, select) : this[pathName];
      }
    }
    return this;
  }
}

class LocalQuery {
  constructor(model, records) {
    this.model = model;
    this.records = records;
    this.populates = [];
    this.selectedFields = undefined;
    this.sortSpec = undefined;
  }

  select(fields) {
    this.selectedFields = fields;
    return this;
  }

  populate(pathName, select) {
    if (Array.isArray(pathName)) this.populates.push(...pathName);
    else this.populates.push({ path: pathName, select });
    return this;
  }

  sort(spec) {
    this.sortSpec = spec;
    return this;
  }

  async exec() {
    let records = clone(this.records);
    if (this.sortSpec) {
      const [[field, direction]] = Object.entries(this.sortSpec);
      records.sort((a, b) => {
        const left = sortable(a[field]);
        const right = sortable(b[field]);
        const result = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
        return direction < 0 ? -result : result;
      });
    }

    const docs = records.map((record) => this.model.wrap(this.selectedFields ? pickFields(record, this.selectedFields) : record));
    for (const doc of docs) {
      if (this.populates.length) await doc.populate(this.populates);
    }
    return docs;
  }

  then(resolve, reject) {
    return this.exec().then(resolve, reject);
  }

  catch(reject) {
    return this.exec().catch(reject);
  }
}

class LocalModel {
  constructor(name, store) {
    this.name = name;
    this.store = store;
  }

  defaults(data) {
    if (this.name === "User") return { role: "Member", ...data };
    if (this.name === "Task") return { status: "Todo", priority: "Medium", description: "", ...data };
    if (this.name === "Project") return { description: "", members: [], ...data };
    return data;
  }

  wrap(record) {
    return new LocalDocument(this, {
      ...record,
      dueDate: record.dueDate ? new Date(record.dueDate) : record.dueDate,
      createdAt: record.createdAt ? new Date(record.createdAt) : record.createdAt,
      updatedAt: record.updatedAt ? new Date(record.updatedAt) : record.updatedAt
    });
  }

  findRawById(id) {
    const record = this.store.data[this.name].find((item) => item._id === normalizeId(id));
    return record ? clone(record) : null;
  }

  find(filter = {}) {
    return new LocalQuery(this, this.store.data[this.name].filter((record) => matchesFilter(record, filter)));
  }

  async findById(id) {
    const record = this.findRawById(id);
    return record ? this.wrap(record) : null;
  }

  async findOne(filter = {}) {
    const record = this.store.data[this.name].find((item) => matchesFilter(item, filter));
    return record ? this.wrap(clone(record)) : null;
  }

  async create(data) {
    const now = new Date();
    const record = this.defaults({
      ...data,
      _id: new mongoose.Types.ObjectId().toString(),
      createdAt: now,
      updatedAt: now
    });
    this.store.data[this.name].push(clone(record));
    this.store.persist();
    return this.wrap(record);
  }

  findByIdAndUpdate(id, update) {
    const record = this.store.update(this.name, id, update);
    return new LocalSingleQuery(this, record);
  }

  async findByIdAndDelete(id) {
    const index = this.store.data[this.name].findIndex((item) => item._id === normalizeId(id));
    if (index === -1) return null;
    const [deleted] = this.store.data[this.name].splice(index, 1);
    this.store.persist();
    return this.wrap(deleted);
  }

  async deleteMany(filter = {}) {
    const before = this.store.data[this.name].length;
    this.store.data[this.name] = this.store.data[this.name].filter((record) => !matchesFilter(record, filter));
    this.store.persist();
    return { deletedCount: before - this.store.data[this.name].length };
  }

  async countDocuments(filter = {}) {
    return this.store.data[this.name].filter((record) => matchesFilter(record, filter)).length;
  }
}

class LocalSingleQuery {
  constructor(model, record) {
    this.model = model;
    this.record = record;
    this.populates = [];
  }

  populate(pathName, select) {
    this.populates.push({ path: pathName, select });
    return this;
  }

  async exec() {
    if (!this.record) return null;
    const doc = this.model.wrap(clone(this.record));
    if (this.populates.length) await doc.populate(this.populates);
    return doc;
  }

  then(resolve, reject) {
    return this.exec().then(resolve, reject);
  }

  catch(reject) {
    return this.exec().catch(reject);
  }
}

class LocalStore {
  constructor() {
    this.data = { User: [], Project: [], Task: [] };
    this.User = new LocalModel("User", this);
    this.Project = new LocalModel("Project", this);
    this.Task = new LocalModel("Task", this);
  }

  load() {
    if (fs.existsSync(DATA_PATH)) {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(DATA_PATH, "utf8")) };
    } else {
      this.persist();
    }
  }

  persist() {
    fs.writeFileSync(DATA_PATH, `${JSON.stringify(this.data, null, 2)}\n`);
  }

  update(modelName, id, update) {
    const index = this.data[modelName].findIndex((item) => item._id === normalizeId(id));
    if (index === -1) return null;
    this.data[modelName][index] = {
      ...this.data[modelName][index],
      ...update,
      updatedAt: new Date()
    };
    this.persist();
    return clone(this.data[modelName][index]);
  }

  modelForPath(pathName) {
    if (pathName === "owner" || pathName === "members" || pathName === "assignee" || pathName === "createdBy") return this.User;
    if (pathName === "project") return this.Project;
    return null;
  }
}

function createLocalModels() {
  const store = new LocalStore();
  store.load();
  return {
    User: store.User,
    Project: store.Project,
    Task: store.Task
  };
}

module.exports = { createLocalModels, DATA_PATH };
