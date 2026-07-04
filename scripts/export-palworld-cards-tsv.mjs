import fs from "node:fs";

const inputPath = "PalworldCards.json";
const outputPath = "PalworldCards.tsv";

const columns = [
  "id",
  "name",
  "type",
  "cost",
  "quick",
  "lucky",
  "aptitude",
  "element",
  "image_path",
  "rarity",
  "release_code",
  "set_name",
  "effect",
  "flavor",
  "Power",
  "Strike",
  "Durability",
  "Unlimited",
  "Domain",
];

function normalizeCell(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\t/g, " ").replace(/\r?\n/g, " ").trim();
}

function commaList(value) {
  return Array.isArray(value) ? value.map(normalizeCell).filter(Boolean).join(", ") : normalizeCell(value);
}

function outputType(cardType) {
  return cardType === "Lucky Pal" || cardType === "Normal Pal" ? "Pal" : cardType;
}

function outputRarity(rarity) {
  if (rarity === "TD") return "C";
  if (rarity === "TSR") return "SR";
  if (rarity === "TSP") return "SP";
  return rarity || "C";
}

function releaseCode(setValues) {
  const firstSet = Array.isArray(setValues) ? setValues[0] : setValues;
  if (firstSet === "EBP01") return "EBP";
  return firstSet || "";
}

function isPal(cardType) {
  return cardType === "Lucky Pal" || cardType === "Normal Pal";
}

function rowForCard(card) {
  const originalType = card.type || "";
  const pal = isPal(originalType);

  return {
    id: card.id,
    name: card.name,
    type: outputType(originalType),
    cost: card.cost,
    quick: "",
    lucky: originalType === "Lucky Pal" ? "TRUE" : "FALSE",
    aptitude: commaList(card.Aptitude),
    element: commaList(card.CardType),
    image_path: "",
    rarity: outputRarity(card.Rarity),
    release_code: releaseCode(card.Set),
    set_name: "Dawn of Palpagos",
    effect: "",
    flavor: "",
    Power: pal ? card.Power : "",
    Strike: pal ? card.Strike : "",
    Durability: originalType === "Structure" ? card.Power : "",
    Unlimited: originalType === "Unlimited" ? "TRUE" : "FALSE",
    Domain: Array.isArray(card.Color) ? card.Color[0] || "" : card.Color || "",
  };
}

const cardsById = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const rows = Object.values(cardsById).map(rowForCard);
const tsv = [
  columns.join("\t"),
  ...rows.map((row) => columns.map((column) => normalizeCell(row[column])).join("\t")),
].join("\n");

fs.writeFileSync(outputPath, `${tsv}\n`);
console.log(`Exported ${rows.length} cards to ${outputPath}`);
