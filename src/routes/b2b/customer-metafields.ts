import type { Context } from 'hono';
import type { Env } from '../../types';
import { adminGraphQL } from '../../lib/admin-api';
import { validateCustomerToken, extractBearerToken } from '../../lib/validate-jwt';

interface CustomerMetafieldsRequest {
  customerId: string;
  namespace: string;
  metafieldKey: string;
  resourceUrl: string;
}

interface MetafieldsSetResponse {
  metafieldsSet: {
    metafields: Array<{
      id: string;
      key: string;
      namespace: string;
      value: string;
    }>;
    userErrors: Array<{
      field: string[];
      message: string;
    }>;
  };
}

const METAFIELDS_SET_MUTATION = `
  mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        key
        namespace
        value
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function handleCustomerMetafields(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  // Validate JWT
  const authHeader = c.req.header('Authorization');
  const token = extractBearerToken(authHeader);
  if (!token) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  let validatedToken;
  try {
    validatedToken = await validateCustomerToken(
      token,
      `https://${c.env.SHOPIFY_STORE_DOMAIN}`
    );
  } catch (error) {
    console.error('JWT validation failed', { error: (error as Error).message });
    return c.json({ error: 'Invalid token' }, 401);
  }

  // Parse request body
  let body: CustomerMetafieldsRequest;
  try {
    body = await c.req.json<CustomerMetafieldsRequest>();
  } catch {
    return c.json({ error: 'Invalid request body' }, 400);
  }

  if (!body.customerId || !body.namespace || !body.metafieldKey || !body.resourceUrl) {
    return c.json(
      { error: 'Missing required fields: customerId, namespace, metafieldKey, resourceUrl' },
      400
    );
  }

  // Verify the customerId matches the token's subject (prevent users from modifying others' data)
  if (body.customerId !== validatedToken.customerId) {
    console.error('Customer ID mismatch', {
      tokenCustomerId: validatedToken.customerId,
      requestCustomerId: body.customerId,
    });
    return c.json({ error: 'Unauthorized: customer ID mismatch' }, 403);
  }

  // Write the file_reference metafield via Admin API
  const response = await adminGraphQL<MetafieldsSetResponse>(
    c.env,
    METAFIELDS_SET_MUTATION,
    {
      metafields: [
        {
          ownerId: body.customerId,
          namespace: body.namespace,
          key: body.metafieldKey,
          type: 'file_reference',
          value: body.resourceUrl,
        },
      ],
    }
  );

  if (response.errors && response.errors.length > 0) {
    console.error('Metafields set GraphQL errors', { errors: response.errors });
    return c.json({ error: 'Failed to set metafield' }, 500);
  }

  const result = response.data?.metafieldsSet;
  if (!result) {
    return c.json({ error: 'Empty response from Shopify' }, 500);
  }

  if (result.userErrors && result.userErrors.length > 0) {
    console.error('Metafields set user errors', { errors: result.userErrors });
    return c.json({ error: result.userErrors[0].message }, 400);
  }

  const metafield = result.metafields[0];
  console.log('Metafield set successfully', {
    customerId: body.customerId,
    metafieldKey: body.metafieldKey,
    metafieldId: metafield?.id,
  });

  return c.json({
    success: true,
    metafield: metafield,
  });
}
