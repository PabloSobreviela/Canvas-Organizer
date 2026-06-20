import { apiFetchOptions } from "./auth";

test("adds the CSRF header to unsafe cookie-authenticated requests", () => {
  const options = apiFetchOptions({ method: "POST" });
  expect(options.credentials).toBe("include");
  expect(options.headers["X-CanvasSync-CSRF"]).toBe("1");
});

test("does not add the CSRF header to safe requests", () => {
  const options = apiFetchOptions({ method: "GET" });
  expect(options.headers["X-CanvasSync-CSRF"]).toBeUndefined();
});
