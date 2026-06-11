// =====================================================================
// Two separate configs:
//   1) workflow    — pure business config (matches pgr-workflow-config.json)
//   2) layout      — pure visual config (positions, sizes, side hints)
// =====================================================================

export const SEED_USERS = [
  { id: "u_anika",  name: "Anika Shah",    role: "GRO" },
  { id: "u_dmitri", name: "Dmitri Volkov", role: "PGR_LME" },
  { id: "u_priya",  name: "Priya Narang",  role: "SUPERVISOR" },
  { id: "u_mei",    name: "Mei Lin",       role: "CSR" },
  { id: "u_jordan", name: "Jordan Okafor", role: "CFC" },
  { id: "u_sergio", name: "Sergio Russo",  role: "PGR_VIEWER" },
];

export const SEED_WORKFLOW = {
  businessService: "PGR",
  business: "pgr-services",
  businessServiceSla: 432000000,
  states: [
    { state: null, applicationStatus: null, isStartState: true, isTerminateState: false,
      actions: [{ action: "APPLY", nextState: "PENDINGFORASSIGNMENT", roles: ["CITIZEN","CSR"] }] },
    { state: "PENDINGFORASSIGNMENT", applicationStatus: "PENDINGFORASSIGNMENT",
      isStartState: false, isTerminateState: false, actions: [
        { action: "ASSIGN",                   nextState: "PENDINGATLME",           roles: ["GRO","PGR_VIEWER"] },
        { action: "REJECT",                   nextState: "REJECTED",               roles: ["GRO","PGR_VIEWER"] },
        { action: "ESCALATE",                 nextState: "PENDINGFORASSIGNMENT",   roles: ["GRO","AUTO_ESCALATE","PGR_VIEWER"] },
        { action: "ASSIGNEDBYAUTOESCALATION", nextState: "PENDINGATLME",           roles: ["AUTO_ESCALATE"] },
        { action: "COMMENT",                  nextState: "PENDINGFORASSIGNMENT",   roles: ["CITIZEN"] },
      ] },
    { state: "PENDINGFORREASSIGNMENT", applicationStatus: "PENDINGFORREASSIGNMENT",
      isStartState: false, isTerminateState: false, actions: [
        { action: "COMMENT", nextState: "PENDINGFORREASSIGNMENT", roles: ["CITIZEN"] },
        { action: "REJECT",  nextState: "REJECTED",               roles: ["GRO","PGR_VIEWER"] },
        { action: "ASSIGN",  nextState: "PENDINGATLME",           roles: ["GRO","PGR_VIEWER"] },
      ] },
    { state: "PENDINGATLME", applicationStatus: "PENDINGATLME",
      isStartState: false, isTerminateState: false, actions: [
        { action: "RESOLVE",  nextState: "RESOLVED",                 roles: ["PGR_LME","PGR_VIEWER"] },
        { action: "FORWARD",  nextState: "PENDINGATSUPERVISOR",      roles: ["AUTO_ESCALATE"] },
        { action: "REASSIGN", nextState: "PENDINGFORREASSIGNMENT",   roles: ["PGR_LME","PGR_VIEWER"] },
        { action: "COMMENT",  nextState: "PENDINGATLME",             roles: ["CITIZEN"] },
        { action: "ESCALATE", nextState: "PENDINGATLME",             roles: ["GRO","PGR_LME","AUTO_ESCALATE","PGR_VIEWER"] },
      ] },
    { state: "PENDINGATSUPERVISOR", applicationStatus: "PENDINGATSUPERVISOR",
      isStartState: false, isTerminateState: false, actions: [
        { action: "RESOLVEBYSUPERVISOR", nextState: "RESOLVED", roles: ["SUPERVISOR"] },
      ] },
    { state: "REJECTED", applicationStatus: "REJECTED",
      isStartState: false, isTerminateState: true, actions: [
        { action: "RATE",    nextState: "CLOSEDAFTERREJECTION", roles: ["CFC","CITIZEN"] },
        { action: "COMMENT", nextState: "REJECTED",             roles: ["CITIZEN"] },
        { action: "REOPEN",  nextState: "PENDINGFORASSIGNMENT", roles: ["CFC","CITIZEN","CSR","PGR_VIEWER"] },
      ] },
    { state: "RESOLVED", applicationStatus: "RESOLVED",
      isStartState: false, isTerminateState: true, actions: [
        { action: "REOPEN",  nextState: "PENDINGFORASSIGNMENT",  roles: ["CFC","CITIZEN","CSR","PGR_VIEWER"] },
        { action: "COMMENT", nextState: "RESOLVED",              roles: ["CITIZEN"] },
        { action: "RATE",    nextState: "CLOSEDAFTERRESOLUTION", roles: ["CFC","CITIZEN"] },
      ] },
    { state: "CLOSEDAFTERREJECTION",  applicationStatus: "CLOSEDAFTERREJECTION",  isStartState: false, isTerminateState: true, actions: [] },
    { state: "CLOSEDAFTERRESOLUTION", applicationStatus: "CLOSEDAFTERRESOLUTION", isStartState: false, isTerminateState: true, actions: [] },
    { state: "RESOLVEDBYSUPERVISOR",  applicationStatus: "RESOLVEDBYSUPERVISOR",  isStartState: false, isTerminateState: true, actions: [] },
    { state: "CANCELLED",             applicationStatus: "CANCELLED",             isStartState: false, isTerminateState: true, actions: [] },
  ],
};

