function toPositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function sortByPosition(items = [], getPosition, getTieBreaker = null) {
  const source = Array.isArray(items) ? items : [];
  if (typeof getPosition !== "function") {
    throw new TypeError("getPosition must be a function");
  }

  return source
    .map((item, index) => ({
      item,
      index,
      position: toPositiveInteger(getPosition(item)),
      tieBreaker: typeof getTieBreaker === "function"
        ? toPositiveInteger(getTieBreaker(item))
        : null
    }))
    .filter((entry) => entry.position !== null)
    .sort((a, b) => {
      if (a.position !== b.position) {
        return a.position - b.position;
      }

      if (a.tieBreaker !== b.tieBreaker) {
        if (a.tieBreaker === null) return 1;
        if (b.tieBreaker === null) return -1;
        return a.tieBreaker - b.tieBreaker;
      }

      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

module.exports = {
  sortByPosition,
  toPositiveInteger
};
