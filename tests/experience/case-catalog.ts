import {
  ExperienceCaseManifestSchema,
  type ExperienceCaseManifest
} from "./evidence/contracts";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

const manifests: ExperienceCaseManifest[] = ExperienceCaseManifestSchema.array()
  .length(10)
  .parse([
    {
      schemaVersion: "1.0",
      caseId: "EXP-001",
      objective: "Create a room and prove host, player, and spectator authority boundaries.",
      entrypoint: "/create",
      fixture: {
        description: "Fresh cash room with one host, one player, and one spectator.",
        expectedFacts: [
          "The host and invite URLs are distinct.",
          "Only the host identity can use host controls.",
          "A spectator has no participant authority."
        ]
      },
      assertions: [
        {
          id: "EXP-001-A01",
          description: "Room creation exposes distinct invite and host links."
        },
        {
          id: "EXP-001-A02",
          description: "Player and spectator joins receive only their declared roles."
        },
        {
          id: "EXP-001-A03",
          description: "Host-only controls are visible and effective only for the host."
        },
        {
          id: "EXP-001-A04",
          description: "Forged host or participant authority is rejected without state mutation."
        }
      ],
      forbiddenOutcomes: [
        "A host or participant credential appears in evidence.",
        "A non-host changes host-controlled room state."
      ],
      acceptableAlternatives: [
        "Copy-link feedback may use a toast or an inline confirmation."
      ],
      stopConditions: {
        overallTimeoutMs: 60_000,
        noProgressTimeoutMs: 10_000
      }
    },
    {
      schemaVersion: "1.0",
      caseId: "EXP-002",
      objective: "Prove seating layouts and blocked-start guidance are immediately understandable.",
      entrypoint: "/room/:roomId",
      fixture: {
        description: "Fresh 2-, 6-, and 9-seat rooms with funded and empty seats.",
        expectedFacts: [
          "Seat order is stable at every supported table size.",
          "The local occupied seat is bottom-centered.",
          "One funded player is insufficient to start."
        ]
      },
      assertions: [
        {
          id: "EXP-002-A01",
          description: "The 2-, 6-, and 9-seat layouts preserve seat order and readable occupancy."
        },
        {
          id: "EXP-002-A02",
          description: "The local seat is bottom-most and horizontally within 10% of table center."
        },
        {
          id: "EXP-002-A03",
          description: "Start is disabled with one funded player and explains that two are required."
        }
      ],
      forbiddenOutcomes: [
        "Occupied or empty seats overlap or become ambiguous.",
        "A one-player room can start a hand."
      ],
      acceptableAlternatives: [
        "The blocked-start explanation may be inline or attached to the disabled control."
      ],
      stopConditions: {
        overallTimeoutMs: 90_000,
        noProgressTimeoutMs: 10_000
      }
    },
    {
      schemaVersion: "1.0",
      caseId: "EXP-003",
      objective: "Complete a normal betting hand with prompt local feedback and converged actor views.",
      entrypoint: "/room/:roomId",
      fixture: {
        description: "Three-player normal-betting fixture with an exact four-street action plan.",
        path: "tests/experience/fixtures/normal-betting",
        expectedFacts: [
          "The exact action plan is call, call, check; check, bet 20, raise to 40, fold, call; check, check; bet 20, call.",
          "Each transition declares actor, street, pot, board length, and legal actions.",
          "All views begin from the same deterministic deck and stacks."
        ]
      },
      assertions: [
        {
          id: "EXP-003-A01",
          description: "The declared preflop-through-river action plan completes in order."
        },
        {
          id: "EXP-003-A02",
          description: "Every action produces local or authoritative feedback within 800ms."
        },
        {
          id: "EXP-003-A03",
          description: "All views converge on hand, street, board, pot, actor, and commitments within 1000ms."
        },
        {
          id: "EXP-003-A04",
          description: "Only context-valid primary betting actions are enabled."
        },
        {
          id: "EXP-003-A05",
          description: "No unexplained dead state persists longer than 3000ms."
        }
      ],
      forbiddenOutcomes: [
        "Actor views remain divergent after the convergence deadline.",
        "An invalid primary action is enabled.",
        "A future or private card is exposed."
      ],
      acceptableAlternatives: [
        "Equivalent call and check labels may include the exact chip amount."
      ],
      stopConditions: {
        overallTimeoutMs: 120_000,
        noProgressTimeoutMs: 3_000
      }
    },
    {
      schemaVersion: "1.0",
      caseId: "EXP-004",
      objective: "Prove the four-player all-in runout is cinematic, sequential, and settled only at the end.",
      entrypoint: "/room/:roomId",
      fixture: {
        description: "Tournament four-player preflop all-in with fixed aces, kings, queens, jacks, and board.",
        path: "tests/experience/fixtures/four-player-all-in",
        expectedFacts: [
          "All four live hands appear before the remaining board.",
          "The board grows by one card per reveal.",
          "Settlement follows the fifth community card."
        ]
      },
      assertions: [
        {
          id: "EXP-004-A01",
          description: "Showdown reveals all live hands before any remaining community card."
        },
        {
          id: "EXP-004-A02",
          description: "Board length increases by exactly one in each rendered reveal frame."
        },
        {
          id: "EXP-004-A03",
          description: "Presentation intervals are 2000, 1000, 1000, 2000, and 2000ms within ±400ms."
        },
        {
          id: "EXP-004-A04",
          description: "No player action remains enabled during the runout."
        },
        {
          id: "EXP-004-A05",
          description: "Winner highlighting and collection occur only after five board cards."
        }
      ],
      forbiddenOutcomes: [
        "Multiple remaining board cards appear in one rendered frame.",
        "Settlement or chip collection begins before the full board.",
        "A betting action is accepted during presentation."
      ],
      acceptableAlternatives: [
        "Winner emphasis may use glow, outline, or an equivalent visible treatment."
      ],
      stopConditions: {
        overallTimeoutMs: 90_000,
        noProgressTimeoutMs: 3_000
      }
    },
    {
      schemaVersion: "1.0",
      caseId: "EXP-005",
      objective: "Prove main-pot, side-pot, split-pot, award, and conservation accounting.",
      entrypoint: "/room/:roomId",
      fixture: {
        description: "Unequal-stack side-pot fixture plus a board-made split-pot fixture.",
        path: "tests/experience/fixtures/side-pot-and-split-pot",
        expectedFacts: [
          "Stacks 100/200/300/300 create pots 400/300/200.",
          "The side-pot winners receive 400, 300, and 200 respectively.",
          "A board-made straight splits a 200 pot into 100/100."
        ]
      },
      assertions: [
        {
          id: "EXP-005-A01",
          description: "Visible main and side pots equal the independent 400/300/200 oracle."
        },
        {
          id: "EXP-005-A02",
          description: "The eligible aces, kings, and queens winners receive 400, 300, and 200."
        },
        {
          id: "EXP-005-A03",
          description: "A folded player receives zero from every pot."
        },
        {
          id: "EXP-005-A04",
          description: "The split fixture visibly awards 100/100 from its 200 pot."
        },
        {
          id: "EXP-005-A05",
          description: "Ending stacks conserve all chips except explicitly recorded top-ups."
        }
      ],
      forbiddenOutcomes: [
        "An ineligible or folded player receives an award.",
        "A visible award differs from the fixture oracle.",
        "Chips are created or lost without a recorded top-up."
      ],
      acceptableAlternatives: [
        "Multiple side pots may be listed separately or in a grouped pot breakdown."
      ],
      stopConditions: {
        overallTimeoutMs: 120_000,
        noProgressTimeoutMs: 10_000
      }
    },
    {
      schemaVersion: "1.0",
      caseId: "EXP-006",
      objective: "Prove multiple queued top-ups accumulate and apply exactly once at the next hand boundary.",
      entrypoint: "/room/:roomId",
      fixture: {
        description: "Live cash hand with chips remaining and two queued top-ups of 300 and 200.",
        path: "tests/experience/fixtures/top-up-accounting",
        expectedFacts: [
          "The current-hand stack is unchanged by queued top-ups.",
          "The pending total becomes 500.",
          "Exactly 500 applies at the next hand boundary."
        ]
      },
      assertions: [
        {
          id: "EXP-006-A01",
          description: "The persistent lower-left add-chips control works while chips remain."
        },
        {
          id: "EXP-006-A02",
          description: "Submitting 300 then 200 displays a local cumulative Pending +500."
        },
        {
          id: "EXP-006-A03",
          description: "All room views receive one notification for each submission."
        },
        {
          id: "EXP-006-A04",
          description: "The current-hand stack does not change before the hand boundary."
        },
        {
          id: "EXP-006-A05",
          description: "The next hand applies exactly 500 once and clears the pending amount."
        }
      ],
      forbiddenOutcomes: [
        "Queued chips alter the current-hand stack.",
        "A submission is lost, duplicated, or applied more than once."
      ],
      acceptableAlternatives: [
        "Top-up notifications may be toasts or table timeline entries if every view sees them."
      ],
      stopConditions: {
        overallTimeoutMs: 120_000,
        noProgressTimeoutMs: 10_000
      }
    },
    {
      schemaVersion: "1.0",
      caseId: "EXP-007",
      objective: "Prove per-hand and final session accounting remain complete, timed, and reconcilable.",
      entrypoint: "/room/:roomId",
      fixture: {
        description: "Accounting fixture with known initial stacks, applied top-ups, and final balances.",
        path: "tests/experience/fixtures/top-up-accounting",
        expectedFacts: [
          "Every participant has known initial, per-hand, and final values.",
          "A final-hand request occurs during live betting.",
          "Net equals final minus initial minus applied top-ups."
        ]
      },
      assertions: [
        {
          id: "EXP-007-A01",
          description: "Every player appears in the hand result with start, end, and signed net chips."
        },
        {
          id: "EXP-007-A02",
          description: "The hand result remains visible for 2000ms within ±400ms."
        },
        {
          id: "EXP-007-A03",
          description: "A room-end request during a hand lets that hand complete before ending."
        },
        {
          id: "EXP-007-A04",
          description: "Final rows persist and satisfy net = final - initial - applied top-ups."
        }
      ],
      forbiddenOutcomes: [
        "A participant or accounting component is omitted.",
        "The room ends before the requested final hand settles.",
        "Final accounting disappears without an explicit navigation."
      ],
      acceptableAlternatives: [
        "Positive net values may include a plus sign or an equivalent gain label."
      ],
      stopConditions: {
        overallTimeoutMs: 120_000,
        noProgressTimeoutMs: 10_000
      }
    },
    {
      schemaVersion: "1.0",
      caseId: "EXP-008",
      objective: "Prove acting-player, host, and spectator disconnections recover without duplicated or leaked state.",
      entrypoint: "/room/:roomId",
      fixture: {
        description: "Reconnect fixture with known actions and presentation deadlines for three roles.",
        path: "tests/experience/fixtures/reconnect",
        expectedFacts: [
          "Actor, host, and spectator disconnect in separate subcases.",
          "Recovery occurs both before and after a presentation deadline.",
          "Flow sequences and action IDs are stable across reconnect."
        ]
      },
      assertions: [
        {
          id: "EXP-008-A01",
          description: "Acting-player, host, and spectator reconnect subcases all recover."
        },
        {
          id: "EXP-008-A02",
          description: "Pre- and post-deadline reconnects preserve authoritative flow sequence."
        },
        {
          id: "EXP-008-A03",
          description: "No action, result, settlement, or presentation phase is duplicated or skipped."
        },
        {
          id: "EXP-008-A04",
          description: "Reconnect never exposes future cards or another player's private cards."
        }
      ],
      forbiddenOutcomes: [
        "An action or result repeats after reconnect.",
        "A presentation phase is skipped.",
        "Future or private cards leak to an unauthorized view."
      ],
      acceptableAlternatives: [
        "A reconnecting client may briefly show explicit synchronization guidance."
      ],
      stopConditions: {
        overallTimeoutMs: 180_000,
        noProgressTimeoutMs: 10_000
      }
    },
    {
      schemaVersion: "1.0",
      caseId: "EXP-009",
      objective: "Complete the critical room and poker journey at a touch-enabled 390x844 viewport.",
      entrypoint: "/room/:roomId",
      fixture: {
        description: "Mobile critical-journey fixtures for betting, top-up, all-in, and accounting states.",
        path: "tests/experience/fixtures/mobile-critical-journey",
        expectedFacts: [
          "The viewport is 390x844 with touch and a mobile user agent.",
          "The journey covers join, seat, betting, top-up, host, runout, and results.",
          "Interactive targets meet the 44px target."
        ]
      },
      assertions: [
        {
          id: "EXP-009-A01",
          description: "Join, seat, betting, top-up, host, runout, hand-result, and final-result flows complete."
        },
        {
          id: "EXP-009-A02",
          description: "Required controls remain reachable through deliberate scrolling."
        },
        {
          id: "EXP-009-A03",
          description: "Critical touch targets are at least 44px in both dimensions."
        },
        {
          id: "EXP-009-A04",
          description: "Popovers and overlays remain within the viewport without blocking required actions."
        },
        {
          id: "EXP-009-A05",
          description: "Mobile views satisfy the same synchronization and presentation gates as desktop."
        }
      ],
      forbiddenOutcomes: [
        "A required control is clipped, unreachable, or occluded.",
        "A critical touch target is smaller than 44px.",
        "Mobile state diverges from authoritative room state."
      ],
      acceptableAlternatives: [
        "Secondary controls may collapse into a labeled mobile menu."
      ],
      stopConditions: {
        overallTimeoutMs: 180_000,
        noProgressTimeoutMs: 10_000
      }
    },
    {
      schemaVersion: "1.0",
      caseId: "EXP-010",
      objective: "Smoke the deployed public entry points without fixture injection or broad cleanup.",
      entrypoint: "http://localhost:3000",
      fixture: {
        description: "Run-scoped public-entry room created through the deployed application.",
        expectedFacts: [
          "The deployed health, home, and create endpoints respond.",
          "The room is created only through public entry points.",
          "Cleanup targets only the exact recorded room."
        ]
      },
      assertions: [
        {
          id: "EXP-010-A01",
          description: "Health, home, and create pages respond on the deployed stack."
        },
        {
          id: "EXP-010-A02",
          description: "Public room creation yields usable host and invite links."
        },
        {
          id: "EXP-010-A03",
          description: "A player can join, claim a seat, and complete one basic WebSocket operation."
        },
        {
          id: "EXP-010-A04",
          description: "Cleanup deletes only the exact run-owned room or safely retains and reports it."
        },
        {
          id: "EXP-010-A05",
          description: "Deployed smoke begins only after isolated acceptance cases pass."
        }
      ],
      forbiddenOutcomes: [
        "The deployed stack is restarted, replaced, or seeded through an internal fixture.",
        "Cleanup deletes unrecorded or non-run-owned data."
      ],
      acceptableAlternatives: [
        "If exact ownership cannot be proven, the smoke room is retained and reported."
      ],
      stopConditions: {
        overallTimeoutMs: 120_000,
        noProgressTimeoutMs: 15_000
      }
    }
  ]);

export const EXPERIENCE_CASES: readonly ExperienceCaseManifest[] = deepFreeze(
  manifests
);

export const TWO_ATTEMPT_CASE_IDS: readonly string[] = deepFreeze([
  "EXP-003",
  "EXP-004",
  "EXP-006",
  "EXP-008"
]);

const knownCaseIds = new Set(EXPERIENCE_CASES.map(({ caseId }) => caseId));
const twoAttemptCaseIds = new Set(TWO_ATTEMPT_CASE_IDS);
const ONE_ATTEMPT = deepFreeze(["A-001"] as const);
const TWO_ATTEMPTS = deepFreeze(["A-001", "A-002"] as const);

export function experienceAttemptIds(
  caseId: string
): typeof ONE_ATTEMPT | typeof TWO_ATTEMPTS {
  if (!knownCaseIds.has(caseId)) {
    throw new Error(`Unknown experience case: ${caseId}`);
  }
  return twoAttemptCaseIds.has(caseId) ? TWO_ATTEMPTS : ONE_ATTEMPT;
}
