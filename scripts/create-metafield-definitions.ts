#!/usr/bin/env npx tsx

/**
 * Provision metafield definitions for B2B tax exemption on Customer resource.
 * Run once during setup: npx tsx scripts/create-metafield-definitions.ts
 *
 * Requires .env file with:
 * SHOPIFY_ADMIN_TOKEN=shpat_xxxxx
 * SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const SHOPIFY_API_VERSION = '2025-01';

interface MetafieldDefinition {
  key: string;
  namespace: string;
  type: string;
  name: string;
  description?: string;
  ownerType: string;
}

const METAFIELD_DEFINITIONS: MetafieldDefinition[] = [
  {
    key: 'tax_exempt',
    namespace: 'custom',
    type: 'boolean',
    name: 'Tax Exempt',
    description: 'Whether the organization is tax exempt',
    ownerType: 'CUSTOMER',
  },
  {
    key: 'exemption_type',
    namespace: 'custom',
    type: 'single_line_text_field',
    name: 'Exemption Type',
    description: 'Type of tax exemption: Resale, Government & Military, Manufacturing & Industrial, Other',
    ownerType: 'CUSTOMER',
  },
  {
    key: 'exemption_certificate',
    namespace: 'custom',
    type: 'file_reference',
    name: 'Exemption Certificate',
    description: 'Uploaded tax exemption certificate document',
    ownerType: 'CUSTOMER',
  },
  {
    key: 'exemption_expiration',
    namespace: 'custom',
    type: 'date',
    name: 'Certificate Expiration',
    description: 'Expiration date of the tax exemption certificate',
    ownerType: 'CUSTOMER',
  },
  {
    key: 'approval_status',
    namespace: 'custom',
    type: 'single_line_text_field',
    name: 'Approval Status',
    description: 'Tax exemption approval status: not_approved, in_review, approved, expired',
    ownerType: 'CUSTOMER',
  },
];

const METAFIELD_DEFINITION_CREATE_MUTATION = `
  mutation metafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
        key
        namespace
        name
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

function loadEnv(): { adminToken: string; storeDomain: string } {
  const envPath = resolve(process.cwd(), '.env');
  let envContent: string;

  try {
    envContent = readFileSync(envPath, 'utf-8');
  } catch {
    console.error('Error: .env file not found in project root');
    console.error('Create a .env file with:');
    console.error('  SHOPIFY_ADMIN_TOKEN=shpat_xxxxx');
    console.error('  SHOPIFY_STORE_DOMAIN=your-store.myshopify.com');
    process.exit(1);
  }

  const env: Record<string, string> = {};
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...valueParts] = trimmed.split('=');
    if (key && valueParts.length > 0) {
      env[key.trim()] = valueParts.join('=').trim();
    }
  }

  const adminToken = env['SHOPIFY_ADMIN_TOKEN'];
  const storeDomain = env['SHOPIFY_STORE_DOMAIN'];

  if (!adminToken || !storeDomain) {
    console.error('Error: Missing required environment variables');
    console.error('Ensure .env contains SHOPIFY_ADMIN_TOKEN and SHOPIFY_STORE_DOMAIN');
    process.exit(1);
  }

  return { adminToken, storeDomain };
}

async function adminGraphQL<T>(
  adminToken: string,
  storeDomain: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<{ data?: T; errors?: Array<{ message: string }> }> {
  const url = `https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': adminToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Shopify API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

interface CreateDefinitionResponse {
  metafieldDefinitionCreate: {
    createdDefinition: {
      id: string;
      key: string;
      namespace: string;
      name: string;
    } | null;
    userErrors: Array<{
      field: string[];
      message: string;
      code: string;
    }>;
  };
}

async function createMetafieldDefinition(
  adminToken: string,
  storeDomain: string,
  definition: MetafieldDefinition
): Promise<{ success: boolean; message: string }> {
  const response = await adminGraphQL<CreateDefinitionResponse>(
    adminToken,
    storeDomain,
    METAFIELD_DEFINITION_CREATE_MUTATION,
    {
      definition: {
        key: definition.key,
        namespace: definition.namespace,
        name: definition.name,
        description: definition.description,
        type: definition.type,
        ownerType: definition.ownerType,
      },
    }
  );

  if (response.errors && response.errors.length > 0) {
    return {
      success: false,
      message: response.errors.map((e) => e.message).join(', '),
    };
  }

  const result = response.data?.metafieldDefinitionCreate;
  if (!result) {
    return { success: false, message: 'Empty response from Shopify' };
  }

  if (result.userErrors && result.userErrors.length > 0) {
    const error = result.userErrors[0];
    // "TAKEN" means definition already exists - treat as success
    if (error.code === 'TAKEN') {
      return { success: true, message: 'Already exists' };
    }
    return { success: false, message: error.message };
  }

  if (result.createdDefinition) {
    return {
      success: true,
      message: `Created with ID: ${result.createdDefinition.id}`,
    };
  }

  return { success: false, message: 'Unknown error' };
}

async function main() {
  console.log('Creating B2B tax exemption metafield definitions...\n');

  const { adminToken, storeDomain } = loadEnv();
  console.log(`Store: ${storeDomain}\n`);

  let successCount = 0;
  let failCount = 0;

  for (const definition of METAFIELD_DEFINITIONS) {
    const fullKey = `${definition.namespace}.${definition.key}`;
    process.stdout.write(`  ${fullKey.padEnd(35)} `);

    try {
      const result = await createMetafieldDefinition(
        adminToken,
        storeDomain,
        definition
      );

      if (result.success) {
        console.log(`✓ ${result.message}`);
        successCount++;
      } else {
        console.log(`✗ ${result.message}`);
        failCount++;
      }
    } catch (error) {
      console.log(`✗ ${(error as Error).message}`);
      failCount++;
    }
  }

  console.log(`\nComplete: ${successCount} succeeded, ${failCount} failed`);

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
