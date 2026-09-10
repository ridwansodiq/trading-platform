/**
 * The generated client types every documented response into one union
 * discriminated on `status`, so `response.data` is `Trade | ApiError`.
 *
 * `fusionFetch` throws an `ApiError` for every non-2xx reply, so by the time a
 * caller holds a response the error branches are already unreachable. `ok`
 * narrows to the success payload once, here, instead of forcing a status check
 * at every call site — and it stays generic, so no endpoint needs a
 * handwritten wrapper.
 */

type SuccessStatus = 200 | 201 | 204;

type HttpResponse = { status: number; data: unknown };

export type SuccessData<T extends HttpResponse> = Extract<T, { status: SuccessStatus }>["data"];

export function ok<T extends HttpResponse>(response: T): SuccessData<T> {
  return response.data as SuccessData<T>;
}
