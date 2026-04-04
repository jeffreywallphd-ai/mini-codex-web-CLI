const test = require("node:test");
const assert = require("node:assert/strict");

const { sortByPosition, toPositiveInteger } = require("./automationQueuePosition");

test("toPositiveInteger normalizes positive integers and rejects invalid values", () => {
  assert.equal(toPositiveInteger(1), 1);
  assert.equal(toPositiveInteger("2"), 2);
  assert.equal(toPositiveInteger(" 03 "), 3);
  assert.equal(toPositiveInteger(0), null);
  assert.equal(toPositiveInteger(-1), null);
  assert.equal(toPositiveInteger("abc"), null);
});

test("sortByPosition sorts by position and preserves stable ordering ties", () => {
  const result = sortByPosition(
    [
      { id: "b", positionInQueue: 2 },
      { id: "a", positionInQueue: 1 },
      { id: "c", positionInQueue: 2 }
    ],
    (item) => item.positionInQueue
  );

  assert.deepEqual(
    result.map((item) => item.id),
    ["a", "b", "c"]
  );
});

test("sortByPosition supports deterministic tie-breaking", () => {
  const result = sortByPosition(
    [
      { id: 20, position_in_queue: 1 },
      { id: 10, position_in_queue: 1 },
      { id: 30, position_in_queue: 2 }
    ],
    (item) => item.position_in_queue,
    (item) => item.id
  );

  assert.deepEqual(
    result.map((item) => item.id),
    [10, 20, 30]
  );
});
