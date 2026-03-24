import type { BoxConfig, HazmatFees } from "./types";

// =============================================================================
// FedEx API Configuration
// =============================================================================

export const FEDEX_API_BASE_PRODUCTION = "https://apis.fedex.com";
export const FEDEX_API_BASE_SANDBOX = "https://apis-sandbox.fedex.com";

export function getFedExApiBase(useSandbox: boolean): string {
  return useSandbox ? FEDEX_API_BASE_SANDBOX : FEDEX_API_BASE_PRODUCTION;
}

export const FEDEX_TOKEN_EXPIRY_BUFFER_SECONDS = 60;
export const FEDEX_API_TIMEOUT_MS = 8000;

export const DOMESTIC_GROUND_SERVICES = [
  "FEDEX_GROUND",
  "GROUND_HOME_DELIVERY",
] as const;

export const DOMESTIC_AIR_SERVICES = [
  "FEDEX_2_DAY",
  "FEDEX_2_DAY_AM",
  "FEDEX_EXPRESS_SAVER",
  "STANDARD_OVERNIGHT",
  "PRIORITY_OVERNIGHT",
  "FIRST_OVERNIGHT",
] as const;

export const INTERNATIONAL_SERVICES = [
  "INTERNATIONAL_PRIORITY",
  "INTERNATIONAL_ECONOMY",
  "INTERNATIONAL_FIRST",
] as const;

export const ALL_ALLOWED_SERVICES = [
  ...DOMESTIC_GROUND_SERVICES,
  ...DOMESTIC_AIR_SERVICES,
  ...INTERNATIONAL_SERVICES,
] as const;

export const GROUND_SERVICE_SET = new Set<string>(DOMESTIC_GROUND_SERVICES);

export const SERVICE_DISPLAY_NAMES: Record<string, string> = {
  FEDEX_GROUND: "FedEx Ground",
  GROUND_HOME_DELIVERY: "FedEx Home Delivery",
  FEDEX_2_DAY: "FedEx 2Day",
  FEDEX_2_DAY_AM: "FedEx 2Day AM",
  FEDEX_EXPRESS_SAVER: "FedEx Express Saver",
  STANDARD_OVERNIGHT: "FedEx Standard Overnight",
  PRIORITY_OVERNIGHT: "FedEx Priority Overnight",
  FIRST_OVERNIGHT: "FedEx First Overnight",
  INTERNATIONAL_PRIORITY: "FedEx International Priority",
  INTERNATIONAL_ECONOMY: "FedEx International Economy",
  INTERNATIONAL_FIRST: "FedEx International First",
};

// =============================================================================
// Unit Conversions
// =============================================================================

export const GRAMS_PER_LB = 453.592;

// =============================================================================
// Shipping Configuration
// =============================================================================

export const BOX_CONFIGS: BoxConfig[] = [
  {
    name: "2-gallon",
    length: 9,
    width: 15,
    height: 9,
    maxWeightLbs: 30,
    emptyWeightLbs: 2,
  },
  {
    name: "4-gallon",
    length: 15,
    width: 15,
    height: 9,
    maxWeightLbs: 55,
    emptyWeightLbs: 3,
  },
];

export const HAZMAT_FEES_CENTS: HazmatFees = {
  ground_per_order: 3000,
  air_per_order: 12500,
};

// =============================================================================
// Local Delivery Zip Codes
// =============================================================================

const MIAMI_DADE_ZIPS = [
  "33010",
  "33012",
  "33013",
  "33014",
  "33015",
  "33016",
  "33017",
  "33018",
  "33030",
  "33031",
  "33032",
  "33033",
  "33034",
  "33035",
  "33039",
  "33054",
  "33055",
  "33056",
  "33101",
  "33102",
  "33107",
  "33109",
  "33111",
  "33112",
  "33114",
  "33116",
  "33119",
  "33121",
  "33122",
  "33124",
  "33125",
  "33126",
  "33127",
  "33128",
  "33129",
  "33130",
  "33131",
  "33132",
  "33133",
  "33134",
  "33135",
  "33136",
  "33137",
  "33138",
  "33139",
  "33140",
  "33141",
  "33142",
  "33143",
  "33144",
  "33145",
  "33146",
  "33147",
  "33149",
  "33150",
  "33151",
  "33152",
  "33153",
  "33154",
  "33155",
  "33156",
  "33157",
  "33158",
  "33160",
  "33161",
  "33162",
  "33163",
  "33164",
  "33165",
  "33166",
  "33167",
  "33168",
  "33169",
  "33170",
  "33172",
  "33173",
  "33174",
  "33175",
  "33176",
  "33177",
  "33178",
  "33179",
  "33180",
  "33181",
  "33182",
  "33183",
  "33184",
  "33185",
  "33186",
  "33187",
  "33188",
  "33189",
  "33190",
  "33193",
  "33194",
  "33196",
  "33197",
  "33199",
  "33242",
  "33243",
  "33245",
  "33247",
  "33255",
  "33256",
  "33257",
  "33261",
  "33265",
  "33266",
  "33269",
  "33280",
  "33283",
  "33296",
  "33299",
];

const BROWARD_ZIPS = [
  "33004",
  "33009",
  "33019",
  "33020",
  "33021",
  "33022",
  "33023",
  "33024",
  "33025",
  "33026",
  "33027",
  "33028",
  "33029",
  "33060",
  "33061",
  "33062",
  "33063",
  "33064",
  "33065",
  "33066",
  "33067",
  "33068",
  "33069",
  "33071",
  "33073",
  "33074",
  "33075",
  "33076",
  "33077",
  "33081",
  "33082",
  "33083",
  "33084",
  "33301",
  "33302",
  "33303",
  "33304",
  "33305",
  "33306",
  "33307",
  "33308",
  "33309",
  "33310",
  "33311",
  "33312",
  "33313",
  "33314",
  "33315",
  "33316",
  "33317",
  "33318",
  "33319",
  "33320",
  "33321",
  "33322",
  "33323",
  "33324",
  "33325",
  "33326",
  "33327",
  "33328",
  "33329",
  "33330",
  "33331",
  "33332",
  "33334",
  "33335",
  "33336",
  "33337",
  "33338",
  "33339",
  "33340",
  "33345",
  "33346",
  "33348",
  "33349",
  "33351",
  "33355",
  "33359",
  "33388",
  "33394",
  "33441",
  "33442",
  "33443",
];

export const LOCAL_DELIVERY_ZIPS = new Set([
  ...MIAMI_DADE_ZIPS,
  ...BROWARD_ZIPS,
]);
