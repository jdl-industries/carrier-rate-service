#!/usr/bin/env npx tsx

import { execSync } from "child_process";

const isProduction =
  process.argv.includes("--env") && process.argv.includes("production");

// KV namespace ID from wrangler.toml
const KV_NAMESPACE_ID = "b17376c37a5641bebb48927a3409c6f5";

// For local dev, use --local flag; for production, use the remote namespace
const kvFlag = isProduction ? "" : "--local";

console.log(
  `Seeding KV namespace${isProduction ? " (production)" : " (local)"}...\n`,
);

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

const LOCAL_DELIVERY_ZIPS = [...MIAMI_DADE_ZIPS, ...BROWARD_ZIPS];

const SHIPPER_ADDRESS = {
  streetLines: ["9500 Northwest 12th Street", "Unit 6"],
  city: "Miami",
  stateOrProvinceCode: "FL",
  postalCode: "33172-2831",
  countryCode: "US",
};

const BOX_SIZES = [
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

const HANDLING_FEES = {
  ground_per_order: 30,
  air_per_order: 125,
};

const LEAD_TIMES = {
  default: 1,
};

const PRIORITY_FEE = 3000;

const kvEntries = [
  {
    key: "zip_codes:local_delivery",
    value: JSON.stringify(LOCAL_DELIVERY_ZIPS),
  },
  { key: "config:shipper_address", value: JSON.stringify(SHIPPER_ADDRESS) },
  { key: "config:box_sizes", value: JSON.stringify(BOX_SIZES) },
  { key: "config:handling_fees", value: JSON.stringify(HANDLING_FEES) },
  { key: "config:lead_times", value: JSON.stringify(LEAD_TIMES) },
  { key: "config:priority_fee", value: String(PRIORITY_FEE) },
];

for (const entry of kvEntries) {
  console.log(`Setting ${entry.key}...`);

  const escapedValue = entry.value.replace(/'/g, "'\\''");

  try {
    execSync(
      `npx wrangler kv key put --namespace-id=${KV_NAMESPACE_ID} '${entry.key}' '${escapedValue}' ${kvFlag}`,
      { stdio: "inherit" },
    );
  } catch (error) {
    console.error(`Failed to set ${entry.key}:`, error);
    process.exit(1);
  }
}

console.log("\nKV namespace seeded successfully!");
console.log(
  `\nLocal delivery zip codes: ${LOCAL_DELIVERY_ZIPS.length} entries`,
);
console.log(`Box sizes: ${BOX_SIZES.length} configurations`);
console.log(
  `Handling fees: Ground=$${HANDLING_FEES.ground_per_order}, Air=$${HANDLING_FEES.air_per_order}`,
);
console.log(`Priority fee: $${PRIORITY_FEE / 100}`);
