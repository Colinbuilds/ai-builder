import { afterEach, describe, expect, it } from "vitest";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { driveNotFound, serviceAccountAssertion, serviceAccountEmail, serviceAccountKey } from "@/lib/integrations/google-sa";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const KEY = { type: "service_account", client_email: "btrpro-test-only@example.iam.gserviceaccount.com", private_key: privateKey, token_uri: "https://oauth2.googleapis.com/token" };
afterEach(() => {
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
});

describe("Google service account for Drive", () => {
  it("reads the key from raw JSON (with escaped newlines) or base64", () => {
    expect(serviceAccountKey()).toBeNull();
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ ...KEY, private_key: privateKey.replace(/\n/g, "\\n") }).replace(/\\\\n/g, "\\n");
    expect(serviceAccountEmail()).toBe(KEY.client_email);
    expect(serviceAccountKey()!.private_key).toContain("\n");
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = Buffer.from(JSON.stringify(KEY)).toString("base64");
    expect(serviceAccountEmail()).toBe(KEY.client_email);
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = "not json";
    expect(serviceAccountKey()).toBeNull();
  });

  it("signs a JWT assertion Google can verify (RS256, read-only Drive scope, 1 hour)", () => {
    const jwt = serviceAccountAssertion(KEY, 1_800_000_000);
    const [h, b, sig] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(b, "base64url").toString())).toEqual({ iss: KEY.client_email, scope: "https://www.googleapis.com/auth/drive.readonly", aud: KEY.token_uri, iat: 1_800_000_000, exp: 1_800_003_600 });
    expect(createVerify("RSA-SHA256").update(`${h}.${b}`).verify(publicKey, Buffer.from(sig, "base64url"))).toBe(true);
  });

  it("tells you which address to share with when Drive can't see a file", () => {
    expect(driveNotFound()).toMatch(/isn't shared with your account/);
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify(KEY);
    expect(driveNotFound()).toContain(KEY.client_email);
  });
});

describe("reading a pasted service account key", () => {
  const key = { type: "service_account", client_email: "TEST_ONLY@test.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nTESTONLYKEY\n-----END PRIVATE KEY-----\n" };
  const json = JSON.stringify(key, null, 2);
  it("reads the file as-is, base64, quoted, or with real line breaks inside the key", async () => {
    const { readServiceAccount } = await import("@/lib/integrations/google-sa");
    for (const raw of [json, Buffer.from(json).toString("base64"), `'${json}'`, json.replace(/\\n/g, "\n")]) {
      const r = readServiceAccount(raw);
      expect(r.problem).toBeNull();
      expect(r.key?.client_email).toBe(key.client_email);
      expect(r.key?.private_key).toBe(key.private_key);
    }
  });
  it("says what's wrong with a bad paste", async () => {
    const { readServiceAccount } = await import("@/lib/integrations/google-sa");
    expect(readServiceAccount("abc123").problem).toMatch(/isn't the JSON key/);
    expect(readServiceAccount('{"client_email": "x@y"}').problem).toMatch(/private_key/);
    expect(readServiceAccount('{"type": "service_account"}').problem).toMatch(/client_email/);
    expect(readServiceAccount("").problem).toBeNull();
  });
});

describe("AI error messages", () => {
  it("shows Anthropic's reason for a rejected request, and a billing hint for no credit", async () => {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const { aiErrorMessage } = await import("@/lib/ai/claude");
    const bad = (msg: string) => new Anthropic.BadRequestError(400, { type: "error", error: { type: "invalid_request_error", message: msg } }, msg, new Headers());
    expect(aiErrorMessage(bad("Your credit balance is too low to access the Anthropic API."))).toMatch(/out of credit/);
    expect(aiErrorMessage(bad("image exceeds 5 MB maximum"))).toBe("AI request rejected (400): image exceeds 5 MB maximum.");
  });
});
