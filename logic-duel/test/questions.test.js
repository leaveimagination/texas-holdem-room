const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createFixtureHands,
  createQuestionDeck,
  answerQuestion,
  formatAnswer
} = require("../src/questions");

test("createQuestionDeck has at least 24 unique cards", () => {
  const deck = createQuestionDeck();
  assert.ok(deck.length >= 24);
  assert.equal(new Set(deck.map((card) => card.id)).size, deck.length);
});

test("createFixtureHands returns deterministic sorted hands", () => {
  const { actorHand, targetHand } = createFixtureHands();

  assert.deepEqual(targetHand, [
    { number: 0, color: "red", revealed: false },
    { number: 2, color: "red", revealed: false },
    { number: 2, color: "blue", revealed: false },
    { number: 7, color: "red", revealed: false },
    { number: 9, color: "blue", revealed: false }
  ]);
  assert.deepEqual(actorHand, [
    { number: 1, color: "blue", revealed: false },
    { number: 3, color: "red", revealed: false },
    { number: 4, color: "blue", revealed: false },
    { number: 6, color: "red", revealed: false },
    { number: 8, color: "blue", revealed: false }
  ]);
});

test("answerQuestion evaluates the actor question against targetHand by default", () => {
  const { actorHand, targetHand } = createFixtureHands();

  const cases = [
    [{ answerType: "number", params: { color: "red" }, family: "countColor" }, 3],
    [{ answerType: "number", params: { color: "blue" }, family: "countColor" }, 2],
    [{ answerType: "number", params: { parity: "odd" }, family: "countParity" }, 2],
    [{ answerType: "number", params: { parity: "even" }, family: "countParity" }, 3],
    [{ answerType: "number", params: { threshold: 5 }, family: "greaterThan" }, 2],
    [{ answerType: "number", params: { threshold: 5 }, family: "lessThan" }, 3],
    [{ answerType: "number", params: {}, family: "sumNumbers" }, 20],
    [{ answerType: "boolean", params: { number: 2 }, family: "hasNumber" }, true],
    [{ answerType: "boolean", params: { number: 5 }, family: "hasNumber" }, false],
    [{ answerType: "tileNumber", params: { position: 1 }, family: "numberAtPosition" }, 0],
    [{ answerType: "tileColor", params: { position: 3 }, family: "colorAtPosition" }, "blue"],
    [{ answerType: "boolean", params: {}, family: "hasAdjacentConsecutive" }, false],
    [{ answerType: "number", params: { min: 2, max: 7 }, family: "countRange" }, 3]
  ];

  for (const [card, expected] of cases) {
    assert.equal(answerQuestion(card, actorHand, targetHand).value, expected);
  }
  assert.equal(
    answerQuestion({ answerType: "boolean", params: { number: 5 }, family: "hasNumber" }, actorHand, targetHand).display,
    "No"
  );
});

test("formatAnswer renders supported answer types", () => {
  assert.equal(formatAnswer("boolean", true), "Yes");
  assert.equal(formatAnswer("boolean", false), "No");
  assert.equal(formatAnswer("number", 3), "3");
  assert.equal(formatAnswer("tileNumber", 7), "7");
  assert.equal(formatAnswer("tileColor", "red"), "red");
  assert.equal(formatAnswer("text", "none"), "none");
});
