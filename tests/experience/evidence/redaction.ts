export type KnownSecret = string | Uint8Array;

export const REDACTED = "[REDACTED]";

const TOKEN_LIKE_KEY =
  /(token|secret|password|passwd|authorization|api.?key|cookie|credential)/i;
const PRIVATE_CARDS_KEY = /(private|hole)[_-]?cards?/i;

function normalizeSecrets(knownSecrets: readonly KnownSecret[]): string[] {
  return knownSecrets
    .map((secret) =>
      typeof secret === "string" ? secret : Buffer.from(secret).toString("utf8")
    )
    .filter((secret) => secret.length > 0)
    .sort((left, right) => right.length - left.length);
}

function replaceAll(value: string, target: string, replacement: string): string {
  return value.split(target).join(replacement);
}

function redactString(value: string, secrets: readonly string[]): string {
  let redacted = value;

  for (const secret of secrets) {
    redacted = replaceAll(redacted, secret, REDACTED);
    const encoded = encodeURIComponent(secret);
    if (encoded !== secret) {
      redacted = replaceAll(redacted, encoded, encodeURIComponent(REDACTED));
    }
  }

  redacted = redacted.replace(
    /\b((?:postgres(?:ql)?|redis(?:s)?):\/\/)([^@\s/]+)@/gi,
    "$1[REDACTED]:[REDACTED]@"
  );
  redacted = redacted.replace(
    /([?&](?:host|hostToken|participantToken|token)=)([^&#\s]*)/gi,
    "$1[REDACTED]"
  );
  redacted = redacted.replace(
    /\b(Bearer\s+)[^\s"',;]+/gi,
    "$1[REDACTED]"
  );
  redacted = redacted.replace(
    /(["']?(?:hostToken|participantToken|token|password|secret)["']?\s*[:=]\s*["']?)([^\s,"'&}]+)/gi,
    "$1[REDACTED]"
  );

  return redacted;
}

function privateCardSummary(value: unknown): {
  visible: boolean;
  cardCount: number;
} {
  const countCardArrays = (
    current: unknown,
    seen = new WeakSet<object>()
  ): number | undefined => {
    if (Array.isArray(current)) {
      return current.length;
    }
    if (!current || typeof current !== "object" || seen.has(current)) {
      return undefined;
    }
    seen.add(current);

    let foundArray = false;
    let cardCount = 0;
    for (const nested of Object.values(current)) {
      const nestedCount = countCardArrays(nested, seen);
      if (nestedCount !== undefined) {
        foundArray = true;
        cardCount += nestedCount;
      }
    }
    return foundArray ? cardCount : undefined;
  };

  const concreteCardCount = countCardArrays(value);
  if (concreteCardCount !== undefined) {
    return {
      visible: concreteCardCount > 0,
      cardCount: concreteCardCount
    };
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const cardCount =
      typeof record.cardCount === "number" ? record.cardCount : 0;
    const visible =
      typeof record.visible === "boolean" ? record.visible : cardCount > 0;
    return { visible, cardCount };
  }

  return { visible: false, cardCount: 0 };
}

/** Returns a JSON-safe copy suitable for durable evidence. */
export function redactForEvidence(
  value: unknown,
  knownSecrets: readonly KnownSecret[] = []
): unknown {
  const secrets = normalizeSecrets(knownSecrets);
  const seen = new WeakSet<object>();

  const visit = (current: unknown): unknown => {
    if (typeof current === "string") {
      const trimmed = current.trim();
      if (
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))
      ) {
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          if (parsed !== null && typeof parsed === "object") {
            return JSON.stringify(visit(parsed));
          }
        } catch {
          // Preserve non-JSON diagnostic strings and apply scalar redaction.
        }
      }
      return redactString(current, secrets);
    }
    if (
      current === null ||
      typeof current === "number" ||
      typeof current === "boolean" ||
      typeof current === "undefined"
    ) {
      return current;
    }
    if (current instanceof Date) {
      return current.toISOString();
    }
    if (current instanceof Uint8Array) {
      return redactString(Buffer.from(current).toString("utf8"), secrets);
    }
    if (typeof current === "object") {
      if (seen.has(current)) {
        return "[Circular]";
      }
      seen.add(current);

      if (Array.isArray(current)) {
        const result = current.map(visit);
        seen.delete(current);
        return result;
      }

      const redacted: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(current)) {
        if (TOKEN_LIKE_KEY.test(key)) {
          redacted[key] = REDACTED;
        } else if (PRIVATE_CARDS_KEY.test(key)) {
          redacted[key] = privateCardSummary(nested);
        } else {
          redacted[key] = visit(nested);
        }
      }
      seen.delete(current);
      return redacted;
    }

    return redactString(String(current), secrets);
  };

  return visit(value);
}
