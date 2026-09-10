export class ApiError<T = unknown> extends Error {
  constructor(
    public readonly status: number,
    public readonly body: T
  ) {
    super(typeof body === "object" && body && "message" in body ? String(body.message) : `Request failed (${status})`);
  }
}

export async function fusionFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new ApiError(response.status, body);
  }
  const data = response.status === 204 ? undefined : await response.json();
  return { data, status: response.status, headers: response.headers } as T;
}
