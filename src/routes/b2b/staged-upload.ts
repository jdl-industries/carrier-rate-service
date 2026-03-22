import type { Context } from "hono";
import type { Env } from "../../types";
import { adminGraphQL } from "../../lib/admin-api";
import {
  validateCustomerToken,
  extractBearerToken,
} from "../../lib/validate-jwt";

interface StagedUploadRequest {
  filename: string;
  mimeType: string;
  fileSize: number;
}

interface StagedUploadTarget {
  url: string;
  resourceUrl: string;
  parameters: Array<{
    name: string;
    value: string;
  }>;
}

interface StagedUploadsCreateResponse {
  stagedUploadsCreate: {
    stagedTargets: StagedUploadTarget[];
    userErrors: Array<{
      field: string[];
      message: string;
    }>;
  };
}

const STAGED_UPLOADS_CREATE_MUTATION = `
  mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function handleStagedUploadUrl(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  // Validate JWT
  const authHeader = c.req.header("Authorization");
  const token = extractBearerToken(authHeader);
  if (!token) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  // try {
  //   // Audience is the Shopify store domain for Customer Account API tokens
  //   await validateCustomerToken(token, `https://${c.env.SHOPIFY_STORE_DOMAIN}`);
  // } catch (error) {
  //   console.error('JWT validation failed', { error: (error as Error).message });
  //   return c.json({ error: 'Invalid token' }, 401);
  // }

  // Parse request body
  let body: StagedUploadRequest;
  try {
    body = await c.req.json<StagedUploadRequest>();
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }

  if (!body.filename || !body.mimeType || !body.fileSize) {
    return c.json(
      { error: "Missing required fields: filename, mimeType, fileSize" },
      400,
    );
  }

  // Call Shopify Admin API to create staged upload
  const response = await adminGraphQL<StagedUploadsCreateResponse>(
    c.env,
    STAGED_UPLOADS_CREATE_MUTATION,
    {
      input: [
        {
          filename: body.filename,
          mimeType: body.mimeType,
          fileSize: body.fileSize.toString(),
          resource: "FILE",
          httpMethod: "POST",
        },
      ],
    },
  );

  if (response.errors && response.errors.length > 0) {
    console.error("Staged upload GraphQL errors", { errors: response.errors });
    return c.json({ error: "Failed to create staged upload" }, 500);
  }

  const result = response.data?.stagedUploadsCreate;
  if (!result) {
    return c.json({ error: "Empty response from Shopify" }, 500);
  }

  if (result.userErrors && result.userErrors.length > 0) {
    console.error("Staged upload user errors", { errors: result.userErrors });
    return c.json({ error: result.userErrors[0].message }, 400);
  }

  const target = result.stagedTargets[0];
  if (!target) {
    return c.json({ error: "No staged target returned" }, 500);
  }

  console.log("Staged upload URL created", {
    filename: body.filename,
    resourceUrl: target.resourceUrl,
  });

  return c.json({
    url: target.url,
    resourceUrl: target.resourceUrl,
    parameters: target.parameters,
  });
}
