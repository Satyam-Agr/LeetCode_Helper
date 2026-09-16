const test = require("node:test");
const assert = require("node:assert/strict");

const { buildDiagnosticsReport, describeRecentActivity } = require("../src/diagnostics");
const { BRIDGE_PROTOCOL_VERSION } = require("../src/protocol");

test("diagnostics report distinguishes a healthy paired browser connection", () => {
  const checkedAt = new Date("2026-09-15T10:00:00.000Z");
  const lines = buildDiagnosticsReport({
    checkedAt,
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    capabilities: ["language-guard", "token-auth"],
    tokenFingerprint: "abcdef123456",
    diagnostics: {
      running: true,
      port: 8765,
      extensionVersion: "1.0.0",
      authEnabled: true,
      activity: {
        lastChromePollAt: checkedAt.getTime() - 4000,
        lastAutoPairAt: checkedAt.getTime() - 3500,
        lastAuthorizedRequestAt: checkedAt.getTime() - 3000,
      },
      pushQueue: { activeJobs: 1, pendingJobs: 0, acknowledgedJobs: 1, browserWaiting: true },
    },
    workspaceRoot: "C:\\work",
    settings: { destinationMode: "workspace" },
    target: { name: "two-sum.cpp", hasMeta: true, language: "cpp" },
    resolvedPaths: { solutionRoot: "C:\\work", metadataParent: "C:\\work" },
  });

  const report = lines.join("\n");
  assert.match(report, /Bridge: listening/);
  assert.match(report, /Authentication: enabled/);
  assert.match(report, /Chrome polling: connected \(4s ago\)/);
  assert.match(report, /Last automatic pairing: 2026-09-15T09:59:56.500Z/);
  assert.match(report, /1 active, 0 pending, 1 acknowledged/);
  assert.match(report, /Active solution language: cpp/);
  assert.doesNotMatch(report, /pairing token(?! fingerprint)/i);
});

test("diagnostics report exposes stale polling and path errors", () => {
  const checkedAt = new Date("2026-09-15T10:00:00.000Z");
  const lines = buildDiagnosticsReport({
    checkedAt,
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    diagnostics: {
      conflict: true,
      port: 8765,
      authEnabled: true,
      activity: {
        lastChromePollAt: checkedAt.getTime() - 70000,
        lastRejectedAt: checkedAt.getTime() - 1000,
        lastRejectedCode: "pairing_required",
      },
      pushQueue: {},
    },
    pathError: "No workspace is open.",
  });

  const report = lines.join("\n");
  assert.match(report, /Bridge: waiting for port owner/);
  assert.match(report, /Chrome polling: stale \(70s ago\)/);
  assert.match(report, /pairing_required/);
  assert.match(report, /Solution destination: No workspace is open\./);
});

test("recent activity boundary is reported consistently", () => {
  assert.equal(describeRecentActivity(null, 1000, 100), "not detected");
  assert.equal(describeRecentActivity(900, 1000, 100), "connected (0s ago)");
  assert.equal(describeRecentActivity(899, 1000, 100), "stale (0s ago)");
});
