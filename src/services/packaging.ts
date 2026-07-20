import type {
  BoxConfig,
  ShopifyCartItem,
  FedExPackageLineItem,
} from "../types";
import { GRAMS_PER_LB, BOX_CONFIGS } from "../config";

// Safety factor for weight capacity
const WEIGHT_FILL_PERCENTAGE = 0.9;
// Safety factor for floor area (accounts for imperfect packing)
const AREA_FILL_PERCENTAGE = 0.85;

export interface PackedBox {
  box: BoxConfig;
  totalWeightLbs: number;
  itemWeightLbs: number;
  usedFloorArea: number; // square inches
  isHazmat: boolean;
}

interface ItemDimensions {
  length: number;
  width: number;
  height: number;
  hasValidDimensions: boolean;
}

interface PackableItem {
  weightLbs: number;
  dimensions: ItemDimensions;
  floorArea: number; // length × width
  isHazmat: boolean;
}

export function gramsToLbs(grams: number): number {
  return grams / GRAMS_PER_LB;
}

export function calculateTotalCartWeightLbs(items: ShopifyCartItem[]): number {
  return items.reduce((total, item) => {
    return total + gramsToLbs(item.grams) * item.quantity;
  }, 0);
}

export function cartContainsHazmat(items: ShopifyCartItem[]): boolean {
  return items.some((item) => extractItemHazmat(item));
}

function parseNumericProperty(value: string | undefined): number | null {
  if (!value) return null;

  // Handle values like "7 in", "12.5 in ", "7.25 in"
  // Extract the numeric portion at the start of the string
  const trimmed = value.trim();
  const match = trimmed.match(/^([\d.]+)/);
  if (!match) return null;

  const parsed = parseFloat(match[1]);
  return isNaN(parsed) || parsed <= 0 ? null : parsed;
}

function extractItemDimensions(item: ShopifyCartItem): ItemDimensions {
  const props = item.properties || {};

  const length = parseNumericProperty(props["_length"]);
  const width = parseNumericProperty(props["_width"]);
  const height = parseNumericProperty(props["_height"]);

  if (length !== null && width !== null && height !== null) {
    return {
      length,
      width,
      height,
      hasValidDimensions: true,
    };
  }

  return {
    length: 0,
    width: 0,
    height: 0,
    hasValidDimensions: false,
  };
}

function extractItemHazmat(item: ShopifyCartItem): boolean {
  const props = item.properties || {};
  const hazmatValue = props["_is_hazmat"];
  return hazmatValue === "true" || hazmatValue === "1";
}

function getEffectiveWeightCapacity(box: BoxConfig): number {
  return (box.maxWeightLbs - box.emptyWeightLbs) * WEIGHT_FILL_PERCENTAGE;
}

function getEffectiveFloorArea(box: BoxConfig): number {
  return box.length * box.width * AREA_FILL_PERCENTAGE;
}

function itemFitsInBox(item: PackableItem, box: BoxConfig): boolean {
  // Check weight
  if (item.weightLbs > getEffectiveWeightCapacity(box)) {
    return false;
  }

  // If no dimensions, weight check is sufficient
  if (!item.dimensions.hasValidDimensions) {
    return true;
  }

  // Check height (item must fit standing up)
  if (item.dimensions.height > box.height) {
    return false;
  }

  // Check floor area
  if (item.floorArea > getEffectiveFloorArea(box)) {
    return false;
  }

  return true;
}

function itemFitsInPackedBox(
  item: PackableItem,
  packedBox: PackedBox,
): boolean {
  // Check remaining weight capacity
  const remainingWeight =
    getEffectiveWeightCapacity(packedBox.box) - packedBox.itemWeightLbs;
  if (item.weightLbs > remainingWeight) {
    return false;
  }

  // If no dimensions, weight check is sufficient
  if (!item.dimensions.hasValidDimensions) {
    return true;
  }

  // Check height
  if (item.dimensions.height > packedBox.box.height) {
    return false;
  }

  // Check remaining floor area
  const remainingArea =
    getEffectiveFloorArea(packedBox.box) - packedBox.usedFloorArea;
  if (item.floorArea > remainingArea) {
    return false;
  }

  return true;
}

