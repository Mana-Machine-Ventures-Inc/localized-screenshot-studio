const BASE = "https://api.appstoreconnect.apple.com";

export interface AscError {
  status: string;
  code: string;
  title: string;
  detail?: string;
}

export class AscApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public errors: AscError[] = [],
  ) {
    super(message);
    this.name = "AscApiError";
  }
}

export interface JsonApiResource<A = Record<string, unknown>> {
  type: string;
  id: string;
  attributes?: A;
  relationships?: Record<string, unknown>;
}

export interface JsonApiResponse<A = Record<string, unknown>> {
  data: JsonApiResource<A> | JsonApiResource<A>[];
  included?: JsonApiResource[];
  links?: Record<string, string>;
}

/** Thin JSON:API client for the App Store Connect API. */
export async function ascRequest<A = Record<string, unknown>>(
  token: string,
  method: string,
  pathOrUrl: string,
  body?: unknown,
): Promise<JsonApiResponse<A>> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${BASE}${pathOrUrl}`;
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 204) {
    return { data: [] };
  }

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const errors: AscError[] = json.errors ?? [];
    const detail = errors[0]?.detail ?? errors[0]?.title ?? res.statusText;
    throw new AscApiError(
      `ASC ${method} ${pathOrUrl} failed (${res.status}): ${detail}`,
      res.status,
      errors,
    );
  }
  return json as JsonApiResponse<A>;
}

/** PUT a binary part to a screenshot upload operation URL. */
export async function uploadBinary(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: Buffer,
): Promise<void> {
  const res = await fetch(url, {
    method,
    headers,
    // Node's global fetch accepts a Buffer/Uint8Array body at runtime; the DOM
    // lib's BodyInit typing is stricter, so cast explicitly.
    body: body as unknown as BodyInit,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AscApiError(
      `Binary upload failed (${res.status}): ${text.slice(0, 200)}`,
      res.status,
    );
  }
}
