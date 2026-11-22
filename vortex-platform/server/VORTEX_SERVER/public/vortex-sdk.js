/**
 * VORTEX VaaS SDK v1.0.0 — the drop-in "Firebase's father" client.
 *
 *   <script src="/vortex-sdk.js"></script>
 *   const vx = Vortex.initializeApp({ projectId, clientKey, apiUrl });
 *   await vx.auth().signUp(email, password, name);
 *   await vx.data().collection("posts").add({ title: "hello" });
 *   await vx.data().batch().add("posts", {...}).update("posts", id, {...}).commit();
 *   await vx.storage().uploadText("notes/a.txt", "hi");
 *   await vx.realtime().channel("chat-1").on("message", console.log);   // TRUE SSE push
 *   await vx.config().fetch();                                          // Remote Config
 *   await vx.analytics().log("screen_view", { screen: "home" });
 *   vx.crash().install();                                               // Crashlytics auto-capture
 *   await vx.push().register(deviceToken, "android");
 *   await vx.functions().invoke("onUserWelcome");
 *
 * Zero dependencies. Works in any browser (and any JS runtime with fetch).
 * The CLIENT key (vxk_…) is publishable by design — rules and quotas are
 * enforced SERVER-SIDE by the VORTEX VAAS control plane (dhaka-1).
 * Admin operations (push.send, config.set, batch without rules) live in
 * Vortex.admin() — the counterpart of firebase-admin.
 */
