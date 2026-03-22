import type { Context } from 'hono';
import type { Env } from '../../types';
import { adminGraphQL } from '../../lib/admin-api';
import { validateCustomerToken, extractBearerToken } from '../../lib/validate-jwt';

interface CustomerTagsRequest {
  customerId: string;
  tag: string;
}

interface TagsAddResponse {
  tagsAdd: {
    node: {
      id: string;
    } | null;
    userErrors: Array<{
      field: string[];
      message: string;
    }>;
  };
}

const TAGS_ADD_MUTATION = `
  mutation tagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function handleCustomerTags(
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
  let body: CustomerTagsRequest;
  try {
    body = await c.req.json<CustomerTagsRequest>();
  } catch {
    return c.json({ error: 'Invalid request body' }, 400);
  }

  if (!body.customerId || !body.tag) {
    return c.json({ error: 'Missing required fields: customerId, tag' }, 400);
  }

  // Verify the customerId matches the token's subject
  if (body.customerId !== validatedToken.customerId) {
    console.error('Customer ID mismatch', {
      tokenCustomerId: validatedToken.customerId,
      requestCustomerId: body.customerId,
    });
    return c.json({ error: 'Unauthorized: customer ID mismatch' }, 403);
  }

  // Add tag via Admin API
  const response = await adminGraphQL<TagsAddResponse>(
    c.env,
    TAGS_ADD_MUTATION,
    {
      id: body.customerId,
      tags: [body.tag],
    }
  );

  if (response.errors && response.errors.length > 0) {
    console.error('Tags add GraphQL errors', { errors: response.errors });
    return c.json({ error: 'Failed to add tag' }, 500);
  }

  const result = response.data?.tagsAdd;
  if (!result) {
    return c.json({ error: 'Empty response from Shopify' }, 500);
  }

  if (result.userErrors && result.userErrors.length > 0) {
    console.error('Tags add user errors', { errors: result.userErrors });
    return c.json({ error: result.userErrors[0].message }, 400);
  }

  console.log('Tag added successfully', {
    customerId: body.customerId,
    tag: body.tag,
  });

  return c.json({
    success: true,
  });
}
