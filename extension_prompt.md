Bootstrap a Shopify Customer Account UI Extension for B2B tax exemption data collection, plus companion API endpoints added to an existing Cloudflare Worker.
Context:

Store is on new Customer Accounts (not legacy), using Horizon theme
I'm a Shopify Partner building this as a custom app for a single store
B2B data is collected post-account-creation via the customer's Profile page, not at registration
The Worker is an existing Hono app on Cloudflare Workers — new routes will be added to it, not a new Worker

Part 1: Shopify App + Customer Account UI Extension
Scaffold a Shopify app using the CLI (Remix, TypeScript) containing a single Customer Account UI Extension block targeting customer.account.profile.block.render on the Profile page.
Block: Tax Exemption Info
Fields:
FieldUIMetafieldTypeNotesTax Exempt StatusRadio buttonscustom.b2b.tax_exemptbooleanOptions: "Yes, we are tax-exempt (documentation required)" / "Not tax exempt"Tax Exemption TypeSelect dropdowncustom.b2b.exemption_typesingle_line_text_fieldOptions: Resale / Government & Military / Manufacturing & Industrial / Other. Only shown if Tax Exempt Status is YesExemption CertificateFile uploadcustom.b2b.exemption_certificatefile_referenceOnly shown if Tax Exempt Status is Yes. See Part 2 for upload flowCertificate ExpirationDate pickercustom.b2b.exemption_expirationdateOnly shown if Tax Exempt Status is YesApproval StatusRead-only displaycustom.b2b.approval_statussingle_line_text_fieldNever editable by customer. Values: not_approved / in_review / approved / expired. Render as a Polaris Badge: not_approved → neutral, in_review → attention, approved → success, expired → critical
Extension UX behavior:

Render as a Polaris Card with a view/edit state toggle
View mode shows current values; edit mode shows the form
If no data submitted yet, open directly in edit mode with explainer: "If your organization is tax-exempt, please complete the fields below. Documentation is required and will be reviewed by our team."
Approval Status field always renders in both view and edit mode as a read-only badge — it is never part of the editable form
Tax Exemption Type, Certificate upload, and Certificate Expiration are conditionally shown/hidden based on the Tax Exempt Status radio selection, both in view and edit mode
After save, add tag b2b-tax-review-pending to the customer via the Customer Account API — this will trigger a Shopify Flow workflow (built separately) to notify a reviewer
Show a Polaris Banner (tone: success) after successful save
Use Polaris components exclusively — no custom CSS

Metafield reads/writes:

For all fields except the file upload, use the Customer Account API directly from the extension — no server round-trip needed
The custom.b2b.approval_status metafield is read-only in the extension; it is only ever written by staff via the Shopify admin or a Flow action

File upload flow (certificate field):
The extension cannot write file_reference metafields directly. Use this three-step pattern:

Extension POSTs metadata (filename, mimetype, filesize) to POST /b2b/staged-upload-url on the Worker — Worker calls stagedUploadsCreate Admin API mutation and returns presigned URL + parameters to the client
Extension uploads the file directly to the presigned URL — file never passes through the Worker
Extension POSTs the resulting resourceUrl to POST /b2b/customer-metafields on the Worker — Worker writes the file_reference metafield to the customer record via Admin API

For all Worker calls, pass the customer's session token as Authorization: Bearer <token>, obtained via the Customer Account API's getSessionToken().

Part 2: Add Routes to Existing Cloudflare Worker
The existing Worker is a Hono app. Add the following routes without modifying any existing routes or shared infrastructure. Before writing any code, read the existing src/index.ts and any lib/helper files to understand current conventions, middleware patterns, and how environment bindings are typed — match those patterns exactly.
New routes to add:
POST /b2b/staged-upload-url

Validate Bearer JWT (see Auth section below)
Accept body: { filename: string, mimeType: string, fileSize: number }
Call Shopify Admin API stagedUploadsCreate mutation
Return presigned URL and required form parameters to client

POST /b2b/customer-metafields

Validate Bearer JWT
Accept body: { customerId: string, metafieldKey: string, resourceUrl: string }
Write file_reference metafield to the customer via Admin API

POST /b2b/customer-tags

Validate Bearer JWT
Accept body: { customerId: string, tag: string }
Add tag to the customer via Admin API tagsAdd mutation

JWT Validation:

Tokens are Shopify Customer Account API session tokens (JWTs)
Validate using crypto.subtle (native to Workers — no JWT library)
Fetch Shopify's JWKS from https://shopify.com/.well-known/openid-configuration, cache in memory with a reasonable TTL
Extract the customer GID from the validated token's sub claim for use in downstream Admin API calls
Implement in a new file src/lib/validate-jwt.ts

Admin API:

Store credentials as Worker secrets: SHOPIFY_ADMIN_TOKEN, SHOPIFY_STORE_DOMAIN
Implement a helper adminGraphQL(query, variables) that POSTs to https://${SHOPIFY_STORE_DOMAIN}/admin/api/2025-01/graphql.json with X-Shopify-Access-Token header
Implement in a new file src/lib/admin-api.ts
Add new secrets to the existing wrangler.toml under [vars] or as secret references — do not overwrite existing bindings

Part 3: Metafield Definitions Script
Create /scripts/create-metafield-definitions.ts that provisions all required metafield definitions on the Customer resource via metafieldDefinitionCreate. Run once during setup.
KeyNamespaceTypeNametax_exemptcustom.b2bbooleanTax Exemptexemption_typecustom.b2bsingle_line_text_fieldExemption Typeexemption_certificatecustom.b2bfile_referenceExemption Certificateexemption_expirationcustom.b2bdateCertificate Expirationapproval_statuscustom.b2bsingle_line_text_fieldApproval Status
Read SHOPIFY_ADMIN_TOKEN and SHOPIFY_STORE_DOMAIN from a local .env file. Log success/failure per definition.

Suggested file structure:
/extensions/b2b-profile/
src/
TaxExemptionBlock.tsx
hooks/useCustomerMetafields.ts
hooks/useFileUpload.ts ← 3-step staged upload flow
utils/workerClient.ts ← typed fetch wrapper for Worker routes

/workers/[existing-worker]/
src/
lib/admin-api.ts ← new
lib/validate-jwt.ts ← new
routes/b2b/
staged-upload.ts ← new
customer-metafields.ts ← new
customer-tags.ts ← new
index.ts ← existing, add route registrations only

/scripts/
create-metafield-definitions.ts

Build order:

Read existing Worker source in full before writing any new code
Scaffold the Shopify app and extension structure with CLI
Implement validate-jwt.ts and admin-api.ts in the Worker
Implement the three new Worker routes and register them in index.ts
Run create-metafield-definitions.ts to provision metafields
Implement useFileUpload.ts hook
Implement TaxExemptionBlock.tsx
Wire up extension target in shopify.extension.toml