(function (global) {
  "use strict";

  var DEFAULT_API = "/api/vaas/v1";
  var LS_KEY = "vortex_vaas_session_";

  function VortexError(message, code) {
    var e = new Error(message);
    e.code = code || 400;
    return e;
  }

  function request(apiUrl, method, path, opts) {
    opts = opts || {};
    var headers = { "x-vx-key": opts.clientKey };
    if (opts.idToken) headers["Authorization"] = "Bearer " + opts.idToken;
    if (opts.adminKey) headers["x-vx-key"] = opts.adminKey;
    var init = { method: method, headers: headers };
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    return fetch(apiUrl + path, init).then(function (res) {
      if (res.headers.get("content-type") && res.headers.get("content-type").indexOf("json") >= 0) {
        return res.json().then(function (json) {
          if (!json.ok && json.error) throw VortexError(json.error, json.code || res.status);
          return json;
        });
      }
      if (!res.ok) throw VortexError("HTTP " + res.status, res.status);
      return res.arrayBuffer().then(function (buf) {
        return { ok: true, bytes: buf, mime: res.headers.get("content-type") || "application/octet-stream" };
      });
    });
  }

  function b64encode(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  // ---------------------------------------------------------- auth
  function Auth(app) {
    this._app = app;
  }
  Auth.prototype._save = function (session) {
    try { localStorage.setItem(LS_KEY + this._app.config.projectId, JSON.stringify(session)); } catch (e) {}
    this._app._session = session;
    return session;
  };
  Auth.prototype._restore = function () {
    if (this._app._session) return this._app._session;
    try {
      var raw = localStorage.getItem(LS_KEY + this._app.config.projectId);
      if (raw) this._app._session = JSON.parse(raw);
    } catch (e) {}
    return this._app._session || null;
  };
  Auth.prototype.signUp = function (email, password, displayName) {
    var app = this._app;
    return request(app.config.apiUrl, "POST", "/auth/signup", {
      clientKey: app.config.clientKey,
      body: { email: email, password: password, displayName: displayName }
    }).then(function (r) { return app.auth()._save(r); });
  };
  Auth.prototype.signIn = function (email, password) {
    var app = this._app;
    return request(app.config.apiUrl, "POST", "/auth/login", {
      clientKey: app.config.clientKey,
      body: { email: email, password: password }
    }).then(function (r) { return app.auth()._save(r); });
  };
  Auth.prototype.sendSignInCode = function (email) {
    var app = this._app;
    return request(app.config.apiUrl, "POST", "/auth/otp-request", {
      clientKey: app.config.clientKey,
      body: { email: email }
    }).then(function (r) { return r; });
  };
  Auth.prototype.verifySignInCode = function (email, code) {
    var app = this._app;
    return request(app.config.apiUrl, "POST", "/auth/otp-verify", {
      clientKey: app.config.clientKey,
      body: { email: email, code: code }
    }).then(function (r) { return app.auth()._save(r); });
  };
  Auth.prototype.currentUser = function () {
    var s = this._restore();
    if (!s) return null;
    return { uid: s.uid, email: s.email, displayName: s.displayName, idToken: s.idToken };
  };
  Auth.prototype.me = function () {
    var app = this._app;
    var s = this._restore();
    return request(app.config.apiUrl, "GET", "/auth/me", {
      clientKey: app.config.clientKey, idToken: s && s.idToken
    });
  };
  Auth.prototype.signOut = function () {
    var app = this._app;
    var s = this._restore();
    return request(app.config.apiUrl, "POST", "/auth/signout", {
      clientKey: app.config.clientKey, idToken: s && s.idToken, body: {}
    }).then(function (r) {
      try { localStorage.removeItem(LS_KEY + app.config.projectId); } catch (e) {}
      app._session = null;
      return r;
    });
  };

  // ---------------------------------------------------------- data (Firestore-style)
  function Query(collection, spec) {
    this._c = collection;
    this._q = spec || { conditions: [] };
  }
  Query.prototype.where = function (field, op, value) {
    var conds = this._q.conditions.slice();
    conds.push({ field: field, op: op, value: value });
    return new Query(this._c, { conditions: conds });
  };
  Query.prototype.contains = function (field, text) {
    return this.where(field, "contains", text);
  };
  Query.prototype.orderBy = function (field) {
    return new Query(this._c, { conditions: this._q.conditions.slice(), orderBy: field, limit: this._q.limit, skip: this._q.skip });
  };
  Query.prototype.limit = function (n) {
    return new Query(this._c, { conditions: this._q.conditions.slice(), orderBy: this._q.orderBy, limit: n, skip: this._q.skip });
  };
  Query.prototype.skip = function (n) {
    return new Query(this._c, { conditions: this._q.conditions.slice(), orderBy: this._q.orderBy, limit: this._q.limit, skip: n });
  };
  Query.prototype.get = function () {
    var app = this._c._app, name = this._c._name, q = this._q;
    var s = app.auth()._restore();
    var params = [];
    var where = {}, contains = {};
    (q.conditions || []).forEach(function (c) {
      if (c.op === "contains") contains[c.field] = c.value;
      else if (c.op === "==" ) where[c.field] = c.value;
      else where[c.field] = c.value; // server treats plain eq; ops map server-side
    });
    if (Object.keys(where).length) params.push("where=" + encodeURIComponent(JSON.stringify(where)));
    if (Object.keys(contains).length) params.push("contains=" + encodeURIComponent(JSON.stringify(contains)));
    if (q.orderBy) params.push("orderBy=" + encodeURIComponent(q.orderBy));
    if (q.limit) params.push("limit=" + q.limit);
    if (q.skip) params.push("skip=" + q.skip);
    return request(app.config.apiUrl, "GET", "/data/" + name + (params.length ? "?" + params.join("&") : ""), {
      clientKey: app.config.clientKey, idToken: s && s.idToken
    }).then(function (r) { return r.items || []; });
  };
  function Collection(app, name) {
    this._app = app;
    this._name = name;
  }
  Collection.prototype._session = function () {
    return this._app.auth()._restore();
  };
  Collection.prototype.add = function (data) {
    var app = this._app, s = this._session();
    return request(app.config.apiUrl, "POST", "/data/" + this._name, {
      clientKey: app.config.clientKey, idToken: s && s.idToken, body: { data: data }
    }).then(function (r) { return r.doc; });
  };
  Collection.prototype.doc = function (docId) {
    return new DocRef(this._app, this._name, docId);
  };
  Collection.prototype.get = function () { return new Query(this).get(); };
  function DocRef(app, collection, docId) {
    this._app = app; this._c = collection; this._id = docId;
  }
  DocRef.prototype._session = function () { return this._app.auth()._restore(); };
  DocRef.prototype.get = function () {
    var app = this._app, s = this._session();
    return request(app.config.apiUrl, "GET", "/data/" + this._c + "/" + this._id, {
      clientKey: app.config.clientKey, idToken: s && s.idToken
    }).then(function (r) { return r; });
  };
  DocRef.prototype.set = function (data) {
    var app = this._app, s = this._session();
    return request(app.config.apiUrl, "PUT", "/data/" + this._c + "/" + this._id, {
      clientKey: app.config.clientKey, idToken: s && s.idToken, body: { data: data }
    });
  };
  DocRef.prototype.update = function (data) {
    var app = this._app, s = this._session();
    return request(app.config.apiUrl, "PATCH", "/data/" + this._c + "/" + this._id, {
      clientKey: app.config.clientKey, idToken: s && s.idToken, body: { data: data }
    });
  };
  DocRef.prototype.delete = function () {
    var app = this._app, s = this._session();
    return request(app.config.apiUrl, "DELETE", "/data/" + this._c + "/" + this._id, {
      clientKey: app.config.clientKey, idToken: s && s.idToken
    });
  };

  function Data(app) { this._app = app; }
  Data.prototype.collection = function (name) { return new Collection(this._app, name); };

  // ------------------------------------------------ data.batch — ATOMIC multi-op
  // vx.data().batch().add("posts", {...}).set("posts", id, {...}).delete("posts", id2).commit()
  // ALL ops apply or NONE do (one server-side transaction).
  function Batch(app) { this._app = app; this._ops = []; }
  Batch.prototype.add = function (collection, data) { this._ops.push({ op: "add", collection: collection, data: data }); return this; };
  Batch.prototype.set = function (collection, docId, data) { this._ops.push({ op: "set", collection: collection, docId: docId, data: data }); return this; };
  Batch.prototype.update = function (collection, docId, data) { this._ops.push({ op: "update", collection: collection, docId: docId, data: data }); return this; };
  Batch.prototype.delete = function (collection, docId) { this._ops.push({ op: "delete", collection: collection, docId: docId }); return this; };
  Batch.prototype.commit = function () {
    var app = this._app, s = app.auth()._restore();
    return request(app.config.apiUrl, "POST", "/data/batch", {
      clientKey: app.config.clientKey, idToken: s && s.idToken, body: { ops: this._ops }
    });
  };
  Data.prototype.batch = function () { return new Batch(this._app); };

  // ---------------------------------------------------------- storage
  function Storage(app) { this._app = app; }
  Storage.prototype._session = function () { return this._app.auth()._restore(); };
  Storage.prototype.uploadBase64 = function (path, contentB64, mime) {
    var app = this._app, s = this._session();
    return request(app.config.apiUrl, "POST", "/storage/upload", {
      clientKey: app.config.clientKey, idToken: s && s.idToken,
      body: { path: path, contentB64: contentB64, mime: mime }
    }).then(function (r) { return r; });
  };
  Storage.prototype.uploadText = function (path, text, mime) {
    return this.uploadBase64(path, b64encode(text), mime || "text/plain");
  };
  Storage.prototype.uploadBlob = function (path, blob) {
    var app = this._app, s = this._session();
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var bytes = new Uint8Array(fr.result);
        var bin = "";
        for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        request(app.config.apiUrl, "POST", "/storage/upload", {
          clientKey: app.config.clientKey, idToken: s && s.idToken,
          body: { path: path, contentB64: btoa(bin), mime: blob.type || undefined }
        }).then(resolve, reject);
      };
      fr.onerror = reject;
      fr.readAsArrayBuffer(blob);
    });
  };
  Storage.prototype.download = function (path) {
    var app = this._app, s = this._session();
    return request(app.config.apiUrl, "GET", "/storage/file?path=" + encodeURIComponent(path), {
      clientKey: app.config.clientKey, idToken: s && s.idToken
    }).then(function (r) { return r; });
  };
  Storage.prototype.downloadUrl = function (path) {
    return this._app.config.apiUrl + "/storage/file?path=" + encodeURIComponent(path);
  };
  Storage.prototype.list = function () {
    var app = this._app, s = this._session();
    return request(app.config.apiUrl, "GET", "/storage/list", {
      clientKey: app.config.clientKey, idToken: s && s.idToken
    });
  };

  // ---------------------------------------------------------- realtime
  // v1.0: TRUE push over SSE (rt/stream) with auto-reconnect + offline replay.
  // Falls back to polling (rt/events) when EventSource is unavailable.
  function Realtime(app) {
    this._app = app;
    this._es = null;          // EventSource per channel-set
    this._pollTimers = {};
    this._channels = {};      // name → Channel
  }
  Realtime.prototype._emit = function (env) {
    var app = this._app;
    var ch = this._channels[env.channel];
    if (!ch) return;
    (ch._handlers[env.type] || []).forEach(function (h) { try { h(env.payload, env); } catch (e) {} });
    (ch._handlers["*"] || []).forEach(function (h) { try { h(env.payload, env); } catch (e) {} });
    (app.config.onEvent || null) && app.config.onEvent(env);
  };
  Realtime.prototype._openStream = function (names) {
    var rt = this, app = this._app;
    if (typeof EventSource === "undefined") return false;
    var url = app.config.apiUrl + "/rt/stream?channel=" + encodeURIComponent(names.join(",")) +
      "&key=" + encodeURIComponent(app.config.clientKey) +
      "&since=" + Date.now();
    var es = new EventSource(url);
    this._es = es;
    es.addEventListener("vx", function (ev) {
      try { rt._emit(JSON.parse(ev.data)); } catch (e) {}
    });
    es.addEventListener("ready", function (ev) {
      try { var info = JSON.parse(ev.data); rt._transport = "sse"; rt._clientId = info.clientId; } catch (e) {}
      names.forEach(function (n) {
        var ch = rt._channels[n];
        (ch && ch._onOpen || []).forEach(function (h) { try { h(info); } catch (e) {} });
      });
    });
    es.onerror = function () { /* EventSource auto-reconnects (server sent retry:3000) */ };
    return true;
  };
  Realtime.prototype._poll = function (name) {
    var rt = this, app = this._app;
    if (rt._pollTimers[name]) return;
    rt._transport = "polling";
    rt._pollTimers[name] = setInterval(function () {
      request(app.config.apiUrl, "GET", "/rt/events?channel=" + encodeURIComponent(name), {
        clientKey: app.config.clientKey
      }).then(function (r) {
        (r.events || []).forEach(function (ev) {
          rt._emit({ channel: ev.channel, type: ev.type, payload: JSON.parse(ev.payloadJson || "{}"), eventId: ev.eventId, at: ev.createdAt });
        });
      }).catch(function () {});
    }, 3000);
  };
  Realtime.prototype.channel = function (name) { return new Channel(this._app, name); };
  function Channel(app, name) {
    this._app = app; this._name = name; this._handlers = {};
    this._onOpen = [];
    app._realtime._channels[name] = this;
  }
  Channel.prototype.on = function (type, handler) {
    var channel = this, rt = this._app._realtime;
    this._handlers[type] = (this._handlers[type] || []).concat(handler);
    if (!rt._es && !rt._pollTimers[this._name]) {
      var names = Object.keys(rt._channels);
      if (!rt._openStream(names)) rt._poll(this._name); // SSE unavailable → polling fallback
    }
    return Promise.resolve(this);
  };
  Channel.prototype.onOpen = function (handler) { this._onOpen.push(handler); return this; };
  Channel.prototype.publish = function (type, payload) {
    var app = this._app, s = app.auth()._restore();
    return request(app.config.apiUrl, "POST", "/rt/publish", {
      clientKey: app.config.clientKey, idToken: s && s.idToken,
      body: { channel: this._name, type: type, payload: payload || {} }
    });
  };
  // Presence — who is online right now (SSE connect/disconnect auto-tracks it)
  Channel.prototype.online = function () {
    var app = this._app;
    return request(app.config.apiUrl, "GET", "/rt/presence?channel=" + encodeURIComponent(this._name), {
      clientKey: app.config.clientKey
    });
  };
  Channel.prototype.heartbeat = function () {
    var app = this._app, s = app.auth()._restore();
    return request(app.config.apiUrl, "POST", "/rt/presence", {
      clientKey: app.config.clientKey, idToken: s && s.idToken,
      body: { channel: this._name }
    });
  };

  // ---------------------------------------------------------- functions
  function Functions(app) { this._app = app; }
  Functions.prototype._session = function () { return this._app.auth()._restore(); };
  Functions.prototype.invoke = function (name, payload) {
    var app = this._app, s = this._session();
    return request(app.config.apiUrl, "POST", "/fn/" + encodeURIComponent(name) + "/invoke", {
      clientKey: app.config.clientKey, idToken: s && s.idToken, body: { payload: payload || {} }
    }).then(function (r) { return r; });
  };

  // ---------------------------------------------------------- Remote Config
  function RemoteConfig(app) { this._app = app; }
  RemoteConfig.prototype.fetch = function () {
    return request(this._app.config.apiUrl, "GET", "/config", {
      clientKey: this._app.config.clientKey
    }).then(function (r) { return r.config || {}; });
  };
  RemoteConfig.prototype.fetchWithVersion = function () {
    return request(this._app.config.apiUrl, "GET", "/config", {
      clientKey: this._app.config.clientKey
    });
  };

  // ---------------------------------------------------------- Analytics
  function Analytics(app) { this._app = app; }
  Analytics.prototype._session = function () { return this._app.auth()._restore(); };
  Analytics.prototype.log = function (name, params) {
    var app = this._app, s = this._session();
    return request(app.config.apiUrl, "POST", "/analytics/event", {
      clientKey: app.config.clientKey, idToken: s && s.idToken,
      body: { name: name, params: params || {} }
    });
  };

  // ---------------------------------------------------------- Crashlytics
  function Crash(app) {
    this._app = app;
    this._installed = false;
  }
  Crash.prototype.report = function (message, stack, appVersion, platform) {
    var app = this._app, s = app.auth()._restore();
    return request(app.config.apiUrl, "POST", "/crash/report", {
      clientKey: app.config.clientKey, idToken: s && s.idToken,
      body: { message: message, stack: stack || "", appVersion: appVersion || "", platform: platform || (typeof navigator !== "undefined" ? "web" : "web") }
    });
  };
  /** Auto-capture window.onerror + unhandledrejection (like Crashlytics). */
  Crash.prototype.install = function () {
    var app = this._app;
    if (this._installed || typeof window === "undefined") return this;
    this._installed = true;
    window.addEventListener("error", function (e) {
      try { app.crash().report(e.message, (e.error && e.error.stack) || "", "", "web"); } catch (x) {}
    });
    window.addEventListener("unhandledrejection", function (e) {
      try {
        var r = e.reason;
        app.crash().report(String(r && r.message || r), (r && r.stack) || "", "", "web");
      } catch (x) {}
    });
    return this;
  };

  // ---------------------------------------------------------- Push
  function Push(app) { this._app = app; }
  Push.prototype._session = function () { return this._app.auth()._restore(); };
  /** Register this device for pushes. token can be any stable client id. */
  Push.prototype.register = function (token, platform) {
    var app = this._app, s = this._session();
    return request(app.config.apiUrl, "POST", "/push/register", {
      clientKey: app.config.clientKey, idToken: s && s.idToken,
      body: { token: token, platform: platform || "web" }
    });
  };
  /** Listen for pushes on this device (opens an SSE stream on device:<token>). */
  Push.prototype.onMessage = function (token, handler) {
    var app = this._app;
    var ch = app._realtime.channel("device:" + token);
    ch.on("push", handler);
    ch.on("*", function (env) { if (env.type === "push") handler(env.payload, env); });
    return this;
  };

  // ---------------------------------------------------------- app
  function App(config) {
    this.config = {
      projectId: config.projectId,
      clientKey: config.clientKey,
      apiUrl: config.apiUrl || DEFAULT_API,
      onEvent: config.onEvent || null,
    };
    this._session = null;
    this._auth = new Auth(this);
    this._data = new Data(this);
    this._storage = new Storage(this);
    this._realtime = new Realtime(this);
    this._functions = new Functions(this);
    this._config = new RemoteConfig(this);
    this._analytics = new Analytics(this);
    this._crash = new Crash(this);
    this._push = new Push(this);
  }
  App.prototype.auth = function () { return this._auth; };
  App.prototype.data = function () { return this._data; };
  App.prototype.storage = function () { return this._storage; };
  App.prototype.realtime = function () { return this._realtime; };
  App.prototype.functions = function () { return this._functions; };
  App.prototype.config = function () { return this._config; };
  App.prototype.analytics = function () { return this._analytics; };
  App.prototype.crash = function () { return this._crash; };
  App.prototype.push = function () { return this._push; };
  App.prototype.health = function () {
    return request(this.config.apiUrl, "GET", "/health", { clientKey: this.config.clientKey });
  };

  // ---------------------------------------------------------- admin (firebase-admin counterpart)
  // Vortex.admin({ apiUrl, adminKey }) — vxa_… secret key NEVER ships to browsers.
  function AdminApp(cfg) {
    this._apiUrl = cfg.apiUrl || DEFAULT_API;
    this._adminKey = cfg.adminKey;
  }
  AdminApp.prototype._req = function (method, path, body) {
    return request(this._apiUrl, method, path, { adminKey: this._adminKey, body: body });
  };
  /** Push to all devices, one user (uid), or a channel subset. */
  AdminApp.prototype.push = function (title, body, opts) {
    opts = opts || {};
    return this._req("POST", "/push/send", { title: title, body: body, data: opts.data || {}, uid: opts.uid, channel: opts.channel });
  };
  /** Remote Config set — entries: [{key, value, valueType?, description?}] */
  AdminApp.prototype.configSet = function (entries) {
    return this._req("POST", "/config", { entries: entries });
  };
  AdminApp.prototype.configGet = function () {
    return this._req("GET", "/config");
  };
  AdminApp.prototype.analyticsSummary = function (days) {
    return this._req("GET", "/analytics/summary?days=" + (days || 7));
  };
  AdminApp.prototype.batch = function (ops) {
    return this._req("POST", "/data/batch", { ops: ops });
  };

  var apps = {};
  var Vortex = {
    initializeApp: function (config) {
      if (!config || !config.projectId || !config.clientKey) {
        throw VortexError("initializeApp needs projectId + clientKey");
      }
      var key = config.projectId + ":" + (config.apiUrl || DEFAULT_API);
      if (apps[key]) return apps[key];
      apps[key] = new App(config);
      return apps[key];
    },
    /** server-side admin surface (vxa_…) — firebase-admin counterpart */
    admin: function (cfg) {
      if (!cfg || !cfg.adminKey) throw VortexError("Vortex.admin needs adminKey (vxa_…)");
      return new AdminApp(cfg);
    },
    // developer console (optional, no project key)
    dev: {
      signUp: function (email, password, name, apiUrl) {
        return request(apiUrl || DEFAULT_API, "POST", "/dev/signup", { body: { email: email, password: password, name: name } });
      },
      signIn: function (email, password, apiUrl) {
        return request(apiUrl || DEFAULT_API, "POST", "/dev/login", { body: { email: email, password: password } });
      },
      me: function (token, apiUrl) {
        return fetch((apiUrl || DEFAULT_API) + "/dev/me", { headers: { Authorization: "Bearer " + token } }).then(function (r) { return r.json(); });
      },
    },
    version: "1.0.0",
  };

  global.Vortex = Vortex;
  if (typeof module !== "undefined" && module.exports) module.exports = Vortex;
})(typeof window !== "undefined" ? window : globalThis);
