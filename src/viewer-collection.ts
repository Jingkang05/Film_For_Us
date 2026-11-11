// The selection remains the source of truth. Only new prints need the developing tray.
export function viewerCollection(selected: readonly string[], ready: ReadonlySet<string>) {
  return {
    hung: selected.filter(id => ready.has(id)),
    pending: selected.filter(id => !ready.has(id)),
  };
}
