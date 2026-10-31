import { expect, it } from "vitest";
import { redactDiagnostics } from "./diagnosticRedaction";

it("preserves journal and support policies while sharing recursive redaction", () => {
  const value = {
    nested: [
      {
        url: "https://user:secret@example.com/path?q=secret#fragment",
        favIconUrl: "https://example.com/icon?private=1",
      },
    ],
  };
  expect(redactDiagnostics(value, "journal")).toEqual({
    nested: [
      { url: "https://example.com", favIconUrl: value.nested[0].favIconUrl },
    ],
  });
  expect(redactDiagnostics(value, "support")).toEqual({
    nested: [{ url: "https://example.com", favIconUrl: "https://example.com" }],
  });
});

it("reduces non-web and invalid addresses without mutating the source", () => {
  const source = { url: "file:///private/document", next: { url: "broken" } };
  expect(redactDiagnostics(source, "support")).toEqual({
    url: "file:",
    next: { url: "invalid:" },
  });
  expect(source.url).toBe("file:///private/document");
});
