// In-memory stand-ins for the Google Apps Script services the server code uses,
// so the whole app can be exercised in Node. Only what JobReceipts calls is modelled.

function createGoogle(opts) {
  opts = opts || {};
  let seq = 0;
  const nextId = (p) => `${p}${++seq}`;
  const props = new Map(Object.entries(opts.props || {}));
  const cache = new Map();
  const files = new Map();   // id -> File
  const folders = new Map(); // id -> Folder
  const sheets = new Map();  // id -> Spreadsheet
  const docs = new Map();    // id -> Doc
  const fetches = [];
  let activeUser = opts.user || "";
  const owner = opts.owner || "owner@example.com";

  class Blob {
    constructor(bytes, type, name) { this.bytes = bytes; this.type = type; this.name = name || "blob"; }
    getBytes() { return this.bytes; }
    getContentType() { return this.type; }
    getName() { return this.name; }
    setName(n) { this.name = n; return this; }
    getAs(type) { return new Blob(this.bytes, type, this.name); }
    getDataAsString() { return Buffer.from(this.bytes).toString("utf8"); }
  }

  const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };

  class File {
    constructor(blob, parent) { this.id = nextId("file"); this.blob = blob; this.name = blob.getName(); this.parent = parent; files.set(this.id, this); }
    getId() { return this.id; }
    getName() { return this.name; }
    setName(n) { this.name = n; return this; }
    getBlob() { return this.blob; }
    getAs(type) { return new Blob(this.blob.bytes, type, this.name); }
    getUrl() { return `https://drive.example/${this.id}`; }
    moveTo(folder) { this.parent = folder; return this; }
    makeCopy(name, folder) {
      const f = new File(new Blob(this.blob.bytes, this.blob.type, name), folder);
      if (docs.has(this.id)) docs.set(f.id, docs.get(this.id).clone(f.id));
      return f;
    }
  }

  class Folder {
    constructor(name, parent) { this.id = nextId("folder"); this.name = name; this.parent = parent; folders.set(this.id, this); }
    getId() { return this.id; }
    getName() { return this.name; }
    getFolders() { return iter([...folders.values()].filter((f) => f.parent === this)); }
    getFiles() { return iter([...files.values()].filter((f) => f.parent === this)); }
    createFolder(name) { return new Folder(name, this); }
    createFile(blob) { return new File(blob, this); }
  }
  const myDrive = new Folder("My Drive", null);

  // ---- Docs: a tiny element tree (paragraphs and tables of text cells)
  const ElementType = { PARAGRAPH: "PARAGRAPH", TABLE: "TABLE" };
  class Text { constructor(owner) { this.owner = owner; } setBold() { return this; } }
  class Cell { constructor(t) { this.text = t; } getText() { return this.text; } setText(t) { this.text = t; return this; } editAsText() { return new Text(this); } }
  class Row { constructor(cells) { this.cells = cells.map((c) => new Cell(c)); } getNumCells() { return this.cells.length; } getCell(i) { return this.cells[i]; } }
  class Table {
    constructor(rows) { this.rows = rows.map((r) => new Row(r)); }
    getType() { return ElementType.TABLE; }
    getNumRows() { return this.rows.length; }
    getRow(i) { return this.rows[i]; }
    setBorderColor() { return this; }
    toArray() { return this.rows.map((r) => r.cells.map((c) => c.text)); }
  }
  class Para {
    constructor(t) { this.text = t; }
    getType() { return ElementType.PARAGRAPH; }
    asParagraph() { return this; }
    getText() { return this.text; }
    setHeading() { return this; }
    editAsText() { return new Text(this); }
  }
  class Body {
    constructor(children) { this.children = children || []; }
    getNumChildren() { return this.children.length; }
    getChild(i) { return this.children[i]; }
    getTables() { return this.children.filter((c) => c instanceof Table); }
    appendParagraph(t) { const p = new Para(t); this.children.push(p); return p; }
    appendTable(rows) { const t = new Table(rows); this.children.push(t); return t; }
    insertParagraph(i, t) { const p = new Para(t); this.children.splice(i, 0, p); return p; }
    insertTable(i, rows) { const t = new Table(rows); this.children.splice(i, 0, t); return t; }
    text() { return this.children.map((c) => (c instanceof Table ? c.toArray().map((r) => r.join(" | ")).join("\n") : c.text)).join("\n"); }
  }
  class Doc {
    constructor(id, name, body) { this.id = id; this.name = name; this.body = body || new Body(); }
    getId() { return this.id; }
    getBody() { return this.body; }
    saveAndClose() {}
    clone(id) {
      const body = new Body(this.body.children.map((c) => (c instanceof Table ? new Table(c.toArray()) : new Para(c.text))));
      return new Doc(id, this.name, body);
    }
  }

  // ---- Sheets: rows of values
  class Range {
    constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
    getValues() {
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const row = this.sheet.rows[this.r - 1 + i] || [];
        out.push(Array.from({ length: this.nc }, (_, j) => (row[this.c - 1 + j] === undefined ? "" : row[this.c - 1 + j])));
      }
      return out;
    }
    setValues(v) {
      v.forEach((row, i) => { const target = (this.sheet.rows[this.r - 1 + i] ||= []); row.forEach((x, j) => { target[this.c - 1 + j] = x; }); });
      return this;
    }
    setFontWeight() { return this; }
  }
  class Sheet {
    constructor(name) { this.name = name; this.rows = []; }
    getRange(r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); }
    appendRow(v) { this.rows.push(v.slice()); }
    getLastRow() { return this.rows.length; }
    setFrozenRows() {}
  }
  class Spreadsheet {
    constructor(name) { this.id = nextId("sheet"); this.name = name; this.tabs = new Map(); sheets.set(this.id, this); }
    getId() { return this.id; }
    getSheetByName(n) { return this.tabs.get(n) || null; }
    insertSheet(n) { const s = new Sheet(n); this.tabs.set(n, s); return s; }
  }

  const g = {
    // test controls
    _: {
      props, files, folders, docs, fetches, myDrive, Body, Table, Para, Doc,
      setUser(u) { activeUser = u; },
      folder(name, parent) { return new Folder(name, parent || myDrive); },
      doc(name, children, parent) {
        const f = new File(new Blob([], "application/vnd.google-apps.document", name), parent || myDrive);
        docs.set(f.id, new Doc(f.id, name, new Body(children)));
        return f;
      },
      routes: [],
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (props.has(k) ? props.get(k) : null),
      setProperty: (k, v) => { props.set(k, String(v)); },
      deleteProperty: (k) => { props.delete(k); },
    }) },
    Session: {
      getActiveUser: () => ({ getEmail: () => activeUser }),
      getEffectiveUser: () => ({ getEmail: () => owner }),
      getScriptTimeZone: () => "America/Chicago",
    },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) || null, put: (k, v) => { cache.set(k, v); }, remove: (k) => { cache.delete(k); } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => nextId("uuid-"),
      base64Encode: (b) => Buffer.from(typeof b === "string" ? b : Uint8Array.from(b)).toString("base64"),
      base64Decode: (s) => Array.from(Buffer.from(s, "base64")),
      newBlob: (bytes, type, name) => new Blob(bytes, type, name),
      formatDate: (d, tz, fmt) => { if (fmt !== "yyyy-MM-dd") throw new Error("fake formatDate: " + fmt); return d.toISOString().slice(0, 10); },
      sleep() {},
    },
    DriveApp: {
      getFolderById: (id) => { if (!folders.has(id)) throw new Error("No folder " + id); return folders.get(id); },
      getFileById: (id) => { if (!files.has(id)) throw new Error("No file " + id); return files.get(id); },
      createFolder: (name) => new Folder(name, myDrive),
    },
    SpreadsheetApp: {
      create: (name) => new Spreadsheet(name),
      openById: (id) => { if (!sheets.has(id)) throw new Error("No sheet " + id); return sheets.get(id); },
    },
    DocumentApp: {
      ElementType,
      ParagraphHeading: { HEADING1: "H1", HEADING3: "H3" },
      create: (name) => { const f = g._.doc(name, []); return docs.get(f.id); },
      openById: (id) => docs.get(id),
    },
    UrlFetchApp: {
      fetch(url, o) {
        o = o || {};
        const req = { url, method: (o.method || "get").toLowerCase(), headers: o.headers || {}, body: o.payload && typeof o.payload === "string" ? JSON.parse(o.payload) : o.payload };
        fetches.push(req);
        const route = g._.routes.find((r) => r.match(req));
        if (!route) throw new Error("fake UrlFetchApp: no route for " + req.method + " " + url);
        const res = route.reply(req);
        const status = res.status || 200;
        return {
          getResponseCode: () => status,
          getContentText: () => (typeof res.body === "string" ? res.body : JSON.stringify(res.body)),
          getBlob: () => res.blob,
        };
      },
    },
    HtmlService: {
      createTemplateFromFile: () => ({ evaluate: () => ({ setTitle() { return this; }, addMetaTag() { return this; }, setXFrameOptionsMode() { return this; } }) }),
      createHtmlOutputFromFile: () => ({ getContent: () => "" }),
      createHtmlOutput: (h) => ({ html: h }),
      XFrameOptionsMode: { DEFAULT: "DEFAULT" },
    },
    Logger: { log() {} },
    ScriptApp: {
      getService: () => ({ getUrl: () => "https://script.google.com/macros/s/APP/exec" }),
      triggers: [],
      getProjectTriggers() { return this.triggers; },
      newTrigger(fn) { const self = this; return { timeBased: () => ({ everyHours: () => ({ create: () => self.triggers.push({ getHandlerFunction: () => fn }) }) }) }; },
    },
    OAuth2: {
      createService() {
        const svc = { access: opts.qboConnected !== false };
        const chain = new Proxy(svc, { get: (t, k) => (k in t ? t[k] : () => chain) });
        svc.hasAccess = () => svc.access;
        svc.getAccessToken = () => "qbo-token";
        svc.getAuthorizationUrl = () => "https://appcenter.intuit.com/connect/oauth2?x";
        svc.reset = () => { svc.access = false; };
        return chain;
      },
    },
  };
  return g;
}

module.exports = { createGoogle };
