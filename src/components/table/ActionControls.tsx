const FALLBACK_ACTIONS = ["Fold", "Check / Call", "Raise", "All in"];

export function ActionControls({ legalActions }: { legalActions?: unknown }) {
  const actions = readActionLabels(legalActions);
  const labels = actions.length > 0 ? actions : FALLBACK_ACTIONS;

  return (
    <section className="action-dock" aria-label="Actions">
      <div className="action-grid">
        {labels.map((label) => (
          <button type="button" key={label}>
            {label}
          </button>
        ))}
      </div>
      <div className="raise-strip" aria-label="Raise presets">
        <button type="button">1/2 pot</button>
        <button type="button">Pot</button>
        <button type="button">Max</button>
      </div>
    </section>
  );
}

function readActionLabels(legalActions: unknown): string[] {
  const actions = Array.isArray(legalActions)
    ? legalActions
    : typeof legalActions === "object" && legalActions !== null && "actions" in legalActions
    ? (legalActions as { actions: unknown }).actions
    : null;

  if (!Array.isArray(actions)) {
    return [];
  }

  return actions.flatMap((action) => {
    if (typeof action !== "object" || action === null || !("type" in action)) {
      return [];
    }

    const type = (action as { type: unknown }).type;
    return typeof type === "string" ? [formatAction(type)] : [];
  });
}

function formatAction(type: string): string {
  switch (type) {
    case "all-in":
      return "All in";
    case "call":
      return "Call";
    case "check":
      return "Check";
    case "raise":
      return "Raise";
    case "bet":
      return "Bet";
    case "fold":
      return "Fold";
    default:
      return type;
  }
}
