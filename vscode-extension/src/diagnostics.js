function buildDiagnosticsReport({
  checkedAt = new Date(),
  diagnostics,
  protocolVersion,
  capabilities = [],
  tokenFingerprint,
  workspaceRoot,
  settings = {},
  target = {},
  resolvedPaths,
  pathError,
  metadataDiagnostics,
}) {
  const checkedAtMs = checkedAt.getTime();
  return [
    "=== LeetCode Helper Diagnostics ===",
    `Checked: ${checkedAt.toISOString()}`,
    `VS Code extension: ${diagnostics?.extensionVersion || "unknown"}`,
    `Bridge protocol: ${protocolVersion}`,
    `Capabilities: ${capabilities.join(", ") || "none"}`,
    `Bridge: ${diagnostics?.running ? "listening" : diagnostics?.conflict ? "waiting for port owner" : "stopped"}`,
    `Bridge port: ${diagnostics?.port ?? "unknown"}`,
    `Authentication: ${diagnostics?.authEnabled ? "enabled" : "disabled"}`,
    `Pairing token fingerprint: ${tokenFingerprint || "unavailable"}`,
    `Chrome polling: ${describeRecentActivity(diagnostics?.activity?.lastChromePollAt, checkedAtMs, 35000)}`,
    `Last automatic pairing: ${formatTimestamp(diagnostics?.activity?.lastAutoPairAt)}`,
    `Last authenticated request: ${formatTimestamp(diagnostics?.activity?.lastAuthorizedRequestAt)}`,
    `Last push result: ${formatTimestamp(diagnostics?.activity?.lastPushResultAt)}`,
    `Last rejected bridge request: ${formatRejected(diagnostics?.activity)}`,
    `Push jobs: ${diagnostics?.pushQueue?.activeJobs ?? 0} active, ${diagnostics?.pushQueue?.pendingJobs ?? 0} pending, ${diagnostics?.pushQueue?.acknowledgedJobs ?? 0} acknowledged, browser waiting=${Boolean(diagnostics?.pushQueue?.browserWaiting)}`,
    `Last push enqueued: ${formatTimestamp(diagnostics?.pushQueue?.lastEnqueuedAt)}`,
    `Last push acknowledged: ${formatTimestamp(diagnostics?.pushQueue?.lastAcknowledgedAt)}`,
    `Workspace: ${workspaceRoot || "none"}`,
    `Destination mode: ${settings.destinationMode || "workspace"}`,
    `Solution destination: ${resolvedPaths?.solutionRoot || pathError || "unavailable"}`,
    `Metadata destination: ${resolvedPaths?.metadataParent || pathError || "unavailable"}`,
    `Central metadata folder: ${metadataDiagnostics?.centralFolder || "unavailable"}`,
    `Metadata index: ${metadataDiagnostics?.indexSize ?? 0} files; last scan ${formatTimestamp(metadataDiagnostics?.lastScanAt)}`,
    `Metadata migrations: ${metadataDiagnostics?.migratedCount ?? 0}`,
    `Metadata issues: ${metadataDiagnostics?.invalidCount ?? 0} invalid, ${metadataDiagnostics?.unsupportedCount ?? 0} unsupported, ${metadataDiagnostics?.ambiguousCount ?? 0} ambiguous lookups`,
    `Last metadata lookup: ${formatMetadataLookup(metadataDiagnostics?.lastLookup)}`,
    `Active file: ${target.name || "none"}`,
    `Active file metadata: ${target.hasMeta ? "found" : "not found"}`,
    `Active solution language: ${target.language || "unknown"}`,
    "=== End Diagnostics ===",
  ];
}

function formatTimestamp(value) {
  return value ? new Date(value).toISOString() : "never";
}

function describeRecentActivity(value, now, healthyWindowMs) {
  if (!value) {
    return "not detected";
  }
  const ageMs = Math.max(0, now - value);
  return ageMs <= healthyWindowMs
    ? `connected (${Math.round(ageMs / 1000)}s ago)`
    : `stale (${Math.round(ageMs / 1000)}s ago)`;
}

function formatRejected(activity) {
  if (!activity?.lastRejectedAt) {
    return "none";
  }
  return `${activity.lastRejectedCode || "unknown"} at ${new Date(activity.lastRejectedAt).toISOString()}`;
}

function formatMetadataLookup(lookup) {
  if (!lookup) {
    return "never";
  }
  const source = lookup.source ? ` via ${lookup.source}` : "";
  const message = lookup.message ? ` (${lookup.message})` : "";
  return `${lookup.status}${source} at ${formatTimestamp(lookup.at)}${message}`;
}

module.exports = { buildDiagnosticsReport, describeRecentActivity, formatMetadataLookup, formatTimestamp };