// Visual layout — spaced out grid so nothing overlaps.
// Columns: col0=120, col1=480, col2=860, col3=1260, col4=1640
// Rows:    r0=140, r1=340, r2=560, r3=780, r4=1000
export const SEED_LAYOUT = {
  canvas: { width: 1900, height: 1200, grid: 12 },
  states: {
    "__start__":              { x: 480,  y: 140, r: 18 },
    "PENDINGFORASSIGNMENT":   { x: 480,  y: 340, w: 280, h: 56 },
    "PENDINGFORREASSIGNMENT": { x: 120,  y: 780, w: 280, h: 56 },
    "PENDINGATLME":           { x: 860,  y: 560, w: 280, h: 56 },
    "PENDINGATSUPERVISOR":    { x: 1260, y: 340, w: 280, h: 56 },
    "RESOLVED":               { x: 1260, y: 560, w: 280, h: 56 },
    "REJECTED":               { x: 480,  y: 780, w: 280, h: 56 },
    "CLOSEDAFTERRESOLUTION":  { x: 1640, y: 560, w: 280, h: 56 },
    "CLOSEDAFTERREJECTION":   { x: 480,  y: 1000, w: 280, h: 56 },
    "RESOLVEDBYSUPERVISOR":   { x: 1640, y: 340, w: 280, h: 56 },
    "CANCELLED":              { x: 1640, y: 1000, w: 280, h: 56 },
  },
  actions: {
    "__start__::APPLY":                               { x: 480,  y: 235 },
    "PENDINGFORASSIGNMENT::ASSIGN":                   { x: 670,  y: 450 },
    "PENDINGFORASSIGNMENT::REJECT":                   { x: 395,  y: 560 },
    "PENDINGFORASSIGNMENT::ESCALATE":                 { x: 270,  y: 340, side: "left" },
    "PENDINGFORASSIGNMENT::ASSIGNEDBYAUTOESCALATION": { x: 770,  y: 360 },
    "PENDINGFORASSIGNMENT::COMMENT":                  { x: 690,  y: 340, side: "right" },

    "PENDINGFORREASSIGNMENT::COMMENT":                { x: 120,  y: 990, side: "left" },
    "PENDINGFORREASSIGNMENT::REJECT":                 { x: 310,  y: 780 },
    "PENDINGFORREASSIGNMENT::ASSIGN":                 { x: 480,  y: 670 },

    "PENDINGATLME::RESOLVE":                          { x: 1070, y: 560 },
    "PENDINGATLME::FORWARD":                          { x: 1070, y: 440 },
    "PENDINGATLME::REASSIGN":                         { x: 500,  y: 560 },
    "PENDINGATLME::COMMENT":                          { x: 1080, y: 670, side: "right" },
    "PENDINGATLME::ESCALATE":                         { x: 640,  y: 560, side: "left" },

    "PENDINGATSUPERVISOR::RESOLVEBYSUPERVISOR":       { x: 1260, y: 450 },

    "REJECTED::RATE":                                 { x: 480,  y: 890 },
    "REJECTED::COMMENT":                              { x: 700,  y: 780, side: "right" },
    "REJECTED::REOPEN":                               { x: 240,  y: 560 },

    "RESOLVED::REOPEN":                               { x: 860,  y: 450 },
    "RESOLVED::COMMENT":                              { x: 1480, y: 670, side: "right" },
    "RESOLVED::RATE":                                 { x: 1480, y: 560 },
  },
};

