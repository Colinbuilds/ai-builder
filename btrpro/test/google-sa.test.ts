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