export function packItems(
  items: ShopifyCartItem[],
  boxConfigs: BoxConfig[] = BOX_CONFIGS,
): PackedBox[] {
  if (items.length === 0) {
    return [];
  }

  if (boxConfigs.length === 0) {
    throw new Error("No box configurations available");
  }

  // Sort boxes by floor area (smallest first for efficient selection)
  const boxesByAreaAsc = [...boxConfigs].sort(
    (a, b) => a.length * a.width - b.length * b.width,
  );
  const largestBox = boxesByAreaAsc[boxesByAreaAsc.length - 1];

  // Expand items by quantity and extract dimensions
  const packableItems: PackableItem[] = [];
  for (const item of items) {
    const weightPerUnit = gramsToLbs(item.grams);
    const dimensions = extractItemDimensions(item);
    const floorArea = dimensions.hasValidDimensions
      ? dimensions.length * dimensions.width
      : 0;
    const isHazmat = extractItemHazmat(item);

    for (let i = 0; i < item.quantity; i++) {
      packableItems.push({
        weightLbs: weightPerUnit,
        dimensions,
        floorArea,
        isHazmat,
      });
    }
  }

  // Sort by floor area descending (largest items first), then by weight
  packableItems.sort((a, b) => {
    if (b.floorArea !== a.floorArea) {
      return b.floorArea - a.floorArea;
    }
    return b.weightLbs - a.weightLbs;
  });

  const packedBoxes: PackedBox[] = [];

  // Separate boxes by hazmat status for efficient lookup
  const hazmatBoxes = boxesByAreaAsc.filter((box) => box.hazmat);
  const nonHazmatBoxes = boxesByAreaAsc.filter((box) => !box.hazmat);
  const largestHazmatBox = hazmatBoxes[hazmatBoxes.length - 1];
  const largestNonHazmatBox = nonHazmatBoxes[nonHazmatBoxes.length - 1];

  for (const item of packableItems) {
    let placed = false;

    // Get the appropriate boxes for this item's hazmat status
    const eligibleBoxes = item.isHazmat ? hazmatBoxes : nonHazmatBoxes;
    const fallbackBox = item.isHazmat ? largestHazmatBox : largestNonHazmatBox;

    // Try to fit in existing boxes with matching hazmat status
    for (const packedBox of packedBoxes) {
      if (packedBox.isHazmat !== item.isHazmat) {
        continue; // Skip boxes that don't match hazmat status
      }
      if (itemFitsInPackedBox(item, packedBox)) {
        packedBox.itemWeightLbs += item.weightLbs;
        packedBox.totalWeightLbs += item.weightLbs;
        packedBox.usedFloorArea += item.floorArea;
        placed = true;
        break;
      }
    }

    // Need a new box
    if (!placed) {
      const suitableBox = eligibleBoxes.find((box) =>
        itemFitsInBox(item, box),
      );

      const boxToUse = suitableBox || fallbackBox;
      if (!boxToUse) {
        throw new Error(
          `No ${item.isHazmat ? "hazmat" : "non-hazmat"} box configurations available`,
        );
      }
      packedBoxes.push({
        box: boxToUse,
        itemWeightLbs: item.weightLbs,
        totalWeightLbs: boxToUse.emptyWeightLbs + item.weightLbs,
        usedFloorArea: item.floorArea,
        isHazmat: item.isHazmat,
      });
    }
  }

  return packedBoxes;
}

export function packedBoxesToFedExPackages(
  packedBoxes: PackedBox[],
): FedExPackageLineItem[] {
  return packedBoxes.map((packed) => ({
    weight: {
      units: "LB",
      value: Math.round(packed.totalWeightLbs * 100) / 100,
    },
    dimensions: {
      length: packed.box.length,
      width: packed.box.width,
      height: packed.box.height,
      units: "IN",
    },
    groupPackageCount: 1,
  }));
}

export function getPackagesForCart(
  items: ShopifyCartItem[],
  boxConfigs: BoxConfig[] = BOX_CONFIGS,
): FedExPackageLineItem[] {
  const shippableItems = items.filter((item) => item.requires_shipping);

  if (shippableItems.length === 0) {
    return [];
  }

  const packedBoxes = packItems(shippableItems, boxConfigs);
  return packedBoxesToFedExPackages(packedBoxes);
}
