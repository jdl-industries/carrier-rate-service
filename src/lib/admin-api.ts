import type { Env } from '../types';

const SHOPIFY_API_VERSION = '2025-01';
const REQUEST_TIMEOUT_MS = 30000;

export interface AdminGraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
    extensions?: Record<string, unknown>;
  }>;
}

export async function adminGraphQL<T = unknown>(
  env: Env,
  query: string,
  variables?: Record<string, unknown>
): Promise<AdminGraphQLResponse<T>> {
  const url = `https://${env.SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': env.SHOPIFY_ADMIN_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Shopify Admin API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const result = (await response.json()) as AdminGraphQLResponse<T>;

    if (result.errors && result.errors.length > 0) {
      console.error('Shopify Admin API GraphQL errors', {
        errors: result.errors,
        query: query.substring(0, 200),
      });
    }

    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}