export const ROLE_OPTIONS = ["CITIZEN","CSR","GRO","PGR_LME","PGR_VIEWER","SUPERVISOR","CFC","AUTO_ESCALATE","EMPLOYEE"];

export const FORM_SCHEMAS = {
  state: {
    title: "State",
    properties: {
      state: { type: "string", title: "State name", required: true,
        help: "Unique identifier. Convention: UPPERCASE. e.g. PENDINGATLME" },
      applicationStatus: { type: "string", title: "Application status",
        help: "Usually mirrors the state name; shown to end users." },
      isStartState:     { type: "boolean", title: "Start state" },
      isTerminateState: { type: "boolean", title: "Terminal state" },
      sla: { type: "duration", title: "SLA (optional)" },
      notes: { type: "text", title: "Internal notes" },
    },
    order: ["state","applicationStatus","isStartState","isTerminateState","sla","notes"],
  },
  action: {
    title: "Action",
    properties: {
      action: { type: "string", title: "Action name", required: true,
        help: "Uppercase verb. e.g. ASSIGN, RESOLVE, REOPEN." },
      nextState: { type: "string", title: "Next state", required: true, enum: [] },
      roles: { type: "multi", title: "Allowed roles", options: ROLE_OPTIONS },
      kind: { type: "string", title: "Action kind",
        enum: ["user","system","auto","comment"],
        help: "Visual category — used for color coding." },
      auditLog: { type: "boolean", title: "Record to audit log" },
      notifyAssignee: { type: "boolean", title: "Notify assignee" },
      assignee: { type: "assignee", title: "Default assignee" },
      effectiveFrom: { type: "datetime", title: "Effective from" },
      description: { type: "text", title: "Description" },
    },
    order: ["action","nextState","roles","kind","auditLog","notifyAssignee","assignee","effectiveFrom","description"],
  },
};

export const DEFAULTS = {
  state: { state: "", applicationStatus: "", isStartState: false, isTerminateState: false, sla: null, notes: "" },
  action: { action: "", nextState: "", roles: [], kind: "user", auditLog: true, notifyAssignee: false, assignee: null, effectiveFrom: "", description: "" },
};

export function classifyAction(a) {
  if (a.kind) return a.kind;
  if (a.action === "COMMENT") return "comment";
  if (a.roles?.includes("AUTO_ESCALATE") && a.roles.length === 1) return "auto";
  if (a.action === "ESCALATE") return "auto";
  return "user";
}

export function kindOf(sel) {
  if (!sel) return null;
  if (sel.type === "state" || sel.type === "start") return "state";
  if (sel.type === "action") return "action";
  return null;
}

export function stateKey(s) { return s.isStartState ? "__start__" : s.state; }
export function actionKey(fromStateKey, actionName) { return `${fromStateKey}::${actionName}`; }
