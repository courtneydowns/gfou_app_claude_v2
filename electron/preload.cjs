"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  scenes: {
    getAll:      ()      => ipcRenderer.invoke("scenes:getAll"),
    getById:     (id)    => ipcRenderer.invoke("scenes:getById", id),
    upsert:      (s)     => ipcRenderer.invoke("scenes:upsert", s),
    archive:     (id)    => ipcRenderer.invoke("scenes:archive", id),
    delete:      (id)    => ipcRenderer.invoke("scenes:delete", id),
    importBatch: (list)  => ipcRenderer.invoke("scenes:importBatch", list),
  },
  drafts: {
    get:          (id)       => ipcRenderer.invoke("drafts:get", id),
    save:         (id, text) => ipcRenderer.invoke("drafts:save", id, text),
    clear:        (id)       => ipcRenderer.invoke("drafts:clear", id),
    getAll:       ()         => ipcRenderer.invoke("drafts:getAll"),
    snapshot:     (id, lbl)  => ipcRenderer.invoke("drafts:snapshot", id, lbl),
    getSnapshots: (id)       => ipcRenderer.invoke("drafts:getSnapshots", id),
  },
  backups: {
    createManual: ()    => ipcRenderer.invoke("backups:createManual"),
    list:         ()    => ipcRenderer.invoke("backups:list"),
    restore:      (fn)  => ipcRenderer.invoke("backups:restore", fn),
    getPaths:     ()    => ipcRenderer.invoke("backups:getPaths"),
  },
  exports: {
    panicExport: ()    => ipcRenderer.invoke("exports:panicExport"),
    exportScene: (id)  => ipcRenderer.invoke("exports:exportScene", id),
    listExports: ()    => ipcRenderer.invoke("exports:listExports"),
  },
  analysis: {
    saveResult:  (r)   => ipcRenderer.invoke("analysis:saveResult", r),
    getForScene: (id)  => ipcRenderer.invoke("analysis:getForScene", id),
    getAll:      ()    => ipcRenderer.invoke("analysis:getAll"),
  },
  sourceMaterial: {
    getAll:       ()        => ipcRenderer.invoke("sourceMaterial:getAll"),
    getForScene:  (sceneId) => ipcRenderer.invoke("sourceMaterial:getForScene", sceneId),
    upsert:       (item)    => ipcRenderer.invoke("sourceMaterial:upsert", item),
    delete:       (id)      => ipcRenderer.invoke("sourceMaterial:delete", id),
  },
  rules: {
    getAll:      ()         => ipcRenderer.invoke("rules:getAll"),
    getForScene: (sceneId)  => ipcRenderer.invoke("rules:getForScene", sceneId),
    upsert:      (r)        => ipcRenderer.invoke("rules:upsert", r),
    delete:      (id)       => ipcRenderer.invoke("rules:delete", id),
  },
  continuity: {
    getAll:      ()      => ipcRenderer.invoke("continuity:getAll"),
    addEntry:    (entry) => ipcRenderer.invoke("continuity:addEntry", entry),
    deleteEntry: (id)    => ipcRenderer.invoke("continuity:deleteEntry", id),
  },
  sessions: {
    start:       (sceneId)             => ipcRenderer.invoke("sessions:start", sceneId),
    end:         (sid, words, findings)=> ipcRenderer.invoke("sessions:end", sid, words, findings),
    getForScene: (sceneId)             => ipcRenderer.invoke("sessions:getForScene", sceneId),
  },
  revisionQueue: {
    getAll:  ()     => ipcRenderer.invoke("revisionQueue:getAll"),
    add:     (item) => ipcRenderer.invoke("revisionQueue:add", item),
    resolve: (id)   => ipcRenderer.invoke("revisionQueue:resolve", id),
  },
  app: {
    getDataPath:    () => ipcRenderer.invoke("app:getDataPath"),
    openDataFolder: () => ipcRenderer.invoke("app:openDataFolder"),
  },
});
