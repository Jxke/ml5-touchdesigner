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

const EXPRESSION_ALIASES = {
  fear: "fearful",
  fearful: "fearful",
  disgust: "disgusted",
  disgusted: "disgusted",
  surprise: "surprised",
  surprised: "surprised",
};

function canonicalExpressionName(name) {
  return EXPRESSION_ALIASES[name] || name;
}

export function emptyExpressions() {
  return Object.fromEntries(EXPRESSION_ORDER.map((name) => [name, 0]));
}

export function normalizeExpressions(expressions) {
  const normalized = emptyExpressions();

  if (!expressions) {
    return normalized;
  }

  for (const rawName of Object.keys(expressions)) {
    const name = canonicalExpressionName(rawName);
    if (!(name in normalized)) {
      continue;
    }

    const value = Number(expressions[rawName]);
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
      expressionName = canonicalExpressionName(sorted[0].expression);
      confidence = Number(sorted[0].probability) || 0;
    }
  } else {
    const normalized = normalizeExpressions(expressions);
    for (const name of EXPRESSION_ORDER) {
      const value = Number(normalized[name]) || 0;
      if (value > confidence) {
        expressionName = name;
        confidence = value;
      }
    }
  }

  if (!(expressionName in EXPRESSION_VALUE_MAP)) {
    const normalized = normalizeExpressions(expressions);
    for (const name of EXPRESSION_ORDER) {
      const value = Number(normalized[name]) || 0;
      if (value > confidence || expressionName === "none") {
        expressionName = name;
        confidence = value;
      }
    }
  }

  if (!(expressionName in EXPRESSION_VALUE_MAP)) {
    expressionName = "none";
    confidence = 0;
  }

  return {
    dominantExpression: expressionName,
    dominantValue: EXPRESSION_VALUE_MAP[expressionName],
    dominantConfidence: confidence,
  };
}
