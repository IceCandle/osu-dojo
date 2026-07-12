import {
  requestAsyncStorage,
  type RequestStore,
} from "next/dist/client/components/request-async-storage.external";

const anonymousRequestStore = {
  cookies: { get: () => undefined },
} as unknown as RequestStore;

export function withAnonymousRequestScope<T>(callbackFn: () => T): T {
  return requestAsyncStorage.run(anonymousRequestStore, callbackFn);
}
