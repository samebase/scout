import { expect, test } from "vite-plus/test";
import { parseToolValue, presentToolActivity } from "./toolActivity";
import { toolActivityLinks } from "../../shared/toolActivity";

function activity(
  name: string,
  input: unknown,
  output: unknown,
  audience: "member" | "admin" = "member",
) {
  return presentToolActivity({
    id: "call",
    name,
    state: "completed",
    input: parseToolValue(input),
    output: parseToolValue(output),
    error: null,
    audience,
  });
}

test("browser and shell activity retains useful actual inputs, outputs and first-line previews", () => {
  const browser = activity(
    "browser_execute",
    {
      code: "await page.getByRole('button', { name: 'Save' }).click();\nreturn await browserState(page);",
    },
    {
      success: true,
      currentPage: "heading Project saved",
      output: JSON.stringify({
        currentUrl: "https://example.test/projects?sort=name",
        title: "Project saved",
      }),
    },
  );
  expect(browser.input).toContain("getByRole");
  expect(browser.output).toContain("heading Project saved");
  expect(browser.preview).toBe("await page.getByRole('button', { name: 'Save' }).click();");
  expect(browser.links).toEqual([
    { label: "Project saved", url: "https://example.test/projects?sort=name" },
  ]);
  const shell = activity(
    "bash",
    { command: "ls /workspace/results\ncat /workspace/results/report.csv" },
    { stdout: "report.csv", stderr: "", exitCode: 0 },
  );
  expect(shell.preview).toBe("ls /workspace/results");
  expect(shell.input).toContain("cat /workspace/results/report.csv");
  expect(shell.output).toContain("report.csv");
});

test("member tools redact credential fields, embedded secrets and capability URLs while admin retains full data", () => {
  const input = {
    code: "const password = 'secret-pass'; await page.goto('https://example.test/?token=signed-token');",
    headers: { Authorization: "Bearer secret-bearer" },
    apiKey: "secret-key",
  };
  const output = {
    success: true,
    cdpUrl: "wss://control.example.test/session/private",
    liveViewUrl: "https://example.test/view/private",
    output: JSON.stringify({
      password: "nested-password",
      currentUrl: "https://example.test/dashboard",
    }),
    resultUrl: "https://bucket.test/file?X-Amz-Signature=private-signature",
    text: "Authorization: Bearer token-secret",
  };
  const member = activity("browser_execute", input, output);
  expect(JSON.stringify(member)).not.toMatch(
    /secret-pass|signed-token|secret-bearer|secret-key|nested-password|private-signature|token-secret|view\/private|session\/private/,
  );
  expect(member.input).toContain("page.goto");
  const admin = activity("browser_execute", input, output, "admin");
  expect(admin.input).toContain("secret-pass");
  expect(admin.output).toContain("nested-password");
});

test("mail bodies and account details stay out of member tools, including previews", () => {
  const mail = activity(
    "get_thread",
    { thread_id: "private-thread" },
    { messages: [{ text: "private email body", html: "private html" }], count: 2 },
  );
  expect(mail.output).toContain('"count": 2');
  expect(JSON.stringify(mail)).not.toMatch(/private/);
  const password = activity(
    "prepare_account_password",
    { serviceDomain: "example.test", identifier: "private@example.test" },
    { status: "prepared", credentialReference: "private-reference", password: "private-password" },
  );
  expect(password.output).toContain("prepared");
  expect(JSON.stringify(password)).not.toMatch(/private/);
});

test.each([
  { output: { type: "error-text", value: "Navigation timed out" }, error: "Navigation timed out" },
  {
    output: { type: "json", value: { success: false, error: "Element is not visible" } },
    error: "Element is not visible",
  },
  {
    output: { isError: true, content: [{ type: "text", text: "Provider quota exceeded" }] },
    error: "Provider quota exceeded",
  },
  { output: { exitCode: 2, stderr: "file missing" }, error: "Process exited with code 2" },
])("tool failure remains failed when dispatch itself succeeded: $error", ({ output, error }) => {
  expect(activity("web_search", { query: "Search" }, output)).toMatchObject({
    state: "failed",
    error: expect.stringContaining(error),
  });
});

test("links come only from structured output URL fields, never arbitrary text or signed URLs", () => {
  const tool = activity(
    "web_search",
    { query: "Docs" },
    {
      results: [
        { title: "Docs", url: "https://example.test/docs" },
        { title: "Unsafe", url: "javascript:alert(1)" },
        { title: "Signed", url: "https://example.test/file?sig=private" },
      ],
      text: "Some text https://unrelated.test/arbitrary",
    },
  );
  expect(tool.links).toEqual([{ label: "Docs", url: "https://example.test/docs" }]);
  expect(
    toolActivityLinks(JSON.stringify({ url: "https://example.test/search?q=scout#results" })),
  ).toEqual([{ label: "example.test", url: "https://example.test/search?q=scout#results" }]);
  expect(toolActivityLinks({ url: "https://example.test/#access_token=private" })).toEqual([]);
});

test("long browser output remains inspectable while password fills stay redacted", () => {
  const result = activity(
    "browser_execute",
    {
      code: "await page.getByLabel('Password').fill('private-one');\nawait passwordInput.fill('private-two');",
    },
    { success: true, output: `data:image/png;base64,${"a".repeat(40_829)}` },
  );
  expect(result.output).toContain("[Display truncated]");
  expect(result.input).toContain("getByLabel");
  expect(result.input).toContain("passwordInput.fill");
  expect(result.input).not.toMatch(/private-one|private-two/);
});
