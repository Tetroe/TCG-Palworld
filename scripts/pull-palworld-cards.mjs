#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const API_URL =
  "https://en.palworld-official-cardgame.com/manage/card-list-user/list";
const CARD_IMAGE_URL =
  "https://en.palworld-official-cardgame.com/wordpress/wp-content/images/cardlist/";
const PUBLIC_CARD_IMAGE_URL =
  "https://balbi.github.io/TCG-Arena-Palworld/images/cards/";
const PER_PAGE = 100;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const outputPath = resolve(repoRoot, process.argv[2] ?? "PalworldCards.json");
const cardsDir = resolve(repoRoot, "images", "cards");
const execFileAsync = promisify(execFile);

function toArray(value, separator) {
  if (value == null || value === "") {
    return [];
  }

  const values = separator ? String(value).split(separator) : [value];
  return values.map((item) => String(item).trim()).filter(Boolean);
}

function toNumber(value) {
  if (value == null || value === "") {
    return 0;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Expected numeric value, received "${value}"`);
  }

  return parsed;
}

function getDisplayKind(card) {
  if (card.card_kind === "Pal") {
    return card.card_kind_sub || card.card_kind;
  }

  return card.card_kind;
}

function encodeImagePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function getImageUrl(card) {
  if (!card.picture) {
    return "";
  }

  return `${PUBLIC_CARD_IMAGE_URL}${encodeImagePath(card.picture)}`;
}

function getDownloadUrl(card) {
  if (!card.picture) {
    return "";
  }

  return `${CARD_IMAGE_URL}${encodeImagePath(card.picture)}`;
}

function getImageOutputPath(card) {
  const outputFile = resolve(cardsDir, ...String(card.picture).split("/"));

  if (!outputFile.startsWith(`${cardsDir}/`)) {
    throw new Error(`Invalid image path: ${card.picture}`);
  }

  return outputFile;
}

function isHorizontalCard(card) {
  return card.card_kind === "Structure";
}

function mapCard(card) {
  const id = card.card_number;
  const displayKind = getDisplayKind(card);
  const cost = toNumber(card.cost);

  if (!id) {
    throw new Error(`Card is missing card_number: ${JSON.stringify(card)}`);
  }

  return [
    id,
    {
      id,
      face: {
        front: {
          name: card.card_name,
          type: displayKind,
          cost,
          image: getImageUrl(card),
          isHorizontal: isHorizontalCard(card),
        },
      },
      name: card.card_name,
      type: displayKind,
      cost,
      Color: toArray(card.color),
      CardType: toArray(card.type, "|"),
      Aptitude: toArray(card.aptitude, "|"),
      Set: toArray(card.expansion),
      Power: card.power,
      Strike: card.attack,
      Rarity: card.rare,
      isToken: false,
    },
  ];
}

function mergeArrayValues(first, second) {
  return [...new Set([...first, ...second])];
}

function buildCardMap(cards) {
  const mappedCards = {};
  const duplicateIds = new Set();

  for (const card of cards) {
    const [id, mappedCard] = mapCard(card);
    const existingCard = mappedCards[id];

    if (!existingCard) {
      mappedCards[id] = mappedCard;
      continue;
    }

    duplicateIds.add(id);
    mappedCards[id] = {
      ...existingCard,
      ...mappedCard,
      Color: mergeArrayValues(existingCard.Color, mappedCard.Color),
      CardType: mergeArrayValues(existingCard.CardType, mappedCard.CardType),
      Aptitude: mergeArrayValues(existingCard.Aptitude, mappedCard.Aptitude),
      Set: mergeArrayValues(existingCard.Set, mappedCard.Set),
    };
  }

  return { mappedCards, duplicateIds };
}

async function readExistingCardMap(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

async function fetchPage(page) {
  const url = new URL(API_URL);
  url.searchParams.set("page", page);
  url.searchParams.set("per_page", PER_PAGE);
  url.searchParams.set("sort", "id");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed for page ${page}: ${response.status}`);
  }

  return response.json();
}

async function fetchAllCards() {
  const cards = [];
  let page = 1;
  let total = Infinity;

  while (cards.length < total) {
    const data = await fetchPage(page);
    const items = Array.isArray(data.items) ? data.items : [];

    total = Number(data.total ?? items.length);
    cards.push(...items);

    if (items.length === 0) {
      break;
    }

    page += 1;
  }

  return cards;
}

async function downloadCardImage(card) {
  if (!card.picture) {
    return { downloaded: false, rotated: false };
  }

  const outputFile = getImageOutputPath(card);
  const response = await fetch(getDownloadUrl(card));

  if (!response.ok) {
    throw new Error(
      `Failed to download ${card.picture}: ${response.status} ${response.statusText}`,
    );
  }

  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, Buffer.from(await response.arrayBuffer()));

  if (card.card_kind === "Structure") {
    await rotateImageCounterClockwise(outputFile);
    return { downloaded: true, rotated: true };
  }

  return { downloaded: true, rotated: false };
}

async function rotateImageCounterClockwise(imagePath) {
  try {
    await execFileAsync("magick", [imagePath, "-rotate", "-90", imagePath]);
    return;
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  await execFileAsync("sips", ["--rotate", "270", imagePath]);
}

async function downloadCardImages(cards) {
  let downloaded = 0;
  let rotated = 0;

  for (const card of cards) {
    const result = await downloadCardImage(card);

    if (result.downloaded) {
      downloaded += 1;
    }

    if (result.rotated) {
      rotated += 1;
    }
  }

  return { downloaded, rotated };
}

async function main() {
  const cards = await fetchAllCards();
  const { mappedCards, duplicateIds } = buildCardMap(cards);
  const existingCards = await readExistingCardMap(outputPath);
  const outputCards = { ...existingCards, ...mappedCards };
  const updatedExistingCards = Object.keys(mappedCards).filter(
    (id) => id in existingCards,
  ).length;
  const preservedCards = Object.keys(existingCards).length - updatedExistingCards;
  const { downloaded, rotated } = await downloadCardImages(cards);

  await writeFile(outputPath, `${JSON.stringify(outputCards, null, 2)}\n`);

  if (duplicateIds.size > 0) {
    console.warn(
      `Merged duplicate card_number values: ${[...duplicateIds].join(", ")}`,
    );
  }

  console.log(
    `Wrote ${Object.keys(outputCards).length} cards to ${outputPath}`,
  );
  console.log(
    `Added/updated ${Object.keys(mappedCards).length} cards from ${cards.length} API rows; preserved ${preservedCards} existing cards`,
  );
  console.log(`Downloaded ${downloaded} card images to ${cardsDir}`);
  console.log(`Rotated ${rotated} Structure card images counter-clockwise`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
