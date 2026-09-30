// Job folders: one folder per job inside JOBS_FOLDER_ID, named the way the office names them.

function listJobs_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get("jobs");
  if (hit) return JSON.parse(hit);
  var rootId = setting_("JOBS_FOLDER_ID");
  if (!rootId) throw new Error("Set JOBS_FOLDER_ID in Script properties to the folder that holds your job folders.");
  var jobs = [];
  var it = DriveApp.getFolderById(rootId).getFolders();
  while (it.hasNext()) {
    var f = it.next();
    jobs.push({ id: f.getId(), name: f.getName().trim() });
  }
  jobs.sort(function (a, b) { return a.name.localeCompare(b.name); });
  cache.put("jobs", JSON.stringify(jobs), 600);
  return jobs;
}

function jobById_(id) {
  if (String(id).indexOf("new:") === 0) return newJobFolder_(String(id).slice(4));
  var job = listJobs_().filter(function (j) { return j.id === id; })[0];
  if (!job) throw new Error("That job folder no longer exists. Refresh and pick the job again.");
  return job;
}

/** Find or create a nested subfolder, e.g. "Project Management/Change Orders". Matches names case-insensitively. */
function ensureFolderPath_(parent, path) {
  var folder = parent;
  String(path).split("/").map(function (s) { return s.trim(); }).filter(String).forEach(function (name) {
    var found = null;
    var it = folder.getFolders();
    while (it.hasNext() && !found) {
      var f = it.next();
      if (f.getName().trim().toLowerCase() === name.toLowerCase()) found = f;
    }
    folder = found || folder.createFolder(name);
  });
  return folder;
}

/** Names of existing change orders in a job, used for numbering (files and folders). */
function existingChangeOrderNames_(coFolder) {
  var names = [];
  var fi = coFolder.getFiles();
  while (fi.hasNext()) names.push(fi.next().getName());
  var di = coFolder.getFolders();
  while (di.hasNext()) names.push(di.next().getName());
  return names;
}

/** A job read off a receipt that has no folder yet: use a folder with that name, or make one. */
function newJobFolder_(name) {
  name = String(name).trim().replace(/[\\/]+/g, "-").slice(0, 120);
  if (!name) throw new Error("Pick the job first.");
  var same = listJobs_().filter(function (j) { return j.name.toLowerCase() === name.toLowerCase(); })[0];
  if (same) return same;
  var f = DriveApp.getFolderById(setting_("JOBS_FOLDER_ID")).createFolder(name);
  CacheService.getScriptCache().remove("jobs");
  return { id: f.getId(), name: name };
}
