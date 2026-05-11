// Change this mapping here if your TouchDesigner network expects different IDs.
export const EXPRESSION_ORDER = [
  "neutral",
  "happy",
  "sad",
  "angry",
  "fearful",
  "disgusted",
  "surprised",
];

export const EXPRESSION_VALUE_MAP = {
  neutral: 0,
  happy: 1,
  sad: 2,
  angry: 3,
  fearful: 4,
  disgusted: 5,
  surprised: 6,
};

export function emptyExpressions() {
  return Object.fromEntries(EXPRESSION_ORDER.map((name) => [name, 0]));
}

export function normalizeExpressions(expressions) {
  const normalized = emptyExpressions();

  if (!expressions) {
    return normalized;
  }

  for (const name of EXPRESSION_ORDER) {
    const value = Number(expressions[name]);
    normalized[name] = Number.isFinite(value) ? value : 0;
  }

  return normalized;
}

export function getDominantExpression(expressions) {
  if (!expressions) {
    return {
      dominantExpression: "none",
      dominantValue: -1,
      dominantConfidence: 0,
    };
  }

  let expressionName = "none";
  let confidence = 0;

  if (typeof expressions.asSortedArray === "function") {
    const sorted = expressions.asSortedArray();
    if (sorted.length > 0) {
      expressionName = sorted[0].expression;
      confidence = Number(sorted[0].probability) || 0;
    }
  } else {
    for (const name of EXPRESSION_ORDER) {
      const value = Number(expressions[name]) || 0;
      if (value > confidence) {
        expressionName = name;
        confidence = value;
      }
    }
  }

  if (!(expressionName in EXPRESSION_VALUE_MAP)) {
    return {
      dominantExpression: "none",
      dominantValue: -1,
      dominantConfidence: 0,
    };
  }

  return {
    dominantExpression: expressionName,
    dominantValue: EXPRESSION_VALUE_MAP[expressionName],
    dominantConfidence: confidence,
  };
}
