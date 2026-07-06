const { sortHand } = require("./game-core");

const QUESTION_DECK = [
  {
    id: "count-color-red",
    text: "How many red tiles are in your hand?",
    family: "countColor",
    params: { color: "red" },
    answerType: "number"
  },
  {
    id: "count-color-blue",
    text: "How many blue tiles are in your hand?",
    family: "countColor",
    params: { color: "blue" },
    answerType: "number"
  },
  {
    id: "count-parity-odd",
    text: "How many odd numbers are in your hand?",
    family: "countParity",
    params: { parity: "odd" },
    answerType: "number"
  },
  {
    id: "count-parity-even",
    text: "How many even numbers are in your hand?",
    family: "countParity",
    params: { parity: "even" },
    answerType: "number"
  },
  {
    id: "greater-than-2",
    text: "How many tiles are greater than 2?",
    family: "greaterThan",
    params: { threshold: 2 },
    answerType: "number"
  },
  {
    id: "greater-than-4",
    text: "How many tiles are greater than 4?",
    family: "greaterThan",
    params: { threshold: 4 },
    answerType: "number"
  },
  {
    id: "greater-than-6",
    text: "How many tiles are greater than 6?",
    family: "greaterThan",
    params: { threshold: 6 },
    answerType: "number"
  },
  {
    id: "less-than-3",
    text: "How many tiles are less than 3?",
    family: "lessThan",
    params: { threshold: 3 },
    answerType: "number"
  },
  {
    id: "less-than-5",
    text: "How many tiles are less than 5?",
    family: "lessThan",
    params: { threshold: 5 },
    answerType: "number"
  },
  {
    id: "less-than-7",
    text: "How many tiles are less than 7?",
    family: "lessThan",
    params: { threshold: 7 },
    answerType: "number"
  },
  {
    id: "sum-all-numbers",
    text: "What is the sum of every number in your hand?",
    family: "sumNumbers",
    params: {},
    answerType: "number"
  },
  {
    id: "has-number-0",
    text: "Do you have a 0?",
    family: "hasNumber",
    params: { number: 0 },
    answerType: "boolean"
  },
  {
    id: "has-number-2",
    text: "Do you have a 2?",
    family: "hasNumber",
    params: { number: 2 },
    answerType: "boolean"
  },
  {
    id: "has-number-5",
    text: "Do you have a 5?",
    family: "hasNumber",
    params: { number: 5 },
    answerType: "boolean"
  },
  {
    id: "has-number-9",
    text: "Do you have a 9?",
    family: "hasNumber",
    params: { number: 9 },
    answerType: "boolean"
  },
  {
    id: "number-at-position-1",
    text: "What number is in position 1?",
    family: "numberAtPosition",
    params: { position: 1 },
    answerType: "tileNumber"
  },
  {
    id: "number-at-position-3",
    text: "What number is in position 3?",
    family: "numberAtPosition",
    params: { position: 3 },
    answerType: "tileNumber"
  },
  {
    id: "number-at-position-5",
    text: "What number is in position 5?",
    family: "numberAtPosition",
    params: { position: 5 },
    answerType: "tileNumber"
  },
  {
    id: "color-at-position-1",
    text: "What color is in position 1?",
    family: "colorAtPosition",
    params: { position: 1 },
    answerType: "tileColor"
  },
  {
    id: "color-at-position-3",
    text: "What color is in position 3?",
    family: "colorAtPosition",
    params: { position: 3 },
    answerType: "tileColor"
  },
  {
    id: "color-at-position-5",
    text: "What color is in position 5?",
    family: "colorAtPosition",
    params: { position: 5 },
    answerType: "tileColor"
  },
  {
    id: "has-adjacent-consecutive",
    text: "Do any neighboring positions have consecutive numbers?",
    family: "hasAdjacentConsecutive",
    params: {},
    answerType: "boolean"
  },
  {
    id: "count-range-0-3",
    text: "How many tiles are from 0 through 3?",
    family: "countRange",
    params: { min: 0, max: 3 },
    answerType: "number"
  },
  {
    id: "count-range-4-6",
    text: "How many tiles are from 4 through 6?",
    family: "countRange",
    params: { min: 4, max: 6 },
    answerType: "number"
  },
  {
    id: "count-range-7-9",
    text: "How many tiles are from 7 through 9?",
    family: "countRange",
    params: { min: 7, max: 9 },
    answerType: "number"
  }
];

function createQuestionDeck() {
  return QUESTION_DECK.map((card) => ({
    ...card,
    params: { ...card.params }
  }));
}

function withHiddenTiles(hand) {
  return sortHand(hand).map((tile) => ({
    number: tile.number,
    color: tile.color,
    revealed: false
  }));
}

function createFixtureHands() {
  return {
    actorHand: withHiddenTiles([
      { number: 1, color: "blue" },
      { number: 3, color: "red" },
      { number: 4, color: "blue" },
      { number: 6, color: "red" },
      { number: 8, color: "blue" }
    ]),
    targetHand: withHiddenTiles([
      { number: 0, color: "red" },
      { number: 2, color: "blue" },
      { number: 2, color: "red" },
      { number: 7, color: "red" },
      { number: 9, color: "blue" }
    ])
  };
}

function formatAnswer(answerType, value) {
  if (answerType === "boolean") {
    return value ? "Yes" : "No";
  }
  return String(value);
}

function getPosition(hand, position) {
  return hand[position - 1];
}

function answerQuestion(card, actorHand, targetHand, context = {}) {
  const hand = context.evaluate === "actor" ? actorHand : (targetHand || actorHand);
  const sortedHand = sortHand(hand);
  const params = card.params || {};
  let value;

  switch (card.family) {
    case "countColor":
      value = sortedHand.filter((tile) => tile.color === params.color).length;
      break;
    case "countParity":
      value = sortedHand.filter((tile) => {
        const isEven = tile.number % 2 === 0;
        return params.parity === "even" ? isEven : !isEven;
      }).length;
      break;
    case "greaterThan":
      value = sortedHand.filter((tile) => tile.number > params.threshold).length;
      break;
    case "lessThan":
      value = sortedHand.filter((tile) => tile.number < params.threshold).length;
      break;
    case "sumNumbers":
      value = sortedHand.reduce((sum, tile) => sum + tile.number, 0);
      break;
    case "hasNumber":
      value = sortedHand.some((tile) => tile.number === params.number);
      break;
    case "numberAtPosition":
      value = getPosition(sortedHand, params.position)?.number;
      break;
    case "colorAtPosition":
      value = getPosition(sortedHand, params.position)?.color;
      break;
    case "hasAdjacentConsecutive":
      value = sortedHand.some((tile, index) => (
        index > 0 && tile.number === sortedHand[index - 1].number + 1
      ));
      break;
    case "countRange":
      value = sortedHand.filter((tile) => (
        tile.number >= params.min && tile.number <= params.max
      )).length;
      break;
    default:
      throw new Error(`Unknown question family: ${card.family}`);
  }

  return {
    value,
    display: formatAnswer(card.answerType, value)
  };
}

module.exports = {
  createFixtureHands,
  createQuestionDeck,
  answerQuestion,
  formatAnswer
};
